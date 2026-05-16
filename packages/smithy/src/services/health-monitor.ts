/**
 * Health Monitor
 *
 * In-process detection-only service that watches for daemon misroutes and
 * silent worker auth-loss, surfacing findings to the Director's session.
 *
 * Detects three failure modes:
 *
 *   1. Self-addressed daemon pings — messages in an agent's inbox where the
 *      sender is the recipient itself. Post-GUARD-1 (PR #27) this should be
 *      zero; the detector is a regression sentinel.
 *
 *   2. Repeat-identical dispatches — the same message content delivered to
 *      the same agent ≥ REPEAT_THRESHOLD times within REPEAT_WINDOW_MS. The
 *      classic Bug 5 / Bug 9 misroute signature.
 *
 *   3. Worker auth-loss — PTY output from a running worker session contains
 *      one of AUTH_LOSS_MARKERS (e.g. "Please run /login"). Indicates the
 *      Claude Code session lost credentials and is silently no-op despite
 *      sf agent show reporting status: running.
 *
 * On detection: surface to the Director via messageSession (real-time if the
 * Director's session is up) and operationLog.write (persistent audit). Each
 * (agentId, issueType) pair is throttled to one surface per
 * THROTTLE_WINDOW_MS so a stuck condition does not flood the Director.
 *
 * Detection only — does not auto-close tasks, auto-stop agents, or modify
 * any task / orchestrator metadata. Operator decides response.
 *
 * @module
 */

import type { EventEmitter } from 'node:events';
import type { QuarryAPI, InboxService } from '@stoneforge/quarry';
import type { Message, EntityId, InboxItem } from '@stoneforge/core';
import { asElementId } from '@stoneforge/core';
import type { SessionManager } from '../runtime/session-manager.js';
import type { AgentRegistry } from './agent-registry.js';
import type { AgentEntity } from '../api/orchestrator-api.js';
import type { OperationLogService } from './operation-log-service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('health-monitor');

// ============================================================================
// Constants
// ============================================================================

/** Sliding window for repeat-identical-dispatch detection. */
export const REPEAT_WINDOW_MS = 60_000; // 60 seconds

/** Threshold for repeat-identical-dispatch detection within the window. */
export const REPEAT_THRESHOLD = 3;

/** Sliding window for self-addressed ping detection. */
export const SELF_PING_WINDOW_MS = 5 * 60_000; // 5 minutes

/** Threshold for self-addressed ping detection within the window. */
export const SELF_PING_THRESHOLD = 2;

/** Per-(agent, issue) throttle for surfacing findings to Director. */
export const THROTTLE_WINDOW_MS = 10 * 60_000; // 10 minutes

/** Max bytes of PTY output buffered per session for auth-loss scanning. */
export const PTY_BUFFER_SIZE_BYTES = 4096;

/**
 * Markers in PTY output that indicate a worker has lost authentication.
 * Matched case-insensitive against the rolling output buffer.
 */
export const AUTH_LOSS_MARKERS: ReadonlyArray<RegExp> = [
  /Please run \/login/i,
  /Not logged in/i,
  /Session expired/i,
  /Authentication required/i,
];

// ============================================================================
// Types
// ============================================================================

export type HealthIssueType =
  | 'auth_loss'
  | 'self_addressed_ping'
  | 'repeat_identical_dispatch';

export interface HealthFinding {
  agentId: EntityId;
  agentName: string;
  issueType: HealthIssueType;
  /** Short human-readable evidence (1-5 lines max). */
  evidence: string;
  /** One-line operator recommendation. */
  suggestedAction: string;
}

// ============================================================================
// Health Monitor
// ============================================================================

export class HealthMonitor {
  private readonly outputBuffers = new Map<string, string>(); // sessionId → rolling buffer
  private readonly subscribedSessions = new Set<string>();
  private readonly lastNotifiedAt = new Map<string, number>(); // `${agentId}|${issueType}` → ts

  constructor(
    private readonly api: QuarryAPI,
    private readonly inboxService: InboxService,
    private readonly sessionManager: SessionManager,
    private readonly agentRegistry: AgentRegistry,
    private readonly operationLog?: OperationLogService
  ) {}

  /**
   * Subscribe to PTY events on a session so we can scan output for auth-loss
   * markers. Safe to call repeatedly — idempotent on sessionId.
   */
  attachToSession(sessionId: string): void {
    if (this.subscribedSessions.has(sessionId)) return;

    const emitter: EventEmitter | undefined = this.sessionManager.getEventEmitter(sessionId);
    if (!emitter) return;

    this.subscribedSessions.add(sessionId);
    this.outputBuffers.set(sessionId, '');

    const onPtyData = (data: unknown): void => {
      const current = this.outputBuffers.get(sessionId) ?? '';
      const chunk = typeof data === 'string' ? data : String(data);
      const merged = current + chunk;
      // Keep only the trailing PTY_BUFFER_SIZE_BYTES — sufficient context for
      // any auth-loss marker (each is <30 chars).
      const trimmed = merged.length > PTY_BUFFER_SIZE_BYTES
        ? merged.slice(merged.length - PTY_BUFFER_SIZE_BYTES)
        : merged;
      this.outputBuffers.set(sessionId, trimmed);
    };

    emitter.on('pty-data', onPtyData);
    emitter.on('stderr', onPtyData);
  }

  /**
   * Drop buffered state for a session that has ended. Listeners are dropped
   * automatically by the session manager when the underlying emitter is
   * released; we just stop tracking the buffer.
   */
  detachFromSession(sessionId: string): void {
    this.subscribedSessions.delete(sessionId);
    this.outputBuffers.delete(sessionId);
  }

  /**
   * Refresh subscriptions to match the currently active sessions. Call
   * before running detection so newly-started sessions are captured.
   */
  syncSubscriptions(): void {
    const liveSessionIds = new Set(
      this.sessionManager.listSessions().map((s) => s.id)
    );
    // Subscribe to any new sessions
    for (const id of liveSessionIds) {
      if (!this.subscribedSessions.has(id)) {
        this.attachToSession(id);
      }
    }
    // Drop buffers for sessions that have ended
    for (const id of this.subscribedSessions) {
      if (!liveSessionIds.has(id)) {
        this.detachFromSession(id);
      }
    }
  }

  /**
   * Run all three detectors against the current state. Returns deduplicated
   * findings keyed by (agentId, issueType) — at most one finding per pair
   * per poll cycle.
   */
  async runDetection(): Promise<HealthFinding[]> {
    this.syncSubscriptions();

    const findings: HealthFinding[] = [];
    const dedupKey = new Set<string>();
    const pushOnce = (f: HealthFinding): void => {
      const k = `${f.agentId}|${f.issueType}`;
      if (dedupKey.has(k)) return;
      dedupKey.add(k);
      findings.push(f);
    };

    // 1. Auth-loss scan: per active session, check buffered PTY output for markers
    for (const session of this.sessionManager.listSessions()) {
      const buffer = this.outputBuffers.get(session.id) ?? '';
      if (!buffer) continue;
      const matched = AUTH_LOSS_MARKERS.find((re) => re.test(buffer));
      if (!matched) continue;

      const agent = await this.agentRegistry.getAgent(session.agentId);
      const agentName = agent?.name ?? String(session.agentId);
      pushOnce({
        agentId: session.agentId,
        agentName,
        issueType: 'auth_loss',
        evidence: this.extractMatchContext(buffer, matched),
        suggestedAction: `Worker ${agentName} session has lost authentication. Open the worker terminal and complete the /login flow, then re-dispatch any in-flight task.`,
      });
    }

    // 2. + 3. Inbox-based detection across all active agents
    const agents = await this.collectActiveAgents();
    for (const agent of agents) {
      const agentId = agent.id as unknown as EntityId;
      const inbox = this.inboxService.getInbox(agentId, { limit: 100 });
      const now = Date.now();

      // 2. Self-addressed pings (post-GUARD-1 should be zero — regression sentinel)
      const selfAddressed = await this.filterSelfAddressed(inbox, agentId, now);
      if (selfAddressed.length >= SELF_PING_THRESHOLD) {
        pushOnce({
          agentId,
          agentName: agent.name,
          issueType: 'self_addressed_ping',
          evidence: `${selfAddressed.length} self-addressed messages in inbox within last ${Math.floor(SELF_PING_WINDOW_MS / 60_000)} min ` +
            `(GUARD-1 should have prevented this — possible regression). Latest: ${selfAddressed[0]?.createdAt}`,
          suggestedAction: `File a bug — GUARD-1 in dispatch-daemon should reject sender==recipient. Operator action: sf task close <task-id> if known, or restart the daemon.`,
        });
      }

      // 3. Repeat-identical dispatches
      const repeatGroups = await this.findRepeatIdenticalGroups(inbox, now);
      for (const group of repeatGroups) {
        pushOnce({
          agentId,
          agentName: agent.name,
          issueType: 'repeat_identical_dispatch',
          evidence: `${group.count} identical messages received within ${Math.floor(REPEAT_WINDOW_MS / 1000)}s. ` +
            `Content hash: ${group.contentHash.slice(0, 12)}. Likely Bug 5 (orchestrator metadata divergence) or Bug 9 (session-affinity misroute).`,
          suggestedAction: `Inspect with: sf inbox ${agentId} --limit 5. Resolve with sf task close <task-id> or sf task assign <task-id> <correct-agent>.`,
        });
      }
    }

    return findings;
  }

  /**
   * Surface findings to the Director, subject to per-(agent, issue) throttle.
   * Delivers via messageSession when the Director has an active session, and
   * always emits an operation-log entry for persistent audit.
   */
  async surfaceFindings(findings: HealthFinding[]): Promise<void> {
    if (findings.length === 0) return;

    const director = await this.agentRegistry.getDirector();
    const directorSession = director
      ? this.sessionManager.getActiveSession(director.id as unknown as EntityId)
      : undefined;

    const now = Date.now();
    for (const finding of findings) {
      const throttleKey = `${finding.agentId}|${finding.issueType}`;
      const lastNotified = this.lastNotifiedAt.get(throttleKey) ?? 0;
      if (now - lastNotified < THROTTLE_WINDOW_MS) {
        continue;
      }

      // Persistent record — always written. We use the 'recovery' category
      // because operation-log-service does not (yet) have a dedicated
      // 'health' category; the [HEALTH-MONITOR] prefix in the message makes
      // these entries grep-able.
      this.operationLog?.write(
        'warn',
        'recovery',
        `[HEALTH-MONITOR] ${finding.issueType} on ${finding.agentName} (${finding.agentId}): ${finding.evidence}`,
        { agentId: finding.agentId, issueType: finding.issueType, suggestedAction: finding.suggestedAction }
      );
      logger.warn(
        `[HEALTH-MONITOR] ${finding.issueType} on ${finding.agentName} (${finding.agentId}). ` +
        `Evidence: ${finding.evidence}. Action: ${finding.suggestedAction}`
      );

      // Real-time surface to Director if their session is alive
      if (directorSession) {
        const content =
          `[HEALTH-MONITOR] ${new Date().toISOString()}\n` +
          `Issue: ${finding.issueType}  Agent: ${finding.agentId} (${finding.agentName})\n` +
          `${finding.evidence}\n` +
          `Suggested action: ${finding.suggestedAction}`;
        await this.sessionManager.messageSession(directorSession.id, {
          content,
          // senderId omitted — defaults to 'system' (same pattern as GUARD-1 fix)
        });
      }

      this.lastNotifiedAt.set(throttleKey, now);
    }
  }

  /**
   * One-shot detection + surfacing pass. Called by the daemon poll cycle.
   */
  async poll(): Promise<HealthFinding[]> {
    const findings = await this.runDetection();
    await this.surfaceFindings(findings);
    return findings;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private extractMatchContext(buffer: string, pattern: RegExp): string {
    const match = buffer.match(pattern);
    if (!match || match.index === undefined) return '(marker matched but context unavailable)';
    const start = Math.max(0, match.index - 40);
    const end = Math.min(buffer.length, match.index + match[0].length + 40);
    return buffer.slice(start, end).replace(/[\r\n]+/g, ' ').trim();
  }

  private async collectActiveAgents(): Promise<AgentEntity[]> {
    // Workers + stewards + directors with an active session, deduped.
    const sessions = this.sessionManager.listSessions();
    const agentIds = new Set<string>(sessions.map((s) => String(s.agentId)));
    const agents: AgentEntity[] = [];
    for (const id of agentIds) {
      const agent = await this.agentRegistry.getAgent(id as unknown as EntityId);
      if (agent) agents.push(agent);
    }
    return agents;
  }

  private async filterSelfAddressed(
    inbox: InboxItem[],
    recipientId: EntityId,
    now: number
  ): Promise<InboxItem[]> {
    const cutoff = now - SELF_PING_WINDOW_MS;
    const recent = inbox.filter((item) => {
      const ts = Date.parse(item.createdAt);
      return Number.isFinite(ts) && ts >= cutoff;
    });

    const selfAddressed: InboxItem[] = [];
    for (const item of recent) {
      const msg = await this.api.get<Message>(asElementId(item.messageId));
      if (msg && String(msg.sender) === String(recipientId)) {
        selfAddressed.push(item);
      }
    }
    return selfAddressed;
  }

  private async findRepeatIdenticalGroups(
    inbox: InboxItem[],
    now: number
  ): Promise<Array<{ contentHash: string; count: number }>> {
    const cutoff = now - REPEAT_WINDOW_MS;
    const recent = inbox.filter((item) => {
      const ts = Date.parse(item.createdAt);
      return Number.isFinite(ts) && ts >= cutoff;
    });

    // Group by message content hash. We hash on the contentRef + sender pair
    // — two identical dispatches will reference the same content doc, even if
    // they create new message entities each time.
    const counts = new Map<string, number>();
    for (const item of recent) {
      const msg = await this.api.get<Message>(asElementId(item.messageId));
      if (!msg) continue;
      const hashKey = `${String(msg.sender)}|${String(msg.contentRef ?? msg.id)}`;
      counts.set(hashKey, (counts.get(hashKey) ?? 0) + 1);
    }

    const groups: Array<{ contentHash: string; count: number }> = [];
    for (const [hash, count] of counts) {
      if (count >= REPEAT_THRESHOLD) {
        groups.push({ contentHash: hash, count });
      }
    }
    return groups;
  }
}

export function createHealthMonitor(
  api: QuarryAPI,
  inboxService: InboxService,
  sessionManager: SessionManager,
  agentRegistry: AgentRegistry,
  operationLog?: OperationLogService
): HealthMonitor {
  return new HealthMonitor(api, inboxService, sessionManager, agentRegistry, operationLog);
}
