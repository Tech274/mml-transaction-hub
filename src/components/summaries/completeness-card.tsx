// SCRUM-131 (spec §129.4a; plan G1/G2): one "Completeness" card with Complete and
// Incomplete groups (count, revenue, input cost, users). Incomplete rows are still
// counted in every total on the page; this card only shows the split. It sits at the top
// of the view and is never filtered by the All · Complete · Incomplete tabs (plan §4.11).
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SummaryKpi } from "@/components/summaries/summary-kpi";
import { fmtCurrency, fmtNumber } from "@/lib/format";
import type { CompletenessTotals } from "@/lib/transaction-completeness";
import type { KpiPeriod } from "@/lib/kpi-period";

export function CompletenessCard({
  complete,
  incomplete,
  onViewIncomplete,
  period,
}: {
  /** The view's completeness period (kpiPeriodFor("cloud.completeness")). */
  period: KpiPeriod;
  complete: CompletenessTotals;
  incomplete: CompletenessTotals;
  /** Opens the Incomplete tab (?completeness=incomplete). */
  onViewIncomplete?: () => void;
}) {
  const total = complete.count + incomplete.count;
  return (
    <Card className="min-w-0" data-testid="completeness-card">
      <CardHeader>
        <CardTitle className="text-sm">Completeness</CardTitle>
        <CardDescription className="text-xs">
          Incomplete = a price missing or 0, or a required field blank. Both groups are counted in
          the totals below.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        <SummaryKpi
          period={period}
          variant="inset"
          label="Complete"
          value={fmtNumber(complete.count)}
          subline={`${fmtCurrency(complete.sellingCost)} revenue · ${fmtCurrency(complete.inputCost)} cost · ${fmtNumber(complete.users)} users · of ${fmtNumber(total)} rows`}
        />
        <SummaryKpi
          period={period}
          variant="inset"
          label="Incomplete"
          value={fmtNumber(incomplete.count)}
          subline={`${fmtCurrency(incomplete.sellingCost)} revenue · ${fmtCurrency(incomplete.inputCost)} cost · ${fmtNumber(incomplete.users)} users · needs correcting`}
        />
        {onViewIncomplete && incomplete.count > 0 && (
          <div className="sm:col-start-2">
            <button
              type="button"
              onClick={onViewIncomplete}
              className="text-xs font-medium text-primary hover:underline"
            >
              View incomplete →
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
