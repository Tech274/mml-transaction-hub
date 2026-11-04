// SCRUM-128 plan §4.4 (C4): the one empty state for charts (extracted from
// ai-command-center-summary.tsx). Same height as a chart (CHART_HEIGHT), or `compact` for lists.
import { cn } from "@/lib/utils";

export function NoDataYet({
  message = "No data yet",
  compact = false,
  className,
}: {
  message?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid w-full place-items-center rounded-md border border-dashed border-border px-3 text-center text-sm text-muted-foreground",
        compact ? "min-h-24" : "min-h-[260px]",
        className,
      )}
      data-testid="no-data-yet"
    >
      {message}
    </div>
  );
}
