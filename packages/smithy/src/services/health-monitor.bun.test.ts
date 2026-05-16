/**
 * HealthMonitor tests
 *
 * Covers the three detection paths (auth-loss via PTY scan, self-addressed
 * pings, repeat-identical dispatches) and the per-(agent, issue) throttle.
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { QuarryAPI, InboxService } from '@stoneforge/quarry';
import type { Message, EntityId, ElementId, InboxItem, ChannelId } from '@stoneforge/core';
import type { SessionManager, SessionRecord } from '../runtime/session-manager.js';
import type { AgentRegistry } from './agent-registry.js';
import type { AgentEntity } from '../api/orchestrator-api.js';
import { HealthMonitor, REPEAT_THRESHOLD, SELF_PING_THRESHOLD, THROTTLE_WINDOW_MS } from './health-monitor.js';

// ---------- helpers ----------

function makeAgent(id: string, name: string, role: 'worker' | 'director' = 'worker'): AgentEntity {
  return {
    id,
    type: 'entity',
    name,
    entityType: 'agent',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'system' as EntityId,
    metadata: { agent: { agentRole: role, channelId: `ch-${id}` as ChannelId } },
  } as unknown as AgentEntity;
}

function makeSession(id: string, agentId: string): SessionRecord {
  return {
    id,
    agentId: agentId as unknown as EntityId,
    agentRole: 'worker',
    workerMode: 'persistent',
    status: 'running',
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
  } as unknown as SessionRecord;
}

function makeInboxItem(messageId: string, recipientId: string, createdAt: string): InboxItem {
  return {
    id: `inbox-${messageId}`,
    recipientId: recipientId as unknown as EntityId,
    messageId,
    channelId: `ch-${recipientId}` as ChannelId,
    sourceType: 'message',
    status: 'unread',
    readAt: null,
    createdAt,
  } as InboxItem;
}

// ---------- harness ----------

interface Harness {
  monitor: HealthMonitor;
  emitters: Map<string, EventEmitter>;
  sessions: SessionRecord[];
  agents: Map<string, AgentEntity>;
  inboxes: Map<string, InboxItem[]>;
  messages: Map<string, Message>;
  director: AgentEntity;
  directorSession: SessionRecord;
  messageSessionMock: ReturnType<typeof mock>;
}

function makeHarness(): Harness {
  const emitters = new Map<string, EventEmitter>();
  const sessions: SessionRecord[] = [];
  const agents = new Map<string, AgentEntity>();
  const inboxes = new Map<string, InboxItem[]>();
  const messages = new Map<string, Message>();

  const director = makeAgent('el-director', 'Director', 'director');
  const directorSession = makeSession('sess-director', director.id);
  agents.set(director.id, director);
  sessions.push(directorSession);
  emitters.set(directorSession.id, new EventEmitter());

  const messageSessionMock = mock(async () => ({ success: true }));

  const sessionManager = {
    listSessions: () => sessions,
    getSession: (id: string) => sessions.find((s) => s.id === id),
    getActiveSession: (agentId: EntityId) =>
      sessions.find((s) => String(s.agentId) === String(agentId)),
    getEventEmitter: (id: string) => emitters.get(id),
    messageSession: messageSessionMock,
  } as unknown as SessionManager;

  const agentRegistry = {
    getAgent: async (id: EntityId) => agents.get(String(id)),
    getDirector: async () => director,
  } as unknown as AgentRegistry;

  const inboxService = {
    getInbox: (agentId: EntityId) => inboxes.get(String(agentId)) ?? [],
  } as unknown as InboxService;

  const api = {
    get: async <T>(id: ElementId) => messages.get(String(id)) as unknown as T,
  } as unknown as QuarryAPI;

  const monitor = new HealthMonitor(api, inboxService, sessionManager, agentRegistry);

  return { monitor, emitters, sessions, agents, inboxes, messages, director, directorSession, messageSessionMock };
}

// ---------- tests ----------

describe('HealthMonitor', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  describe('auth-loss detection', () => {
    test('detects "Please run /login" in worker PTY output', async () => {
      const worker = makeAgent('el-worker1', 'Delivery');
      const session = makeSession('sess-w1', worker.id);
      h.agents.set(worker.id, worker);
      h.sessions.push(session);
      const emitter = new EventEmitter();
      h.emitters.set(session.id, emitter);

      h.monitor.attachToSession(session.id);
      emitter.emit('pty-data', 'some prompt output\nPlease run /login to authenticate\n');

      const findings = await h.monitor.runDetection();
      const authLoss = findings.find((f) => f.issueType === 'auth_loss' && f.agentId === worker.id);

      expect(authLoss).toBeDefined();
      expect(authLoss!.evidence).toContain('Please run /login');
      expect(authLoss!.agentName).toBe('Delivery');
    });

    test('detects "Not logged in" marker', async () => {
      const worker = makeAgent('el-worker2', 'Tester');
      const session = makeSession('sess-w2', worker.id);
      h.agents.set(worker.id, worker);
      h.sessions.push(session);
      const emitter = new EventEmitter();
      h.emitters.set(session.id, emitter);

      h.monitor.attachToSession(session.id);
      emitter.emit('pty-data', 'Not logged in. Please authenticate first.');

      const findings = await h.monitor.runDetection();
      expect(findings.some((f) => f.issueType === 'auth_loss')).toBe(true);
    });

    test('does NOT flag clean PTY output', async () => {
      const worker = makeAgent('el-worker3', 'Clean');
      const session = makeSession('sess-w3', worker.id);
      h.agents.set(worker.id, worker);
      h.sessions.push(session);
      const emitter = new EventEmitter();
      h.emitters.set(session.id, emitter);

      h.monitor.attachToSession(session.id);
      emitter.emit('pty-data', 'Normal worker output, no auth issues here.\n');
      emitter.emit('pty-data', 'Running task el-123, all good.\n');

      const findings = await h.monitor.runDetection();
      expect(findings.filter((f) => f.issueType === 'auth_loss')).toHaveLength(0);
    });
  });

  describe('self-addressed ping detection', () => {
    test('flags inbox when ≥SELF_PING_THRESHOLD messages have sender == recipient within 5 min', async () => {
      const worker = makeAgent('el-victim', 'SelfPingVictim');
      const session = makeSession('sess-victim', worker.id);
      h.agents.set(worker.id, worker);
      h.sessions.push(session);
      h.emitters.set(session.id, new EventEmitter());

      // Inject self-addressed messages
      const now = new Date();
      const items: InboxItem[] = [];
      for (let i = 0; i < SELF_PING_THRESHOLD; i++) {
        const msgId = `msg-self-${i}`;
        h.messages.set(msgId, { id: msgId, sender: worker.id } as unknown as Message);
        items.push(makeInboxItem(msgId, worker.id, new Date(now.getTime() - i * 1000).toISOString()));
      }
      h.inboxes.set(worker.id, items);

      const findings = await h.monitor.runDetection();
      const selfPing = findings.find((f) => f.issueType === 'self_addressed_ping' && f.agentId === worker.id);
      expect(selfPing).toBeDefined();
      expect(selfPing!.evidence).toContain('self-addressed');
    });

    test('does NOT flag when sender differs from recipient', async () => {
      const worker = makeAgent('el-w-ok', 'OK');
      const session = makeSession('sess-w-ok', worker.id);
      h.agents.set(worker.id, worker);
      h.sessions.push(session);
      h.emitters.set(session.id, new EventEmitter());

      const items: InboxItem[] = [];
      for (let i = 0; i < 5; i++) {
        const msgId = `msg-other-${i}`;
        h.messages.set(msgId, { id: msgId, sender: 'el-director' } as unknown as Message);
        items.push(makeInboxItem(msgId, worker.id, new Date().toISOString()));
      }
      h.inboxes.set(worker.id, items);

      const findings = await h.monitor.runDetection();
      expect(findings.some((f) => f.issueType === 'self_addressed_ping')).toBe(false);
    });
  });

  describe('repeat-identical dispatch detection', () => {
    test('flags ≥REPEAT_THRESHOLD identical messages within 60 seconds', async () => {
      const worker = makeAgent('el-spam', 'SpamVictim');
      const session = makeSession('sess-spam', worker.id);
      h.agents.set(worker.id, worker);
      h.sessions.push(session);
      h.emitters.set(session.id, new EventEmitter());

      const items: InboxItem[] = [];
      for (let i = 0; i < REPEAT_THRESHOLD; i++) {
        const msgId = `msg-spam-${i}`;
        // Same sender + same contentRef = identical dispatch
        h.messages.set(msgId, {
          id: msgId,
          sender: 'el-director',
          contentRef: 'doc-identical-content',
        } as unknown as Message);
        items.push(makeInboxItem(msgId, worker.id, new Date().toISOString()));
      }
      h.inboxes.set(worker.id, items);

      const findings = await h.monitor.runDetection();
      const repeat = findings.find((f) => f.issueType === 'repeat_identical_dispatch' && f.agentId === worker.id);
      expect(repeat).toBeDefined();
      expect(repeat!.evidence).toContain('identical');
    });

    test('does NOT flag when content varies', async () => {
      const worker = makeAgent('el-w-var', 'Varied');
      const session = makeSession('sess-w-var', worker.id);
      h.agents.set(worker.id, worker);
      h.sessions.push(session);
      h.emitters.set(session.id, new EventEmitter());

      const items: InboxItem[] = [];
      for (let i = 0; i < 5; i++) {
        const msgId = `msg-var-${i}`;
        h.messages.set(msgId, {
          id: msgId,
          sender: 'el-director',
          contentRef: `doc-different-${i}`,
        } as unknown as Message);
        items.push(makeInboxItem(msgId, worker.id, new Date().toISOString()));
      }
      h.inboxes.set(worker.id, items);

      const findings = await h.monitor.runDetection();
      expect(findings.some((f) => f.issueType === 'repeat_identical_dispatch')).toBe(false);
    });
  });

  describe('throttling', () => {
    test('surfaces same (agent, issue) only once per THROTTLE_WINDOW_MS', async () => {
      const worker = makeAgent('el-throttle', 'Throttled');
      const session = makeSession('sess-thr', worker.id);
      h.agents.set(worker.id, worker);
      h.sessions.push(session);
      const emitter = new EventEmitter();
      h.emitters.set(session.id, emitter);

      h.monitor.attachToSession(session.id);
      emitter.emit('pty-data', 'Please run /login\n');

      h.messageSessionMock.mockClear();

      // First poll: surfaces
      await h.monitor.poll();
      expect(h.messageSessionMock.mock.calls.length).toBe(1);

      // Re-emit so the auth-loss buffer is still hot
      emitter.emit('pty-data', 'Please run /login\n');

      // Second poll inside the window: throttled, no new surface
      await h.monitor.poll();
      expect(h.messageSessionMock.mock.calls.length).toBe(1);

      // After the window expires (force-set internal map), surfaces again
      const internalMap = (h.monitor as unknown as {
        lastNotifiedAt: Map<string, number>;
      }).lastNotifiedAt;
      for (const k of internalMap.keys()) {
        internalMap.set(k, Date.now() - THROTTLE_WINDOW_MS - 1);
      }
      await h.monitor.poll();
      expect(h.messageSessionMock.mock.calls.length).toBe(2);
    });
  });

  describe('surface delivery', () => {
    test('sends finding to director via messageSession', async () => {
      const worker = makeAgent('el-w-surf', 'Surf');
      const session = makeSession('sess-surf', worker.id);
      h.agents.set(worker.id, worker);
      h.sessions.push(session);
      const emitter = new EventEmitter();
      h.emitters.set(session.id, emitter);

      h.monitor.attachToSession(session.id);
      emitter.emit('pty-data', 'Authentication required\n');

      h.messageSessionMock.mockClear();
      await h.monitor.poll();

      expect(h.messageSessionMock.mock.calls.length).toBe(1);
      const [sessionId, options] = h.messageSessionMock.mock.calls[0] as [
        string,
        { content: string; senderId?: unknown },
      ];
      expect(sessionId).toBe(h.directorSession.id);
      expect(options.content).toContain('[HEALTH-MONITOR]');
      expect(options.content).toContain('auth_loss');
      // GUARD-1 invariant: never address the message FROM the recipient
      expect(options.senderId).not.toBe(h.director.id);
    });

    test('does not throw when no director is registered', async () => {
      // Override agentRegistry to return no director
      const noDirectorMonitor = new HealthMonitor(
        { get: async () => undefined } as unknown as QuarryAPI,
        { getInbox: () => [] } as unknown as InboxService,
        {
          listSessions: () => [],
          getActiveSession: () => undefined,
          getEventEmitter: () => undefined,
          messageSession: mock(async () => ({ success: true })),
        } as unknown as SessionManager,
        { getAgent: async () => undefined, getDirector: async () => undefined } as unknown as AgentRegistry,
      );
      await expect(noDirectorMonitor.poll()).resolves.toEqual([]);
    });
  });
});
