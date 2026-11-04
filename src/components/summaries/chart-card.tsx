// SCRUM-128 plan §4.3 (C4): the one chart card (extracted from ai-command-center-summary.tsx).
// Pages put a recharts chart inside: ResponsiveContainer width="100%" height={CHART_HEIGHT} with
// the lib/chart-standard.ts props. Legends that carry numbers use ChartLegendRow.
import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function ChartCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  /** A header action, usually a "View all →" link (`text-xs text-primary hover:underline`). */
  action?: ReactNode;
  children: ReactNode;
  /** Layout only (grid placement, min-w-0); never colour, border, radius or shadow. */
  className?: string;
}) {
  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader
        className={cn(
          action && "flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between",
        )}
      >
        <div className="min-w-0 space-y-1.5">
          <CardTitle className="text-sm">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export type ChartLegendItem = {
  label: string;
  /** Optional value after the label, e.g. "₹7.4L" or "38.4%". */
  value?: string;
  /** A literal series class from chart-standard.ts (CHART_SERIES_BG / chartSeriesBg). */
  dotClass: string;
};

/** Legend row with numbers ("Revenue ₹… · Input cost ₹… · Margin …%"); no inline style. */
export function ChartLegendRow({ items }: { items: readonly ChartLegendItem[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="flex min-w-0 items-center gap-1.5">
          <span className={cn("size-2 shrink-0 rounded-full", item.dotClass)} aria-hidden />
          <span className="truncate">{item.label}</span>
          {item.value && <span className="tabular-nums text-foreground">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}
