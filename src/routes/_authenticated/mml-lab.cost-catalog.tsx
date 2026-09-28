import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { requireRouteRoles } from "@/lib/route-guard";
import { customVmQuote, type RateMap } from "@/lib/cost-calculator";
import { fmtCurrency } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/mml-lab/cost-catalog")({
  beforeLoad: requireRouteRoles("/mml-lab/cost-catalog"),
  component: CostCatalogPage,
});

type Tier = {
  id: string;
  code: string;
  vcpu: number;
  ram_gb: number;
  storage_gb: number | null;
  price_per_day: number | null;
  selling_price_per_day: number | null;
  internal_cost_per_day: number | null;
  is_active: boolean;
  updated_at: string;
};

const RATE_LABEL: Record<string, string> = {
  vcpu_per_day: "Per vCPU / day",
  ram_gb_per_day: "Per GB RAM / day",
  storage_gb_per_day: "Per GB storage / day",
  private_input_cost_pct: "Private input cost % of selling price",
};

function CostCatalogPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const [calc, setCalc] = useState({
    vcpu: "4",
    ramGb: "16",
    storageGb: "100",
    days: "30",
    vms: "20",
  });
  const [draftTiers, setDraftTiers] = useState<
    Record<string, { selling: string; internal: string }>
  >({});
  const [draftRates, setDraftRates] = useState<Record<string, string>>({});
  const [newTier, setNewTier] = useState({
    code: "",
    vcpu: "",
    ram: "",
    storage: "",
    selling: "",
    internal: "",
  });

  const { data: tiers = [] } = useQuery({
    queryKey: ["vm-tiers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vm_tiers").select("*").order("sort_order");
      if (error) throw error;
      return (data ?? []) as Tier[];
    },
  });
  const { data: rates = [] } = useQuery({
    queryKey: ["cost-rates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cost_rates")
        .select("key, value, unit, updated_at")
        .order("key");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: history = [] } = useQuery({
    queryKey: ["catalog-audit"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_audit_log")
        .select("id, table_name, row_key, field_name, old_value, new_value, reason, changed_at")
        .order("changed_at", { ascending: false })
        .limit(50);
      if (error) return [];
      return data ?? [];
    },
  });

  const rateMap: RateMap = useMemo(() => {
    const get = (k: string) => {
      const row = rates.find((r) => r.key === k);
      return row?.value == null ? null : Number(row.value);
    };
    return {
      vcpu_per_day: get("vcpu_per_day"),
      ram_gb_per_day: get("ram_gb_per_day"),
      storage_gb_per_day: get("storage_gb_per_day"),
    };
  }, [rates]);

  const quote = customVmQuote(
    {
      vcpu: Number(calc.vcpu),
      ramGb: Number(calc.ramGb),
      storageGb: Number(calc.storageGb),
      days: Number(calc.days),
      vms: Number(calc.vms),
    },
    rateMap,
    tiers
      .filter((t) => t.is_active)
      .map((t) => ({
        code: t.code,
        vcpu: t.vcpu,
        ramGb: t.ram_gb,
        storageGb: t.storage_gb,
        pricePerDay: t.selling_price_per_day ?? t.price_per_day,
      })),
  );

  function moneyOrNull(s: string): number | null {
    if (s.trim() === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  async function saveEdits() {
    if (reason.trim().length < 5) {
      toast.error("A reason of 5 to 300 characters is required");
      return;
    }
    for (const tier of tiers) {
      const d = draftTiers[tier.id];
      if (!d) continue;
      const selling = moneyOrNull(d.selling);
      const internal = moneyOrNull(d.internal);
      const { error } = await supabase.rpc("save_vm_tier", {
        p_id: tier.id,
        p_price_per_day: selling,
        p_selling_price_per_day: selling,
        p_internal_cost_per_day: internal,
        p_is_active: tier.is_active,
        p_reason: reason.trim(),
      });
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    for (const rate of rates) {
      if (!(rate.key in draftRates)) continue;
      const { error } = await supabase.rpc("save_cost_rate", {
        p_key: rate.key,
        p_value: moneyOrNull(draftRates[rate.key]),
        p_reason: reason.trim(),
      });
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    toast.success("Prices saved");
    setEditing(false);
    setReason("");
    qc.invalidateQueries({ queryKey: ["vm-tiers"] });
    qc.invalidateQueries({ queryKey: ["cost-rates"] });
    qc.invalidateQueries({ queryKey: ["catalog-audit"] });
  }

  async function deactivate(tier: Tier) {
    if (reason.trim().length < 5) {
      toast.error("Enter a reason before deactivating a tier");
      return;
    }
    const { error } = await supabase.rpc("save_vm_tier", {
      p_id: tier.id,
      p_price_per_day: tier.price_per_day,
      p_selling_price_per_day: tier.selling_price_per_day,
      p_internal_cost_per_day: tier.internal_cost_per_day,
      p_is_active: false,
      p_reason: reason.trim(),
    });
    if (error) toast.error(error.message);
    else {
      toast.success(`${tier.code} deactivated`);
      qc.invalidateQueries({ queryKey: ["vm-tiers"] });
    }
  }

  async function addTier() {
    if (reason.trim().length < 5) {
      toast.error("A reason of 5 to 300 characters is required");
      return;
    }
    const { error } = await supabase.rpc("add_vm_tier", {
      p_code: newTier.code,
      p_vcpu: Number(newTier.vcpu),
      p_ram_gb: Number(newTier.ram),
      p_storage_gb: Number(newTier.storage),
      p_selling_price_per_day: moneyOrNull(newTier.selling),
      p_internal_cost_per_day: moneyOrNull(newTier.internal),
      p_reason: reason.trim(),
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Tier added");
      setNewTier({ code: "", vcpu: "", ram: "", storage: "", selling: "", internal: "" });
      qc.invalidateQueries({ queryKey: ["vm-tiers"] });
    }
  }

  const shown = tiers.filter((t) => t.is_active || isAdmin);

  return (
    <AppShell title="Cost catalog">
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Fixed VM tiers</CardTitle>
            {isAdmin && (
              <Button
                variant={editing ? "default" : "outline"}
                data-testid="edit-prices"
                onClick={() => {
                  setEditing((v) => !v);
                  const next: Record<string, { selling: string; internal: string }> = {};
                  for (const t of tiers)
                    next[t.id] = {
                      selling:
                        t.selling_price_per_day == null ? "" : String(t.selling_price_per_day),
                      internal:
                        t.internal_cost_per_day == null ? "" : String(t.internal_cost_per_day),
                    };
                  setDraftTiers(next);
                  const rd: Record<string, string> = {};
                  for (const r of rates) rd[r.key] = r.value == null ? "" : String(r.value);
                  setDraftRates(rd);
                }}
              >
                Edit prices
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Per VM per day, private cloud. Selling price and internal cost are both stored. Blank
              means not set.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tier</TableHead>
                  <TableHead>vCPU</TableHead>
                  <TableHead>RAM GB</TableHead>
                  <TableHead>Storage GB</TableHead>
                  <TableHead>Selling / day</TableHead>
                  <TableHead>Internal cost / day</TableHead>
                  {isAdmin && editing && <TableHead></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((t) => (
                  <TableRow key={t.id} data-testid={`tier-${t.code}`}>
                    <TableCell>
                      {t.code}
                      {!t.is_active && " (inactive)"}
                    </TableCell>
                    <TableCell>{t.vcpu}</TableCell>
                    <TableCell>{t.ram_gb}</TableCell>
                    <TableCell>{t.storage_gb ?? "—"}</TableCell>
                    <TableCell>
                      {editing && isAdmin ? (
                        <Input
                          className="w-28"
                          value={draftTiers[t.id]?.selling ?? ""}
                          onChange={(e) =>
                            setDraftTiers({
                              ...draftTiers,
                              [t.id]: { ...draftTiers[t.id], selling: e.target.value },
                            })
                          }
                        />
                      ) : t.selling_price_per_day == null ? (
                        "Not set"
                      ) : (
                        fmtCurrency(t.selling_price_per_day)
                      )}
                    </TableCell>
                    <TableCell>
                      {editing && isAdmin ? (
                        <Input
                          className="w-28"
                          value={draftTiers[t.id]?.internal ?? ""}
                          onChange={(e) =>
                            setDraftTiers({
                              ...draftTiers,
                              [t.id]: { ...draftTiers[t.id], internal: e.target.value },
                            })
                          }
                        />
                      ) : t.internal_cost_per_day == null ? (
                        "Not set"
                      ) : (
                        fmtCurrency(t.internal_cost_per_day)
                      )}
                    </TableCell>
                    {isAdmin && editing && (
                      <TableCell>
                        {t.is_active && (
                          <Button size="sm" variant="outline" onClick={() => deactivate(t)}>
                            Deactivate
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Custom calculator</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {(["vcpu", "ramGb", "storageGb", "days", "vms"] as const).map((k) => (
                <div key={k}>
                  <Label className="text-xs">{k}</Label>
                  <Input
                    data-testid={`calc-${k}`}
                    value={calc[k]}
                    onChange={(e) => setCalc({ ...calc, [k]: e.target.value })}
                  />
                </div>
              ))}
            </div>
            <div data-testid="calc-result" className="text-sm">
              {quote.ok ? (
                <div className="space-y-1">
                  <div>Cost per VM per day: {fmtCurrency(quote.perVmPerDay)}</div>
                  <div>Cost per VM for the period: {fmtCurrency(quote.perVmPeriod)}</div>
                  <div className="font-medium">Total: {fmtCurrency(quote.total)}</div>
                  {quote.matchedTier && (
                    <div>
                      Matches tier {quote.matchedTier}:{" "}
                      {quote.tierTotal == null
                        ? "Not set"
                        : `${fmtCurrency(quote.tierTotal)} for this quantity`}
                    </div>
                  )}
                </div>
              ) : (
                <p>{quote.error}</p>
              )}
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              {rates.map((r) => (
                <div key={r.key} className="flex items-center gap-2">
                  <span className="w-64">{RATE_LABEL[r.key] ?? r.key}</span>
                  {editing && isAdmin ? (
                    <Input
                      className="w-28"
                      data-testid={`rate-${r.key}`}
                      value={draftRates[r.key] ?? ""}
                      onChange={(e) => setDraftRates({ ...draftRates, [r.key]: e.target.value })}
                    />
                  ) : (
                    <span>
                      {r.value == null ? "Not set" : String(r.value)}{" "}
                      {r.key.endsWith("_pct") ? "%" : "INR"}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {isAdmin && editing && (
          <Card>
            <CardHeader>
              <CardTitle>Save price changes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Label>Reason</Label>
              <Input
                data-testid="rate-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why this price is changing"
              />
              <Button data-testid="save-prices" onClick={saveEdits}>
                Save
              </Button>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2 pt-2">
                <Input
                  placeholder="Code"
                  value={newTier.code}
                  onChange={(e) => setNewTier({ ...newTier, code: e.target.value })}
                />
                <Input
                  placeholder="vCPU"
                  value={newTier.vcpu}
                  onChange={(e) => setNewTier({ ...newTier, vcpu: e.target.value })}
                />
                <Input
                  placeholder="RAM"
                  value={newTier.ram}
                  onChange={(e) => setNewTier({ ...newTier, ram: e.target.value })}
                />
                <Input
                  placeholder="Storage"
                  value={newTier.storage}
                  onChange={(e) => setNewTier({ ...newTier, storage: e.target.value })}
                />
                <Input
                  placeholder="Selling"
                  value={newTier.selling}
                  onChange={(e) => setNewTier({ ...newTier, selling: e.target.value })}
                />
                <Button variant="outline" onClick={addTier}>
                  Add tier
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle>Change history</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-1">
              {history.length === 0 && <p className="text-muted-foreground">No changes yet.</p>}
              {history.map((h) => (
                <div key={h.id}>
                  {h.row_key} · {h.field_name}: {h.old_value ?? "NULL"} → {h.new_value ?? "NULL"} ·{" "}
                  {h.reason ?? "—"}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
