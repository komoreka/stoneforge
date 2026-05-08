import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useDaemonStatus } from '../../api/hooks/useDaemon';

interface DispatchHealthBannerProps {
  /** Optional layout classes applied to the outer banner element. Lets each mount site control its own page-specific padding without leaving an empty wrapper when the banner self-hides. */
  className?: string;
}

export function DispatchHealthBanner({ className }: DispatchHealthBannerProps = {}) {
  const { data } = useDaemonStatus();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const health = data?.health;
  // pollStale is the more critical signal: the daemon's poll loop is wedged
  // and dispatch/scheduling/recovery have all stopped. Render this banner
  // first when both conditions hold; users can't act on a stuck queue if
  // the daemon itself is broken.
  const pollStale = health?.pollStale === true;
  const hasStuckQueue = health?.hasStuckQueue === true;

  if (!pollStale && !hasStuckQueue) return null;

  // Red for poll-stale (daemon wedged); amber for stuck-queue (waiting on
  // operator action). Different urgency, different colors.
  const baseClasses = pollStale
    ? 'mb-4 flex items-start gap-3 px-4 py-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-700 text-red-900 dark:text-red-100'
    : 'mb-4 flex items-start gap-3 px-4 py-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100';

  const hoverClasses = pollStale
    ? 'p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors'
    : 'p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors';

  const headline = pollStale ? 'Dispatch daemon is wedged.' : 'Dispatch is stuck.';

  // Compute approximate stuck duration for the message body. Falls back to
  // "for a while" when timestamps are missing — copy stays readable.
  const lastCompletedAt = health?.lastPollCompletedAt;
  let stuckForCopy = 'for a while';
  if (lastCompletedAt) {
    const ageMin = Math.round((Date.now() - new Date(lastCompletedAt).getTime()) / 60000);
    if (ageMin >= 1) stuckForCopy = `for over ${ageMin} minute${ageMin === 1 ? '' : 's'}`;
  }

  const body = pollStale
    ? `Poll loop has not completed a cycle ${stuckForCopy}. The HTTP server is responsive but dispatch, scheduling, and recovery have stopped. Restart with \`sf serve smithy\` to recover.`
    : `${health?.readyUnassignedTasks ?? 0} task(s) ready, no available workers. Register or enable a worker to start dispatching.`;

  const testId = pollStale ? 'dispatch-health-banner-poll-stale' : 'dispatch-health-banner';

  return (
    <div
      className={className ? `${className} ${baseClasses}` : baseClasses}
      data-testid={testId}
      role="alert"
    >
      <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0 text-sm">
        <div className="font-medium">{headline}</div>
        <div className="mt-1">{body}</div>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className={hoverClasses}
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
