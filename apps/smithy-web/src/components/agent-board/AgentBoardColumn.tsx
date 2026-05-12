import { Crown, Zap, Shield, Circle, GitBranch, AlertCircle } from 'lucide-react';
import type { Agent, Task, TaskStatus, Priority } from '../../api/types';

interface AgentBoardColumnProps {
  agent: Agent;
  sessionStatus: 'running' | 'idle' | 'suspended' | 'terminated' | 'starting';
  tasks: Task[];
  onOpenTerminal: (agentId: string) => void;
}

const roleIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  director: Crown,
  worker: Zap,
  steward: Shield,
};

const sessionColors: Record<string, { dot: string; label: string; border: string; header: string }> = {
  running: {
    dot: 'bg-[var(--color-success)]',
    label: 'text-[var(--color-success-text)]',
    border: 'border-[var(--color-success)]',
    header: 'bg-[var(--color-success-muted)]',
  },
  idle: {
    dot: 'bg-[var(--color-text-tertiary)]',
    label: 'text-[var(--color-text-secondary)]',
    border: 'border-[var(--color-border)]',
    header: 'bg-[var(--color-surface-elevated)]',
  },
  suspended: {
    dot: 'bg-[var(--color-warning)]',
    label: 'text-[var(--color-warning-text)]',
    border: 'border-[var(--color-warning)]',
    header: 'bg-[var(--color-warning-muted)]',
  },
  terminated: {
    dot: 'bg-[var(--color-text-disabled)]',
    label: 'text-[var(--color-text-tertiary)]',
    border: 'border-[var(--color-border-subtle)]',
    header: 'bg-[var(--color-surface)]',
  },
  starting: {
    dot: 'bg-[var(--color-info)]',
    label: 'text-[var(--color-info-text)]',
    border: 'border-[var(--color-info)]',
    header: 'bg-[var(--color-info-muted)]',
  },
};

const statusBadge: Record<TaskStatus, { bg: string; text: string; label: string }> = {
  open: { bg: 'bg-[var(--color-info-muted)]', text: 'text-[var(--color-info-text)]', label: 'Open' },
  in_progress: { bg: 'bg-[var(--color-primary-muted)]', text: 'text-[var(--color-primary)]', label: 'In Progress' },
  blocked: { bg: 'bg-[var(--color-warning-muted)]', text: 'text-[var(--color-warning-text)]', label: 'Blocked' },
  review: { bg: 'bg-[var(--color-success-muted)]', text: 'text-[var(--color-success-text)]', label: 'Review' },
  backlog: { bg: 'bg-[var(--color-surface-elevated)]', text: 'text-[var(--color-text-secondary)]', label: 'Backlog' },
  deferred: { bg: 'bg-[var(--color-surface-elevated)]', text: 'text-[var(--color-text-tertiary)]', label: 'Deferred' },
  closed: { bg: 'bg-[var(--color-surface)]', text: 'text-[var(--color-text-tertiary)]', label: 'Closed' },
  tombstone: { bg: 'bg-[var(--color-surface)]', text: 'text-[var(--color-text-tertiary)]', label: 'Tombstone' },
};

// Priority 1 = highest (critical), 5 = lowest
const priorityColors: Record<Priority, string> = {
  1: 'bg-[var(--color-danger)]',
  2: 'bg-[var(--color-warning)]',
  3: 'bg-[var(--color-info)]',
  4: 'bg-[var(--color-text-tertiary)]',
  5: 'bg-[var(--color-border)]',
};

const priorityLabels: Record<Priority, string> = {
  1: 'P1',
  2: 'P2',
  3: 'P3',
  4: 'P4',
  5: 'P5',
};

function TaskCard({ task }: { task: Task }) {
  const badge = statusBadge[task.status] ?? statusBadge.open;
  const branch = task.metadata?.orchestrator?.branch;

  return (
    <div className="p-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] transition-colors space-y-2">
      {/* Priority dot + title */}
      <div className="flex items-start gap-2">
        <span
          className={`mt-1 flex-shrink-0 w-2 h-2 rounded-full ${priorityColors[task.priority]}`}
          title={priorityLabels[task.priority]}
        />
        <p className="text-sm text-[var(--color-text)] leading-snug line-clamp-2">{task.title}</p>
      </div>

      {/* Status + branch row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${badge.bg} ${badge.text}`}>
          {badge.label}
        </span>
        {branch && (
          <span className="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] font-mono min-w-0">
            <GitBranch className="w-3 h-3 flex-shrink-0" />
            <span className="truncate max-w-[10rem]">{branch}</span>
          </span>
        )}
      </div>
    </div>
  );
}

export function AgentBoardColumn({ agent, sessionStatus, tasks, onOpenTerminal }: AgentBoardColumnProps) {
  const colors = sessionColors[sessionStatus] ?? sessionColors.idle;
  const agentRole: string = agent.metadata?.agent?.agentRole ?? 'worker';
  const RoleIcon = roleIcons[agentRole] ?? Zap;

  // Sort: in_progress first, then by priority (lower = higher priority), then open
  const sorted = [...tasks].sort((a, b) => {
    const aActive = a.status === 'in_progress' ? 0 : a.status === 'review' ? 1 : 2;
    const bActive = b.status === 'in_progress' ? 0 : b.status === 'review' ? 1 : 2;
    if (aActive !== bActive) return aActive - bActive;
    return a.priority - b.priority;
  });

  return (
    <div className={`flex flex-col w-72 flex-shrink-0 rounded-lg border ${colors.border} overflow-hidden`}>
      {/* Column header */}
      <button
        onClick={() => onOpenTerminal(agent.id)}
        className={`flex items-center gap-2 px-3 py-2.5 ${colors.header} hover:opacity-90 transition-opacity text-left`}
        title="Open terminal"
      >
        <RoleIcon className="w-4 h-4 text-[var(--color-text-secondary)] flex-shrink-0" />
        <span className="text-sm font-medium text-[var(--color-text)] truncate flex-1">{agent.name}</span>
        <span className="flex items-center gap-1.5 flex-shrink-0">
          {sessionStatus === 'running' && (
            <span className={`w-2 h-2 rounded-full ${colors.dot} animate-pulse`} />
          )}
          {sessionStatus !== 'running' && (
            <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
          )}
          <span className={`text-xs capitalize ${colors.label}`}>{sessionStatus}</span>
        </span>
      </button>

      {/* Task count pill */}
      <div className="px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-elevated)] flex items-center justify-between">
        <span className="text-xs text-[var(--color-text-tertiary)]">
          {tasks.length === 0 ? 'No tasks' : `${tasks.length} task${tasks.length !== 1 ? 's' : ''}`}
        </span>
        {tasks.some(t => t.status === 'blocked') && (
          <span className="flex items-center gap-1 text-xs text-[var(--color-warning-text)]">
            <AlertCircle className="w-3 h-3" />
            blocked
          </span>
        )}
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[4rem] bg-[var(--color-surface)]">
        {sorted.length === 0 ? (
          <div className="py-6 text-center">
            <Circle className="w-6 h-6 text-[var(--color-text-disabled)] mx-auto mb-1" />
            <p className="text-xs text-[var(--color-text-tertiary)]">Idle</p>
          </div>
        ) : (
          sorted.map(task => <TaskCard key={task.id} task={task} />)
        )}
      </div>
    </div>
  );
}
