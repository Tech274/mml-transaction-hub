import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { fmtCurrency, fmtDate, fmtDateTime, fmtNumber, MONTH_NAMES } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/lib/auth-context";
import { TransactionEditForm } from "@/components/transaction-edit-form";

export function TransactionDetailDrawer({
  transactionId, open, onOpenChange,
}: { transactionId: string | null; open: boolean; onOpenChange: (b: boolean) => void }) {
  const { canEditTransactions } = useAuth();
  const { data: tx } = useQuery({
    queryKey: ["transaction", transactionId],
    enabled: !!transactionId && open,
    queryFn: async () => {
      const { data, error } = await supabase.from("transactions").select("*").eq("id", transactionId!).single();
      if (error) throw error;
      return data;
    },
  });
  const { data: activity = [] } = useQuery({
    queryKey: ["activity", transactionId],
    enabled: !!transactionId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transaction_activity_log").select("*")
        .eq("transaction_id", transactionId!)
        .order("changed_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-hidden flex flex-col">
        <SheetHeader>
          <SheetTitle>{tx?.potential_id ?? "Transaction"}</SheetTitle>
          <SheetDescription>{tx?.lab_name}</SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1 -mx-6 px-6">
          {tx && (
            <div className="space-y-6 mt-2 pb-6">
              <div className="flex flex-wrap gap-2">
                <Badge variant={tx.repository_type === "public_cloud" ? "default" : "secondary"}>
                  {tx.repository_type === "public_cloud" ? "Public Cloud" : "Private Cloud"}
                </Badge>
                <Badge variant="outline">{tx.cloud_provider}</Badge>
                <Badge variant="outline">{tx.line_of_business}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <DL label="Customer" value={tx.customer_name} />
                <DL label="Lab" value={tx.lab_name} />
                <DL label="Period" value={tx.month ? `${MONTH_NAMES[tx.month - 1]} ${tx.year ?? ""}` : "—"} />
                <DL label="Start date" value={fmtDate(tx.start_date)} />
                <DL label="End date" value={fmtDate(tx.end_date)} />
                <DL label="Total users" value={fmtNumber(tx.total_users)} />
                <DL label="Input cost" value={fmtCurrency(tx.input_cost)} />
                <DL label="Selling cost" value={fmtCurrency(tx.selling_cost)} />
                <DL label="Profit" value={
                  tx.selling_cost == null && tx.input_cost == null
                    ? "—"
                    : fmtCurrency(Number(tx.selling_cost ?? 0) - Number(tx.input_cost ?? 0))
                } />
                <DL label="Created" value={fmtDateTime(tx.created_at)} />
                <DL label="Last updated" value={fmtDateTime(tx.updated_at)} />
              </div>
              {canEditTransactions && (
                <>
                  <Separator />
                  <div>
                    <h3 className="text-sm font-semibold mb-3">Edit transaction</h3>
                    <TransactionEditForm tx={tx} />
                  </div>
                </>
              )}
              <Separator />
              <div>
                <h3 className="text-sm font-semibold mb-3">Activity history</h3>
                <div className="space-y-3">
                  {activity.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
                  {activity.map((a) => (
                    <div key={a.id} className="text-xs border-l-2 border-border pl-3 py-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">{a.action}</Badge>
                        <span className="text-muted-foreground">{fmtDateTime(a.changed_at)}</span>
                      </div>
                      {a.field_name && (
                        <div className="mt-1">
                          <span className="font-medium">{a.field_name}:</span>{" "}
                          <span className="text-muted-foreground line-through">{a.old_value ?? "∅"}</span>
                          {" → "}
                          <span>{a.new_value ?? "∅"}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function DL({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
