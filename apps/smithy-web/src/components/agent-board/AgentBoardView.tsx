import { useMemo } from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import type { Agent, Task } from '../../api/types';
import { AgentBoardColumn } from './AgentBoardColumn';

type BoardSessionStatus = 'running' | 'idle' | 'suspended' | 'terminated' | 'starting';

interface AgentBoardViewProps {
  directors: Agent[];
  workers: Agent[];
  tasks: Task[];
  sessionStatuses: Map<string, BoardSessionStatus>;
  isLoading: boolean;
  error: Error | null;
  onRefresh: () => void;
  onOpenTerminal: (agentId: string) => void;
}

export function AgentBoardView({
  directors,
  workers,
  tasks,
  sessionStatuses,
  isLoading,
  error,
  onRefresh,
  onOpenTerminal,
}: AgentBoardViewProps) {
  // All agents in display order: directors first, then workers
  const allAgents = useMemo(() => [...directors, ...workers], [directors, workers]);

  // Build per-agent task buckets (non-closed, non-tombstone, non-backlog)
  const tasksByAgent = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const agent of allAgents) map.set(agent.id, []);

    for (const task of tasks) {
      if (!task.assignee) continue;
      if (task.status === 'backlog' || task.status === 'closed' || task.status === 'tombstone') continue;
      const bucket = map.get(task.assignee);
      if (bucket) bucket.push(task);
    }
    return map;
  }, [allAgents, tasks]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-[var(--color-primary)] animate-spin mb-4" />
        <p className="text-sm text-[var(--color-text-secondary)]">Loading board...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 border border-dashed border-[var(--color-danger)] rounded-lg bg-[var(--color-danger-muted)]">
        <AlertCircle className="w-12 h-12 text-[var(--color-danger)] mb-4" />
        <h3 className="text-lg font-medium text-[var(--color-text)]">Failed to load board</h3>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)] text-center max-w-md">{error.message}</p>
        <button
          onClick={onRefresh}
          className="mt-4 flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--color-primary)] bg-[var(--color-surface)] rounded-md hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    );
  }

  if (allAgents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-[var(--color-text-secondary)]">No agents found. Create a director or worker to see the board.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-4 min-w-max">
        {allAgents.map(agent => (
          <AgentBoardColumn
            key={agent.id}
            agent={agent}
            sessionStatus={sessionStatuses.get(agent.id) ?? 'idle'}
            tasks={tasksByAgent.get(agent.id) ?? []}
            onOpenTerminal={onOpenTerminal}
          />
        ))}
      </div>
    </div>
  );
}
