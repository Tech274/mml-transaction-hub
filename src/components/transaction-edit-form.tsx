import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { adminCorrectTransactionCosts, updateAdrTransaction } from "@/lib/transactions.functions";
import { adrEditSchema, marginNote, SYSTEM_CONFIG_OPTIONS, type AdrEdit } from "@/lib/adr-entry";
import { AdrExtraFields } from "@/components/adr-extra-fields";
import { useAuth } from "@/lib/auth-context";

type Tx = {
  id: string;
  potential_id: string | null;
  month: number | null;
  year: number | null;
  customer_id: string | null;
  customer_name: string | null;
  lab_name: string | null;
  lab_type: string;
  cloud_provider: string | null;
  system_config: string | null;
  line_of_business: string | null;
  start_date: string | null;
  end_date: string | null;
  total_users: number | null;
  input_cost: number | null;
  selling_cost: number | null;
  lab_batch_id?: string | null;
  license_name?: string | null;
  api_key_service?: string | null;
  selling_price_per_user?: number | null;
  vm_price_per_user?: number | null;
  license_price_per_user?: number | null;
  api_key_price_per_user?: number | null;
  input_cost_per_user?: number | null;
  input_cost_pct?: number | null;
  vm_hours_consumed?: number | null;
  license_seats_used?: number | null;
  api_units_consumed?: number | null;
  api_unit_label?: string | null;
  is_hybrid?: boolean | null;
};

const empty = (v: string | number | null | undefined) => (v == null ? "" : String(v));

/** Edit an existing transaction. Blank fields stay blank and the save is not blocked. */
export function TransactionEditForm({ tx, onSaved }: { tx: Tx; onSaved?: () => void }) {
  const qc = useQueryClient();
  const save = useServerFn(updateAdrTransaction);
  const correctCosts = useServerFn(adminCorrectTransactionCosts);
  const [submitting, setSubmitting] = useState(false);
  const [correctingCost, setCorrectingCost] = useState(false);
  const [costCorrectionError, setCostCorrectionError] = useState<string | null>(null);
  const [costCorrectionReason, setCostCorrectionReason] = useState("");
  const [correctedInputCost, setCorrectedInputCost] = useState(empty(tx.input_cost));
  const [correctedSellingCost, setCorrectedSellingCost] = useState(empty(tx.selling_cost));
  const { isAdmin } = useAuth();
  const form = useForm<AdrEdit>({
    resolver: zodResolver(adrEditSchema) as Resolver<AdrEdit>,
    defaultValues: {
      potential_id: tx.potential_id ?? "",
      month: (tx.month ?? "") as unknown as number | null,
      year: (tx.year ?? "") as unknown as number | null,
      customer_id: tx.customer_id ?? "",
      customer_name: tx.customer_name ?? "",
      lab_name: tx.lab_name ?? "",
      lab_type: tx.lab_type === "private_cloud" ? "private_cloud" : "public_cloud",
      cloud_provider: tx.cloud_provider ?? "",
      system_config:
        tx.system_config && (SYSTEM_CONFIG_OPTIONS as readonly string[]).includes(tx.system_config)
          ? tx.system_config
          : "",
      line_of_business:
        tx.line_of_business && ["VILT", "Standalone", "Integrated"].includes(tx.line_of_business)
          ? tx.line_of_business
          : "",
      start_date: tx.start_date ?? "",
      end_date: tx.end_date ?? "",
      total_users: (tx.total_users ?? "") as unknown as number | null,
      input_cost: (tx.input_cost ?? "") as unknown as number | null,
      selling_cost: (tx.selling_cost ?? "") as unknown as number | null,
      lab_batch_id: tx.lab_batch_id ?? "",
      license_name: tx.license_name ?? "",
      api_key_service: tx.api_key_service ?? "",
      selling_price_per_user: (tx.selling_price_per_user ?? "") as unknown as number | null,
      vm_price_per_user: (tx.vm_price_per_user ?? "") as unknown as number | null,
      license_price_per_user: (tx.license_price_per_user ?? "") as unknown as number | null,
      api_key_price_per_user: (tx.api_key_price_per_user ?? "") as unknown as number | null,
      input_cost_per_user: (tx.input_cost_per_user ?? "") as unknown as number | null,
      input_cost_pct: (tx.input_cost_pct ?? "") as unknown as number | null,
      vm_hours_consumed: (tx.vm_hours_consumed ?? "") as unknown as number | null,
      license_seats_used: (tx.license_seats_used ?? "") as unknown as number | null,
      api_units_consumed: (tx.api_units_consumed ?? "") as unknown as number | null,
      api_unit_label: tx.api_unit_label ?? "",
      is_hybrid: tx.is_hybrid === true,
    },
  });

  const inputCost = form.watch("input_cost");
  const sellingCost = form.watch("selling_cost");
  const note = marginNote(
    typeof inputCost === "number" ? inputCost : null,
    typeof sellingCost === "number" ? sellingCost : null,
  );

  async function onSubmit(values: AdrEdit) {
    setSubmitting(true);
    try {
      await save({ data: { id: tx.id, ...values } });
      toast.success("Transaction updated");
      qc.invalidateQueries({ queryKey: ["transaction", tx.id] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onSaved?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function onCorrectCost() {
    if (!isAdmin) return;
    const inputCost = Number(correctedInputCost);
    const sellingCost = Number(correctedSellingCost);
    const reason = costCorrectionReason.trim();
    if (!Number.isFinite(inputCost) || inputCost < 0) {
      setCostCorrectionError("Enter a valid input cost.");
      return;
    }
    if (!Number.isFinite(sellingCost) || sellingCost < 0) {
      setCostCorrectionError("Enter a valid selling cost.");
      return;
    }
    if (reason.length < 3) {
      setCostCorrectionError("Correction reason is required.");
      return;
    }

    setCorrectingCost(true);
    setCostCorrectionError(null);
    try {
      await correctCosts({
        data: {
          id: tx.id,
          input_cost: inputCost,
          selling_cost: sellingCost,
          reason,
        },
      });
      toast.success("Cost corrected");
      qc.invalidateQueries({ queryKey: ["transaction", tx.id] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setCostCorrectionReason("");
      onSaved?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not correct cost";
      setCostCorrectionError(msg);
      toast.error(msg);
    } finally {
      setCorrectingCost(false);
    }
  }

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="space-y-3"
      data-testid="transaction-edit-form"
    >
      <p className="text-xs text-muted-foreground">
        Blank fields stay blank. Nothing here is required, and selling below cost can be saved.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Potential ID" error={form.formState.errors.potential_id?.message}>
          <Input {...form.register("potential_id")} placeholder={empty(tx.potential_id)} />
        </Field>
        <Field label="Customer" error={form.formState.errors.customer_name?.message}>
          <Input {...form.register("customer_name")} />
        </Field>
        <Field label="Month" error={form.formState.errors.month?.message}>
          <Input type="number" min={1} max={12} {...form.register("month")} />
        </Field>
        <Field label="Year" error={form.formState.errors.year?.message}>
          <Input type="number" min={2000} max={2100} {...form.register("year")} />
        </Field>
        <Field label="Lab" error={form.formState.errors.lab_name?.message}>
          <Input {...form.register("lab_name")} />
        </Field>
        <Field label="Line of business" error={form.formState.errors.line_of_business?.message}>
          <Select
            value={empty(form.watch("line_of_business")) || undefined}
            onValueChange={(v) => form.setValue("line_of_business", v, { shouldValidate: true })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Blank" />
            </SelectTrigger>
            <SelectContent>
              {["VILT", "Standalone", "Integrated"].map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Cloud provider" error={form.formState.errors.cloud_provider?.message}>
          <Input {...form.register("cloud_provider")} placeholder="Blank" />
        </Field>
        <Field label="System config" error={form.formState.errors.system_config?.message}>
          <Select
            value={empty(form.watch("system_config")) || undefined}
            onValueChange={(v) => form.setValue("system_config", v, { shouldValidate: true })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Blank" />
            </SelectTrigger>
            <SelectContent>
              {SYSTEM_CONFIG_OPTIONS.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Start date" error={form.formState.errors.start_date?.message}>
          <Input type="date" {...form.register("start_date")} />
        </Field>
        <Field label="End date" error={form.formState.errors.end_date?.message}>
          <Input type="date" {...form.register("end_date")} />
        </Field>
        <Field label="Total users" error={form.formState.errors.total_users?.message}>
          <Input type="number" {...form.register("total_users")} />
        </Field>
        <Field label="Input cost (INR, estimate)" error={form.formState.errors.input_cost?.message}>
          <Input type="number" step="0.01" value={empty(tx.input_cost)} readOnly />
        </Field>
        <Field label="Selling cost (INR)" error={form.formState.errors.selling_cost?.message}>
          <Input type="number" step="0.01" value={empty(tx.selling_cost)} readOnly />
        </Field>
        <div className="col-span-2 rounded-md border border-border bg-muted/20 p-2 text-xs">
          <p className="text-muted-foreground" data-testid="cost-lock-note">
            Cost fields are locked. Super Admin can correct them with a reason.
          </p>
          {isAdmin ? (
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_2fr_auto] md:items-end">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Correct input cost</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={correctedInputCost}
                  onChange={(e) => setCorrectedInputCost(e.target.value)}
                  data-testid="correct-input-cost"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Correct selling cost</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={correctedSellingCost}
                  onChange={(e) => setCorrectedSellingCost(e.target.value)}
                  data-testid="correct-selling-cost"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Reason</Label>
                <Input
                  value={costCorrectionReason}
                  onChange={(e) => setCostCorrectionReason(e.target.value)}
                  placeholder="Required reason"
                  data-testid="correct-cost-reason"
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onCorrectCost}
                disabled={correctingCost}
                data-testid="correct-cost-button"
              >
                {correctingCost ? "Correcting…" : "Correct cost"}
              </Button>
            </div>
          ) : null}
          {costCorrectionError ? (
            <p className="mt-1 text-xs text-destructive" data-testid="cost-correction-error">
              {costCorrectionError}
            </p>
          ) : null}
        </div>
      </div>
      <AdrExtraFields form={form} isAdmin={isAdmin} mode="edit" />
      {note && (
        <p className="text-xs text-muted-foreground" data-testid="margin-note">
          {note}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
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
    <div className="space-y-1">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
