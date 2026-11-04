// SCRUM-128 S0/S5 + plan §4.2: one shared KPI tile.
// SCRUM-131: `note` is the incomplete-rows caveat, shown directly under the value in the
// warning colour with an icon (short form; long form in `noteTitle`). Hidden when empty.
// SCRUM-128 C4: `delta` follows the delta standard in lib/kpi-period.ts (signed with U+2212,
// arrow icon, named comparison, sr-only sentence); adds `sublineTone`, `to`/`search` (the whole
// tile is a link) and `KpiGrid`. Peter's props, test ids and grid constants are unchanged.
import type { ReactNode } from "react";
import { Link, type LinkProps } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, CircleAlert, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  formatKpiDelta,
  formatKpiPeriod,
  kpiDeltaA11yLabel,
  kpiDeltaDirection,
  kpiDeltaTone,
  type KpiDelta,
  type KpiPeriod,
} from "@/lib/kpi-period";
import { cn } from "@/lib/utils";

export type { KpiDelta } from "@/lib/kpi-period";

export type SummaryKpiProps = {
  /** Sentence case, no pill, no uppercase. */
  label: string;
  /** Pre-formatted (fmtCurrency / fmtNumber / "38.4%"). */
  value: string;
  /** REQUIRED: the time span the value covers, from lib/kpi-period.ts (kpiPeriodFor). Always rendered. */
  period: KpiPeriod;
  /** Signed change vs a named comparison period, e.g. "−17 lines vs Aug 2026". */
  delta?: KpiDelta | null;
  /** Inline caveat under the value, e.g. "12 incomplete · ₹1.2L". Not rendered when empty. */
  note?: string | null;
  /** Long form of the note for hover, e.g. "Includes 12 incomplete rows · ₹1,20,000". */
  noteTitle?: string | null;
  /** Context only (breakdown, provider): never a period word and never a delta. */
  subline?: string;
  /** Colours the subline only (e.g. "Needs action"); not for deltas. */
  sublineTone?: "neutral" | "positive" | "negative";
  /** The whole tile becomes a link. */
  to?: LinkProps["to"];
  search?: LinkProps["search"];
  /** "inset" when the tile sits inside another card. */
  variant?: "card" | "inset";
};

const TONE_CLASS = {
  positive: "text-success",
  negative: "text-destructive",
  neutral: "text-muted-foreground",
} as const;

function KpiDeltaLine({ delta }: { delta: KpiDelta }) {
  const dir = kpiDeltaDirection(delta);
  const Icon = dir === "up" ? ArrowUp : dir === "down" ? ArrowDown : Minus;
  const text = formatKpiDelta(delta);
  return (
    <div
      className={cn(
        "mt-1 flex min-w-0 items-center gap-1 text-xs",
        TONE_CLASS[kpiDeltaTone(delta)],
      )}
      data-testid="kpi-delta"
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {/* The visible text is the sign + number; screen readers get the full sentence instead. */}
      <span className="truncate tabular-nums" title={text} aria-hidden>
        {text}
      </span>
      <span className="sr-only">{kpiDeltaA11yLabel(delta)}</span>
    </div>
  );
}

export function SummaryKpi({
  label,
  value,
  subline,
  sublineTone = "neutral",
  note,
  noteTitle,
  period,
  delta,
  to,
  search,
  variant = "card",
}: SummaryKpiProps) {
  const periodText = formatKpiPeriod(period);
  const body: ReactNode = (
    <>
      <div className="truncate text-xs text-muted-foreground" title={label}>
        {label}
      </div>
      <div
        className="mt-1 truncate text-xl font-semibold tabular-nums"
        title={value}
        data-testid="kpi-value"
      >
        {value}
      </div>
      {note && (
        <div
          className="mt-1 flex min-w-0 items-center gap-1 text-xs text-warning"
          title={noteTitle ?? note}
          data-testid="kpi-incomplete-note"
        >
          <CircleAlert className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{note}</span>
        </div>
      )}
      {delta && <KpiDeltaLine delta={delta} />}
      {/* Order per plan §4.2: label, value, note, delta, period, subline. */}
      <div
        className="mt-1 truncate text-xs text-muted-foreground"
        title={periodText}
        data-testid="kpi-period"
      >
        {periodText}
      </div>
      {subline && (
        <div className={cn("mt-1 truncate text-xs", TONE_CLASS[sublineTone])} title={subline}>
          {subline}
        </div>
      )}
    </>
  );
  const isLink = to !== undefined;
  const tile =
    variant === "inset" ? (
      <div
        className={cn(
          "min-w-0 rounded-md border border-border px-3 py-2",
          isLink && "transition-colors hover:bg-muted/30",
        )}
      >
        {body}
      </div>
    ) : (
      <Card className={cn("min-w-0", isLink && "transition-colors hover:border-primary")}>
        <CardContent className="pt-5">{body}</CardContent>
      </Card>
    );
  if (!isLink) return tile;
  return (
    <Link
      to={to}
      search={search}
      className={cn(
        "block min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        variant === "inset" ? "rounded-md" : "rounded-xl",
      )}
    >
      {tile}
    </Link>
  );
}

/** KPI grid (S4). At most 8 tiles per grid (plan §4.2). */
export const KPI_GRID_CLASS = "grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4";
/** Inset tiles inside a card. */
export const KPI_INSET_GRID_CLASS = "grid gap-2 grid-cols-2 xl:grid-cols-3";
/** Most tiles a grid may hold (two rows at xl); a ninth fact goes into a card, note or subline. */
export const KPI_GRID_MAX_TILES = 8;

/** The KPI grid: 1 / 2 / 4 columns (`KPI_GRID_CLASS`), or the inset grid inside a card. */
export function KpiGrid({
  children,
  inset = false,
  className,
}: {
  children: ReactNode;
  inset?: boolean;
  className?: string;
}) {
  return (
    <div className={cn(inset ? KPI_INSET_GRID_CLASS : KPI_GRID_CLASS, className)}>{children}</div>
  );
}
