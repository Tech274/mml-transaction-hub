import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { pageHead, pageShell } from "@/lib/nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { LINES_OF_BUSINESS } from "@/lib/adr-entry";
import {
  isCloudType,
  isProviderAllowedForCloudType,
  normalizeProvider,
} from "@/lib/cloud-provider";
import { LAB_TYPE_OPTIONS, labTypeLabel } from "@/lib/lab-type-label";
import { CloudTypeBadge } from "@/components/cloud/cloud-type-badge";
import { ProviderSelectItems } from "@/components/cloud/provider-select-items";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import {
  FilterActions,
  FilterBar,
  FilterSearch,
  FilterSelect,
  FilterSummary,
} from "@/components/filter-bar";
import { TableStateRow } from "@/components/data-table-parts";

export const Route = createFileRoute("/_authenticated/mml-lab/lab-catalog")({
  head: () => pageHead("/mml-lab/lab-catalog"),
  beforeLoad: requireRouteRoles("/mml-lab/lab-catalog"),
  component: LabCatalogPage,
});

type Entry = {
  id: string;
  title: string;
  summary: string | null;
  description: string | null;
  lab_type: string;
  cloud_provider: string | null;
  vm_tier_id: string | null;
  default_duration_days: number | null;
  line_of_business: string | null;
  tags: string[];
  document_url: string | null;
  status: string;
};

const empty = {
  title: "",
  summary: "",
  description: "",
  // SCRUM-129: no default cloud type; the user must choose.
  lab_type: "",
  cloud_provider: "",
  vm_tier_id: "",
  default_duration_days: "",
  line_of_business: "",
  tags: "",
  document_url: "",
};

function LabCatalogPage() {
  const { hasAnyRole } = useAuth();
  const canEdit = hasAnyRole(["admin", "ops_lead"]);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [labType, setLabType] = useState("all");
  const [provider, setProvider] = useState("all");
  const [lob, setLob] = useState("all");
  const [status, setStatus] = useState(canEdit ? "all" : "published");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [form, setForm] = useState(empty);
  const [detail, setDetail] = useState<Entry | null>(null);

  const { data: tiers = [] } = useQuery({
    queryKey: ["vm-tiers", "catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vm_tiers")
        .select("id, code, is_active")
        .eq("is_active", true)
        .order("sort_order");
      if (error) return [];
      return data ?? [];
    },
  });

  const {
    data: rows = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["lab-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase.from("lab_catalog").select("*").order("title");
      if (error) throw error;
      return (data ?? []) as Entry[];
    },
  });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (!canEdit && r.status !== "published") return false;
        if (status !== "all" && r.status !== status) return false;
        if (labType !== "all" && r.lab_type !== labType) return false;
        if (provider !== "all" && r.cloud_provider !== provider) return false;
        if (lob !== "all" && r.line_of_business !== lob) return false;
        if (!needle) return true;
        const hay = `${r.title} ${r.summary ?? ""} ${(r.tags ?? []).join(" ")}`.toLowerCase();
        return hay.includes(needle);
      })
      .slice(0, 50);
  }, [rows, q, labType, provider, lob, status, canEdit]);

  function startNew() {
    setEditing(null);
    setForm(empty);
    setOpen(true);
  }
  function startEdit(row: Entry) {
    setEditing(row);
    setForm({
      title: row.title,
      summary: row.summary ?? "",
      description: row.description ?? "",
      lab_type: row.lab_type,
      cloud_provider: row.cloud_provider ?? "",
      vm_tier_id: row.vm_tier_id ?? "",
      default_duration_days:
        row.default_duration_days == null ? "" : String(row.default_duration_days),
      line_of_business: row.line_of_business ?? "",
      tags: (row.tags ?? []).join(", "),
      document_url: row.document_url ?? "",
    });
    setOpen(true);
  }

  async function save() {
    // SCRUM-129: lab type required; provider one of the six and matching the type.
    if (!form.lab_type) {
      toast.error("Choose a lab type: Private cloud, Public cloud or Hybrid");
      return;
    }
    if (form.cloud_provider && !normalizeProvider(form.cloud_provider).ok) {
      toast.error("Choose one of the six cloud providers");
      return;
    }
    if (isCloudType(form.lab_type)) {
      if (!form.cloud_provider) {
        toast.error("Cloud Provider is required");
        return;
      }
      if (!isProviderAllowedForCloudType(form.cloud_provider, form.lab_type)) {
        toast.error(
          `${form.cloud_provider} is not ${labTypeLabel(form.lab_type)}. Private cloud is MakeMyLabs, Oracle or SAP; Public cloud is AWS, Azure or GCP.`,
        );
        return;
      }
    }
    const tags = form.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 10);
    const payload = {
      title: form.title.trim(),
      summary: form.summary.trim() || null,
      description: form.description.trim() || null,
      lab_type: form.lab_type,
      cloud_provider: form.cloud_provider || null,
      vm_tier_id: form.vm_tier_id || null,
      default_duration_days: form.default_duration_days ? Number(form.default_duration_days) : null,
      line_of_business: form.line_of_business || null,
      tags,
      document_url: form.document_url.trim() || null,
    };
    const { error } = editing
      ? await supabase.from("lab_catalog").update(payload).eq("id", editing.id)
      : await supabase.from("lab_catalog").insert({ ...payload, status: "draft" });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(editing ? "Catalog entry updated" : "Draft saved");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["lab-catalog"] });
  }

  async function changeStatus(row: Entry, next: "published" | "archived" | "draft") {
    const patch: {
      status: "published" | "archived" | "draft";
      published_at?: string;
      published_by?: string | null;
    } = { status: next };
    if (next === "published") {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      patch.published_at = new Date().toISOString();
      patch.published_by = user?.id ?? null;
    }
    const { error } = await supabase.from("lab_catalog").update(patch).eq("id", row.id);
    if (error) toast.error(error.message);
    else {
      toast.success(
        next === "published" ? "Published" : next === "archived" ? "Archived" : "Moved to draft",
      );
      qc.invalidateQueries({ queryKey: ["lab-catalog"] });
    }
  }

  return (
    <AppShell {...pageShell("/mml-lab/lab-catalog")}>
      {/* #29: the shared FilterBar (search, Lab type, grouped Provider, LOB, Status). */}
      <FilterBar
        summary={
          <FilterSummary
            items={[
              {
                label: "Showing",
                value: `${filtered.length.toLocaleString()}${filtered.length === 50 ? " (first 50)" : ""}`,
              },
            ]}
          />
        }
      >
        <FilterSearch
          label="Search labs"
          placeholder="Title, summary or tag"
          value={q}
          onChange={setQ}
          testId="lab-search"
        />
        <FilterSelect
          label="Lab type"
          value={labType}
          onValueChange={setLabType}
          allLabel="All lab types"
          options={LAB_TYPE_OPTIONS.map((o) => ({ value: o, label: labTypeLabel(o) }))}
        />
        <FilterSelect
          label="Provider"
          value={provider}
          onValueChange={setProvider}
          allLabel="All providers"
        >
          <ProviderSelectItems />
        </FilterSelect>
        <FilterSelect
          label="Line of business"
          value={lob}
          onValueChange={setLob}
          allLabel="All"
          width="md"
          options={LINES_OF_BUSINESS.map((l) => ({ value: l, label: l }))}
        />
        {canEdit && (
          <FilterSelect
            label="Status"
            value={status}
            onValueChange={setStatus}
            allLabel="All statuses"
            options={[
              { value: "draft", label: "Draft" },
              { value: "published", label: "Published" },
              { value: "archived", label: "Archived" },
            ]}
          />
        )}
        {canEdit && (
          <FilterActions>
            <Button size="sm" onClick={startNew}>
              <Plus className="mr-1 size-4" />
              New entry
            </Button>
          </FilterActions>
        )}
      </FilterBar>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="text-sm">Labs MML offers</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableStateRow colSpan={5}>Loading labs…</TableStateRow>
              ) : isError ? (
                <TableStateRow colSpan={5} onRetry={() => refetch()}>
                  Could not load the lab catalog.
                </TableStateRow>
              ) : (
                filtered.length === 0 && <TableStateRow colSpan={5}>No labs match.</TableStateRow>
              )}
              {filtered.map((r) => (
                <TableRow key={r.id} data-testid={`lab-row-${r.status}`}>
                  <TableCell>
                    <button
                      type="button"
                      className="text-left font-medium hover:underline"
                      onClick={() => setDetail(r)}
                    >
                      {r.title}
                    </button>
                    {r.summary && <div className="text-xs text-muted-foreground">{r.summary}</div>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.lab_type === "hybrid" ? (
                      <Badge variant="outline" className="whitespace-nowrap">
                        Hybrid
                      </Badge>
                    ) : (
                      <CloudTypeBadge value={r.lab_type} />
                    )}
                  </TableCell>
                  <TableCell>{r.cloud_provider ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={catalogStatusVariant(r.status)}>{r.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-1">
                      {canEdit && (
                        <Button size="sm" variant="outline" onClick={() => startEdit(r)}>
                          Edit
                        </Button>
                      )}
                      {canEdit && r.status !== "published" && (
                        <Button size="sm" onClick={() => changeStatus(r, "published")}>
                          Publish
                        </Button>
                      )}
                      {canEdit && r.status !== "archived" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => changeStatus(r, "archived")}
                        >
                          Archive
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detail?.title}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-2 text-sm">
              <Badge variant={catalogStatusVariant(detail.status)}>{detail.status}</Badge>
              <p>{detail.summary}</p>
              <p className="whitespace-pre-wrap">{detail.description}</p>
              <p className="text-muted-foreground">
                Type: {labTypeLabel(detail.lab_type)} · Provider: {detail.cloud_provider ?? "—"} ·
                Duration:{" "}
                <span className="tabular-nums">{detail.default_duration_days ?? "—"}</span> days
              </p>
              {detail.document_url && (
                <a
                  className="text-primary underline"
                  href={detail.document_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Document
                </a>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit catalog entry" : "New catalog entry"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Label>Title</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <Label>Summary</Label>
            <Input
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
            />
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <Label>Lab type</Label>
            <Select
              value={form.lab_type || undefined}
              onValueChange={(v) =>
                setForm({
                  ...form,
                  lab_type: v,
                  // Clear a provider that does not belong to the new type.
                  cloud_provider:
                    isCloudType(v) &&
                    form.cloud_provider &&
                    !isProviderAllowedForCloudType(form.cloud_provider, v)
                      ? ""
                      : form.cloud_provider,
                })
              }
            >
              <SelectTrigger aria-invalid={!form.lab_type}>
                <SelectValue placeholder="Choose lab type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private_cloud">Private cloud</SelectItem>
                <SelectItem value="public_cloud">Public cloud</SelectItem>
                <SelectItem value="hybrid">Hybrid</SelectItem>
              </SelectContent>
            </Select>
            <Label>Cloud provider</Label>
            <Select
              value={form.cloud_provider || undefined}
              onValueChange={(v) => setForm({ ...form, cloud_provider: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose provider" />
              </SelectTrigger>
              <SelectContent>
                <ProviderSelectItems only={isCloudType(form.lab_type) ? form.lab_type : null} />
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Private cloud is MakeMyLabs, Oracle or SAP. Public cloud is AWS, Azure or GCP. Hybrid
              labs are not counted as Private or Public cloud.
            </p>
            {(form.lab_type === "private_cloud" || form.lab_type === "hybrid") && (
              <>
                <Label>VM tier</Label>
                <Select
                  value={form.vm_tier_id || "none"}
                  onValueChange={(v) => setForm({ ...form, vm_tier_id: v === "none" ? "" : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Optional" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {tiers.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
            <Label>Default duration (days)</Label>
            <Input
              value={form.default_duration_days}
              onChange={(e) => setForm({ ...form, default_duration_days: e.target.value })}
            />
            <Label>Line of business</Label>
            <Select
              value={form.line_of_business || "none"}
              onValueChange={(v) => setForm({ ...form, line_of_business: v === "none" ? "" : v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Blank</SelectItem>
                {LINES_OF_BUSINESS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Label>Tags (comma separated)</Label>
            <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
            <Label>Document link (https)</Label>
            <Input
              value={form.document_url}
              onChange={(e) => setForm({ ...form, document_url: e.target.value })}
            />
            <div className="flex justify-end">
              <Button onClick={save}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

/** Catalog status badge (§4.8): published success, draft secondary, archived outline. */
function catalogStatusVariant(status: string): "success" | "secondary" | "outline" {
  if (status === "published") return "success";
  if (status === "archived") return "outline";
  return "secondary";
}
