// SCRUM-131 (John 06:25): the transactions list on the Public and Private cloud views.
// Rows arrive already filtered by the page's All · Complete · Incomplete tabs.
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProviderBadge } from "@/components/cloud/cloud-type-badge";
import { IncompleteBadge } from "@/components/status-badges";
import { fmtCurrency, fmtNumber } from "@/lib/format";
import { isIncompleteTransaction, type CompletenessRow } from "@/lib/transaction-completeness";

export type ListRow = CompletenessRow & {
  id: string;
  potential_id: string | null;
  lab_name: string | null;
  customer_name: string | null;
  cloud_provider: string | null;
  selling_cost: number | null;
};

const MAX_ROWS = 8;

export function TransactionListCard<T extends ListRow>({
  title,
  rows,
  costOf,
}: {
  title: string;
  rows: readonly T[];
  costOf: (row: T) => number;
}) {
  const filtered = rows;
  const shown = filtered.slice(-MAX_ROWS).reverse();
  return (
    <Card className="min-w-0" data-testid="transaction-list-card">
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        <div className="mt-1 text-xs text-muted-foreground">
          Latest {fmtNumber(shown.length)} of {fmtNumber(filtered.length)}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {shown.length === 0 && (
          <div className="grid min-h-[96px] w-full place-items-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
            No transactions in this tab
          </div>
        )}
        {shown.map((row) => (
          <Link
            key={row.id}
            to="/transactions"
            search={{ q: row.potential_id ?? row.customer_name ?? "" } as never}
            className="block rounded-md border border-border px-3 py-2 hover:bg-muted/30"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium">
                  {row.potential_id ?? row.lab_name ?? row.id}
                </span>
                {isIncompleteTransaction(row) && <IncompleteBadge className="shrink-0" />}
              </div>
              <ProviderBadge value={row.cloud_provider} className="shrink-0" />
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {row.customer_name ?? "Unknown customer"} · Revenue {fmtCurrency(row.selling_cost)} ·
              Cost {fmtCurrency(costOf(row))}
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
