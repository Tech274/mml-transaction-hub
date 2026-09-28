import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { API_UNIT_LABELS, type AdrEntry } from "@/lib/adr-entry";
import { componentTotal, privateCloudSplit } from "@/lib/cost-calculator";
import { fmtCurrency } from "@/lib/format";

const NONE = "__none__";

function num(v: unknown): number | null {
  if (v === "" || v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fields shared by Master ADR Entry and the edit drawer.
 * Private-cloud prices follow the entered per-user selling price.
 * Input cost = private_input_cost_pct (default 20) of that price.
 */
export function AdrExtraFields({
  form,
  isAdmin,
  mode,
}: {
  form: UseFormReturn<AdrEntry>;
  isAdmin: boolean;
  mode: "create" | "edit";
}) {
  const labType = form.watch("lab_type");
  const licenseName = form.watch("license_name");
  const apiName = form.watch("api_key_service");
  const sellingPerUser = form.watch("selling_price_per_user");
  const vmPrice = form.watch("vm_price_per_user");
  const licensePrice = form.watch("license_price_per_user");
  const apiPrice = form.watch("api_key_price_per_user");
  const users = form.watch("total_users");
  const batchId = form.watch("lab_batch_id");
  const sellingCost = form.watch("selling_cost");
  const pctField = form.watch("input_cost_pct");
  const skipDerive = useRef(mode === "edit");
  const prevKey = useRef("");

  const { data: pctDefault = 20 } = useQuery({
    queryKey: ["cost-rate", "private_input_cost_pct"],
    queryFn: async () => {
      const { data } = await supabase
        .from("cost_rates")
        .select("value")
        .eq("key", "private_input_cost_pct")
        .maybeSingle();
      const n = data?.value == null ? 20 : Number(data.value);
      return Number.isFinite(n) ? n : 20;
    },
  });

  const { data: batches = [] } = useQuery({
    queryKey: ["lab-batches", "open", labType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lab_batches")
        .select(
          "id, batch_code, name, status, lab_type, estimated_cost_total, actual_cost_total, revenue_total",
        )
        .eq("status", "open")
        .order("batch_code");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: selectedBatch } = useQuery({
    queryKey: ["lab-batch", batchId],
    enabled: !!batchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lab_batches")
        .select("id, batch_code, name, status, estimated_cost_total, actual_cost_total, flags")
        .eq("id", batchId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const pct = num(pctField) ?? pctDefault;
  const userCount = num(users);

  useEffect(() => {
    const key = `${labType}|${sellingPerUser}|${users}|${pctDefault}`;
    if (skipDerive.current) {
      skipDerive.current = false;
      prevKey.current = key;
      if (mode === "edit" && (pctField == null || pctField === ("" as unknown))) {
        form.setValue("input_cost_pct", pctDefault);
      }
      return;
    }
    if (prevKey.current === key) return;
    prevKey.current = key;
    if (labType !== "private_cloud") return;
    const price = num(sellingPerUser);
    const n = num(users);
    if (price == null || n == null) return;
    const split = privateCloudSplit(price, n, pctDefault);
    form.setValue("selling_cost", split.revenue, { shouldDirty: true });
    form.setValue("input_cost", split.inputTotal, { shouldDirty: true });
    form.setValue("input_cost_per_user", split.inputPerUser, { shouldDirty: true });
    form.setValue("input_cost_pct", pctDefault, { shouldDirty: true });
  }, [labType, sellingPerUser, users, pctDefault, form, mode, pctField]);

  const price = num(sellingPerUser);
  const split =
    labType === "private_cloud" && price != null && userCount != null
      ? privateCloudSplit(price, userCount, pct)
      : null;
  const derivedSelling = split?.revenue ?? null;
  const sellingMismatch =
    derivedSelling != null && num(sellingCost) != null && num(sellingCost) !== derivedSelling;

  const openBatches = batches.filter((b) => !b.lab_type || b.lab_type === labType);
  const batchCostLabel =
    selectedBatch?.actual_cost_total != null
      ? `${fmtCurrency(selectedBatch.actual_cost_total)} · actual`
      : selectedBatch?.estimated_cost_total != null
        ? `${fmtCurrency(selectedBatch.estimated_cost_total)} · estimated`
        : "Not calculated yet";

  return (
    <div
      className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 rounded-md border border-border p-3"
      data-testid="adr-extra-fields"
    >
      <Field label="Batch">
        <Select
          value={batchId || NONE}
          onValueChange={(v) =>
            form.setValue("lab_batch_id", v === NONE ? null : v, { shouldDirty: true })
          }
        >
          <SelectTrigger data-testid="field-lab_batch_id">
            <SelectValue placeholder="No batch" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No batch</SelectItem>
            {openBatches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.batch_code}
                {b.name ? ` · ${b.name}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Cost incurred for this batch (INR)">
        <div className="h-9 flex items-center text-sm" data-testid="batch-cost-incurred">
          {batchId ? batchCostLabel : "—"}
        </div>
      </Field>

      {labType === "private_cloud" && (
        <>
          <Field
            label="Selling price per user (INR)"
            error={form.formState.errors.selling_price_per_user?.message}
          >
            <Input
              type="number"
              min={0}
              step="0.01"
              data-testid="field-selling_price_per_user"
              {...form.register("selling_price_per_user")}
            />
          </Field>
          <Field
            label="VM price per user (INR)"
            error={form.formState.errors.vm_price_per_user?.message}
          >
            <Input
              type="number"
              min={0}
              step="0.01"
              data-testid="field-vm_price_per_user"
              {...form.register("vm_price_per_user")}
            />
          </Field>
          <Field label="Subscription / licence" error={form.formState.errors.license_name?.message}>
            <Input
              data-testid="field-license_name"
              placeholder="Microsoft 365 E3"
              {...form.register("license_name")}
            />
          </Field>
          <Field label="API key service" error={form.formState.errors.api_key_service?.message}>
            <Input
              data-testid="field-api_key_service"
              placeholder="OpenAI GPT-4o API"
              {...form.register("api_key_service")}
            />
          </Field>
          {!!licenseName && (
            <Field
              label="Licence price per user (INR)"
              error={form.formState.errors.license_price_per_user?.message}
            >
              <Input
                type="number"
                min={0}
                step="0.01"
                data-testid="field-license_price_per_user"
                {...form.register("license_price_per_user")}
              />
              <p className="text-xs text-muted-foreground">
                Auto-opening total {fmtCurrency(componentTotal(num(licensePrice), userCount))}{" "}
                (price × batch size)
              </p>
            </Field>
          )}
          {!!apiName && (
            <Field
              label="API key price per user (INR)"
              error={form.formState.errors.api_key_price_per_user?.message}
            >
              <Input
                type="number"
                min={0}
                step="0.01"
                data-testid="field-api_key_price_per_user"
                {...form.register("api_key_price_per_user")}
              />
              <p className="text-xs text-muted-foreground">
                Auto-opening total {fmtCurrency(componentTotal(num(apiPrice), userCount))} (price ×
                batch size)
              </p>
            </Field>
          )}
          <Field label="Input cost percent">
            <Input
              type="number"
              min={0}
              max={100}
              step="0.01"
              data-testid="field-input_cost_pct"
              {...form.register("input_cost_pct")}
            />
            <p className="text-xs text-muted-foreground">
              Default {pctDefault}% from cost rates (private_input_cost_pct). Applied to the entered
              per-user selling price.
            </p>
          </Field>
          <Field label="Input cost per user (INR)">
            <Input
              type="number"
              min={0}
              step="0.01"
              readOnly
              data-testid="field-input_cost_per_user"
              {...form.register("input_cost_per_user")}
            />
          </Field>
          {split && (
            <div
              className="md:col-span-2 rounded-md bg-muted/40 p-3 text-sm space-y-1"
              data-testid="private-split"
            >
              <div className="font-medium">Per-user split at {pct}%</div>
              <div>
                Revenue {fmtCurrency(split.revenue)} = {fmtCurrency(price)} × {userCount} users
              </div>
              <div>
                Input cost {fmtCurrency(split.inputTotal)} = {fmtCurrency(split.inputPerUser)} ×{" "}
                {userCount} ({pct}% of the selling price)
              </div>
              <div>
                Margin {fmtCurrency(split.marginTotal)} = {fmtCurrency(split.marginPerUser)} ×{" "}
                {userCount} ({roundPct(100 - pct)}%)
              </div>
              <div className="text-muted-foreground">
                Components: VM {fmtCurrency(componentTotal(num(vmPrice), userCount))}
                {licenseName
                  ? ` · Licence ${fmtCurrency(componentTotal(num(licensePrice), userCount))}`
                  : ""}
                {apiName ? ` · API ${fmtCurrency(componentTotal(num(apiPrice), userCount))}` : ""}
              </div>
              {sellingMismatch && (
                <p className="text-xs">
                  Selling cost was changed by hand. Price × users is {fmtCurrency(derivedSelling)}.
                  The typed selling cost is kept.
                </p>
              )}
            </div>
          )}
        </>
      )}

      <Field label="VM hours consumed">
        <Input
          type="number"
          min={0}
          step="0.01"
          data-testid="field-vm_hours_consumed"
          {...form.register("vm_hours_consumed")}
        />
      </Field>
      <Field label="Licence seats used">
        <Input
          type="number"
          min={0}
          step="1"
          data-testid="field-license_seats_used"
          {...form.register("license_seats_used")}
        />
      </Field>
      <Field label="API units consumed">
        <Input
          type="number"
          min={0}
          step="0.01"
          data-testid="field-api_units_consumed"
          {...form.register("api_units_consumed")}
        />
      </Field>
      <Field label="API unit">
        <Select
          value={form.watch("api_unit_label") || NONE}
          onValueChange={(v) =>
            form.setValue("api_unit_label", v === NONE ? null : v, { shouldDirty: true })
          }
        >
          <SelectTrigger data-testid="field-api_unit_label">
            <SelectValue placeholder="Blank" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Blank</SelectItem>
            {API_UNIT_LABELS.map((u) => (
              <SelectItem key={u} value={u}>
                {u}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {isAdmin && (
        <div className="md:col-span-2 flex items-center gap-2">
          <Checkbox
            id="is_hybrid"
            data-testid="field-is_hybrid"
            checked={form.watch("is_hybrid") === true}
            onCheckedChange={(v) => form.setValue("is_hybrid", v === true, { shouldDirty: true })}
          />
          <Label htmlFor="is_hybrid" className="text-sm">
            Hybrid program (public + private). Does not change revenue.
          </Label>
        </div>
      )}
    </div>
  );
}

function roundPct(n: number) {
  return Math.round(n * 100) / 100;
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function CostSourceBadge({
  inputCost,
  auto,
  actual,
}: {
  inputCost: number | null;
  auto: number | null;
  actual: number | null;
}) {
  if (actual != null) return <Badge variant="default">Actual</Badge>;
  if (inputCost != null) return <Badge variant="secondary">Entered</Badge>;
  if (auto != null) return <Badge variant="outline">Auto (avg)</Badge>;
  return <Badge variant="outline">Cost unknown</Badge>;
}
