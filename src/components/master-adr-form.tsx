import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CustomerCombobox, type CustomerOption } from "./customer-combobox";
import { useConfig } from "@/hooks/use-config";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { checkPotentialIdUnique } from "@/lib/transactions.functions";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { useQueryClient } from "@tanstack/react-query";
import { MONTH_NAMES, YEARS } from "@/lib/format";

const schema = z.object({
  potential_id: z.string().trim().min(1, "Required").max(50),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  customer_id: z.string().uuid("Select a customer"),
  customer_name: z.string().min(1),
  lab_name: z.string().trim().min(1, "Required").max(200),
  lab_type: z.enum(["public_cloud", "private_cloud"]),
  cloud_provider: z.string().optional(),
  system_config: z.string().optional(),
  line_of_business: z.string().min(1, "Required"),
  start_date: z.string().min(1, "Required"),
  end_date: z.string().min(1, "Required"),
  total_users: z.coerce.number().int().positive("Must be greater than zero"),
  input_cost: z.coerce
    .number({ invalid_type_error: "Input cost is required" })
    .finite("Enter a valid number")
    .nonnegative("Input cost cannot be negative")
    .max(1_000_000_000, "Input cost is unrealistically high"),
  selling_cost: z.coerce
    .number({ invalid_type_error: "Selling cost is required" })
    .finite("Enter a valid number")
    .nonnegative("Selling cost cannot be negative")
    .max(1_000_000_000, "Selling cost is unrealistically high"),
}).superRefine((v, ctx) => {
  if (v.end_date < v.start_date) {
    ctx.addIssue({ code: "custom", path: ["end_date"], message: "End date cannot be before start date" });
  }
  if (v.lab_type === "public_cloud") {
    if (!v.cloud_provider || !["AWS", "Azure", "GCP"].includes(v.cloud_provider)) {
      ctx.addIssue({ code: "custom", path: ["cloud_provider"], message: "Required for Public Cloud (AWS, Azure, GCP)" });
    }
  }
  if (v.lab_type === "private_cloud") {
    if (!v.system_config || !(SYSTEM_CONFIG_OPTIONS as readonly string[]).includes(v.system_config)) {
      ctx.addIssue({ code: "custom", path: ["system_config"], message: "Required for Private Cloud" });
    }
  }
  if (v.input_cost > v.selling_cost) {
    ctx.addIssue({ code: "custom", path: ["input_cost"], message: "Input cost should not exceed selling cost (negative margin)" });
  }
});

type FormValues = z.infer<typeof schema>;

const SYSTEM_CONFIG_OPTIONS = [
  "8GB 2vCPUs",
  "8GB 4vCPUs",
  "12GB 4vCPUs",
  "16GB 4vCPUs",
  "24GB 6vCPUs",
  "32GB 8vCPUs",
] as const;

export function MasterAdrForm({ onSaved }: { onSaved?: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const checkUnique = useServerFn(checkPotentialIdUnique);
  const { data: labTypes = [] } = useConfig("lab_type");
  const { data: providers = [] } = useConfig("cloud_provider");
  const { data: lobs = [] } = useConfig("line_of_business");
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const now = new Date();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      potential_id: "",
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      customer_id: "",
      customer_name: "",
      lab_name: "",
      lab_type: "public_cloud",
      cloud_provider: "",
      system_config: "",
      line_of_business: "",
      start_date: "",
      end_date: "",
      total_users: 1,
      input_cost: 0,
      selling_cost: 0,
    },
  });

  const labType = form.watch("lab_type");
  useEffect(() => {
    if (labType === "private_cloud") form.setValue("cloud_provider", "MakeMyLabs Private Cloud");
    else if (form.getValues("cloud_provider") === "MakeMyLabs Private Cloud") form.setValue("cloud_provider", "");
    if (labType !== "private_cloud") form.setValue("system_config", "");
  }, [labType, form]);

  useEffect(() => {
    if (customer) {
      form.setValue("customer_id", customer.id, { shouldValidate: true });
      form.setValue("customer_name", customer.customer_name);
    }
  }, [customer, form]);

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      // A Potential ID can cover several transactions, so an existing one is
      // informational only — never a blocking error.
      const { unique } = await checkUnique({ data: { potentialId: values.potential_id } });
      if (!unique) {
        toast.message(`Potential ID ${values.potential_id} already has transactions — adding another one.`);
      }

      const { error } = await supabase.from("transactions").insert({
        potential_id: values.potential_id,
        month: values.month,
        year: values.year,
        customer_id: values.customer_id,
        customer_name: values.customer_name,
        lab_name: values.lab_name,
        lab_type: values.lab_type,
        repository_type: values.lab_type, // trigger normalizes
        cloud_provider: values.lab_type === "private_cloud" ? "MakeMyLabs Private Cloud" : (values.cloud_provider ?? ""),
        system_config: values.lab_type === "private_cloud" ? (values.system_config ?? null) : null,
        line_of_business: values.line_of_business,
        start_date: values.start_date,
        end_date: values.end_date,
        total_users: values.total_users,
        input_cost: values.input_cost,
        selling_cost: values.selling_cost,
        created_by: user!.id,
      });
      if (error) throw error;
      toast.success("Transaction saved");
      form.reset({
        ...form.getValues(),
        potential_id: "",
        lab_name: "",
        start_date: "",
        end_date: "",
        total_users: 1,
        input_cost: 0,
        selling_cost: 0,
      });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onSaved?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const providerOptions = providers.filter((p) => p.key !== "MakeMyLabs Private Cloud");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Master ADR Entry</CardTitle>
        <p className="text-sm text-muted-foreground">
          Every transaction is captured here. Records are automatically classified into Public Cloud or Private Cloud repositories.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Potential ID *" error={form.formState.errors.potential_id?.message}>
            <Input {...form.register("potential_id")} placeholder="POT-2026-001" />
          </Field>
          <Field label="Customer *" error={form.formState.errors.customer_id?.message}>
            <CustomerCombobox value={customer} onChange={setCustomer} />
          </Field>
          <Field label="Month *">
            <Select value={String(form.watch("month"))} onValueChange={(v) => form.setValue("month", Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Year *">
            <Select value={String(form.watch("year"))} onValueChange={(v) => form.setValue("year", Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Lab Name *" error={form.formState.errors.lab_name?.message}>
            <Input {...form.register("lab_name")} />
          </Field>
          <Field label="Lab Type *">
            <Select value={labType} onValueChange={(v) => form.setValue("lab_type", v as "public_cloud" | "private_cloud")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {labTypes.map((l) => <SelectItem key={l.key} value={l.key}>{l.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Cloud Provider *" error={form.formState.errors.cloud_provider?.message}>
            {labType === "private_cloud" ? (
              <Input value="MakeMyLabs Private Cloud" disabled />
            ) : (
              <Select value={form.watch("cloud_provider")} onValueChange={(v) => form.setValue("cloud_provider", v, { shouldValidate: true })}>
                <SelectTrigger><SelectValue placeholder="Select provider" /></SelectTrigger>
                <SelectContent>
                  {providerOptions.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Line of Business *" error={form.formState.errors.line_of_business?.message}>
            <Select value={form.watch("line_of_business")} onValueChange={(v) => form.setValue("line_of_business", v, { shouldValidate: true })}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {lobs.map((l) => <SelectItem key={l.key} value={l.label}>{l.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {labType === "private_cloud" && (
            <Field label="System Config *" error={form.formState.errors.system_config?.message}>
              <Select
                value={form.watch("system_config") ?? ""}
                onValueChange={(v) => form.setValue("system_config", v, { shouldValidate: true })}
              >
                <SelectTrigger><SelectValue placeholder="Select configuration" /></SelectTrigger>
                <SelectContent>
                  {SYSTEM_CONFIG_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Start Date *" error={form.formState.errors.start_date?.message}>
            <Input type="date" {...form.register("start_date")} />
          </Field>
          <Field label="End Date *" error={form.formState.errors.end_date?.message}>
            <Input type="date" {...form.register("end_date")} />
          </Field>
          <Field label="Total Users *" error={form.formState.errors.total_users?.message}>
            <Input type="number" min={1} {...form.register("total_users")} />
          </Field>
          <Field label="Input Cost *" error={form.formState.errors.input_cost?.message}>
            <Input type="number" min={0} step="0.01" {...form.register("input_cost")} />
          </Field>
          <Field label="Selling Cost *" error={form.formState.errors.selling_cost?.message}>
            <Input type="number" min={0} step="0.01" {...form.register("selling_cost")} />
          </Field>
          <div className="md:col-span-2 flex justify-end gap-2 pt-2 border-t border-border">
            <Button type="button" variant="outline" onClick={() => form.reset()}>Reset</Button>
            <Button type="submit" disabled={submitting}>{submitting ? "Saving…" : "Save Transaction"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
