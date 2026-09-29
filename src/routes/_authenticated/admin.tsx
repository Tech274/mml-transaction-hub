import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { requireRouteRoles } from "@/lib/route-guard";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useAuth, type AppRole } from "@/lib/auth-context";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  adminCreateUser, adminSetUserActive, adminUpdateUserProfile,
  adminDeleteUser, adminResetPassword,
} from "@/lib/admin.functions";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import { PERMISSIONS, ADMIN_ONLY_PERM_KEYS, type PermDef, setPreviewRole, usePreviewRole } from "@/lib/permissions";
import { usePermissions } from "@/lib/permissions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { upsertAccountManagerFn, setAccountManagerActiveFn } from "@/lib/customers.functions";
import { exportToExcel } from "@/lib/export-xlsx";
import { ArrowUpDown, Download } from "lucide-react";
import {
  useExportJobs, clearJobs, type ExportJob,
  getRetentionDays, setRetentionDays, getLastCleanedAt, runCleanup,
  getNextCleanupAt, validateRetentionDays, retryJob, hasRetryHandler,
} from "@/lib/export-jobs";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";

export const Route = createFileRoute("/_authenticated/admin")({
  ssr: false,
  beforeLoad: requireRouteRoles("/admin"),
  component: AdminPage,
});

const ROLES: AppRole[] = ["admin", "leadership", "finance", "ops_lead", "ops_user", "viewer"];
const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Super Admin",
  leadership: "Leadership",
  finance: "Finance",
  ops_lead: "Ops Lead",
  ops_user: "Ops User",
  viewer: "Viewer",
};

function AdminPage() {
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(getSuperadminCaptureModeEnvForClient());
  if (isExampleCaptureMode) return <ExampleAdminReviewPage />;

  const { user: me } = useAuth();
  const qc = useQueryClient();
  const { can } = usePermissions();
  const createUserFn = useServerFn(adminCreateUser);
  const setActiveFn = useServerFn(adminSetUserActive);
  const updateProfileFn = useServerFn(adminUpdateUserProfile);
  const deleteUserFn = useServerFn(adminDeleteUser);
  const resetPasswordFn = useServerFn(adminResetPassword);

  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data: profiles } = await supabase
        .from("profiles").select("id, email, full_name, is_active, created_at").order("created_at");
      const { data: roles } = await supabase.from("user_roles").select("user_id, role, id");
      const byUser = new Map<string, { role: AppRole; id: string }[]>();
      for (const r of roles ?? []) {
        const arr = byUser.get(r.user_id) ?? [];
        arr.push({ role: r.role as AppRole, id: r.id });
        byUser.set(r.user_id, arr);
      }
      return (profiles ?? []).map((p) => ({ ...p, roles: byUser.get(p.id) ?? [] }));
    },
  });

  const { data: audit = [], isLoading: auditLoading } = useQuery({
    queryKey: ["role-audit-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_audit_log")
        .select("id, target_user_id, target_email, role, action, changed_by, changed_by_email, changed_at")
        .order("changed_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    qc.invalidateQueries({ queryKey: ["role-audit-log"] });
  };

  // Last-admin protection mirrored in the UI so the destructive buttons are disabled.
  const adminCount = users.filter((u) => u.roles.some((r) => r.role === "admin")).length;

  return (
    <AppShell title="Admin Settings" actions={<CreateUserDialog onCreate={async (v) => {
      await createUserFn({ data: v });
      toast.success(`Created ${v.email}`);
      refresh();
    }} />}>
      <Tabs defaultValue="users" className="space-y-4">
        <TabsList>
          <TabsTrigger value="users">Users & Roles</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="perm-audit">Permission Audit</TabsTrigger>
          <TabsTrigger value="audit">Role Audit Log</TabsTrigger>
          <TabsTrigger value="account-managers">Account Managers</TabsTrigger>
          <TabsTrigger value="customer-audit">Customer Audit</TabsTrigger>
          {can("feature_export_jobs_view") && (
            <TabsTrigger value="export-jobs">Export Jobs</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="users">
          <Card>
            <CardHeader><CardTitle>Users</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Roles</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usersLoading && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                  )}
                  {users.map((u) => (
                    <UserRow
                      key={u.id}
                      user={u}
                      isSelf={u.id === me?.id}
                      isLastAdmin={u.roles.some((r) => r.role === "admin") && adminCount <= 1}
                      canManage={can("feature_user_manage")}
                      canDelete={can("feature_user_delete")}
                      canReset={can("feature_user_reset_password")}
                      onSave={async (v) => { await updateProfileFn({ data: { userId: u.id, ...v } }); toast.success("User updated"); refresh(); }}
                      onSetActive={async (active) => { await setActiveFn({ data: { userId: u.id, active } }); toast.success(active ? "User enabled" : "User disabled"); refresh(); }}
                      onDelete={async () => { await deleteUserFn({ data: { userId: u.id } }); toast.success(`Deleted ${u.email ?? "user"}`); refresh(); }}
                      onResetPassword={async (tempPassword) => {
                        await resetPasswordFn({ data: { userId: u.id, tempPassword } });
                        try { await navigator.clipboard.writeText(tempPassword); } catch { /* clipboard may be blocked */ }
                        toast.success(
                          `Temporary password set: ${tempPassword} — copied to clipboard. Share it securely; it will not be shown again.`,
                          { duration: 20000 },
                        );
                        refresh();
                      }}
                    />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="permissions">
          <PermissionsMatrix />
        </TabsContent>

        <TabsContent value="perm-audit">
          <PermissionAuditLog />
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardHeader><CardTitle>Role Audit Log</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Target user</TableHead>
                    <TableHead>Performed by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLoading && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                  )}
                  {!auditLoading && audit.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No role changes recorded yet.</TableCell></TableRow>
                  )}
                  {audit.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="whitespace-nowrap">{format(new Date(a.changed_at), "yyyy-MM-dd HH:mm")}</TableCell>
                      <TableCell>
                        <Badge variant={a.action === "grant" ? "default" : "destructive"}>{a.action}</Badge>
                      </TableCell>
                      <TableCell>{ROLE_LABEL[a.role as AppRole] ?? a.role}</TableCell>
                      <TableCell className="text-sm">{a.target_email ?? a.target_user_id}</TableCell>
                      <TableCell className="text-sm">{a.changed_by_email ?? a.changed_by ?? "system"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="account-managers">
          <AccountManagersAdmin />
        </TabsContent>

        <TabsContent value="customer-audit">
          <CustomerAuditLog />
        </TabsContent>

        {can("feature_export_jobs_view") && (
          <TabsContent value="export-jobs">
            <ExportJobsPanel />
          </TabsContent>
        )}
      </Tabs>
    </AppShell>
  );
}

function ExampleAdminReviewPage() {
  const users = [
    { id: "u-1", name: "Admin Demo", email: "admin.demo@mml.local", roles: ["Super Admin"], active: true },
    { id: "u-2", name: "Ops Lead Demo", email: "opslead.demo@mml.local", roles: ["Ops Lead"], active: true },
    { id: "u-3", name: "Finance Demo", email: "finance.demo@mml.local", roles: ["Finance"], active: true },
    { id: "u-4", name: "Viewer Demo", email: "viewer.demo@mml.local", roles: ["Viewer"], active: false },
  ];
  return (
    <AppShell title="Admin Settings" actions={<Button size="sm">Add user</Button>}>
      <Tabs defaultValue="users" className="space-y-4">
        <TabsList>
          <TabsTrigger value="users">Users & Roles</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="audit">Role Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <Card>
            <CardHeader><CardTitle>Users</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Roles</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="font-medium">{u.name}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {u.roles.map((role) => <Badge key={role} variant={role === "Super Admin" ? "default" : "secondary"}>{role}</Badge>)}
                        </div>
                      </TableCell>
                      <TableCell><Badge variant={u.active ? "default" : "secondary"}>{u.active ? "Active" : "Disabled"}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline">Edit</Button>
                          <Button size="sm" variant="outline">Reset password</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="permissions">
          <Card>
            <CardHeader><CardTitle>Permission matrix (example)</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              48 permission toggles loaded across Leadership, Finance, Ops Lead, Ops User and Viewer roles.
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardHeader><CardTitle>Role Audit Log</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Target user</TableHead>
                    <TableHead>Performed by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>2026-09-29 05:21</TableCell>
                    <TableCell><Badge>grant</Badge></TableCell>
                    <TableCell>Ops Lead</TableCell>
                    <TableCell>opslead.demo@mml.local</TableCell>
                    <TableCell>admin.demo@mml.local</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>2026-09-29 04:48</TableCell>
                    <TableCell><Badge variant="destructive">revoke</Badge></TableCell>
                    <TableCell>Viewer</TableCell>
                    <TableCell>viewer.demo@mml.local</TableCell>
                    <TableCell>admin.demo@mml.local</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function PermissionsMatrix() {
  const qc = useQueryClient();
  const rolesList: AppRole[] = ["leadership", "finance", "ops_lead", "ops_user", "viewer"];
  const previewRole = usePreviewRole();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["role-permissions-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.from("role_permissions").select("role,key,enabled,sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const map = new Map<string, boolean>();
  for (const r of rows) map.set(`${r.role}|${r.key}`, r.enabled);

  const [draft, setDraft] = useState<Map<string, boolean>>(new Map());
  const [saving, setSaving] = useState(false);

  const get = (role: AppRole, key: string) => {
    const dk = `${role}|${key}`;
    if (draft.has(dk)) return draft.get(dk)!;
    return map.get(dk) ?? false;
  };
  const toggle = (role: AppRole, key: string, val: boolean) => {
    setDraft((d) => { const n = new Map(d); n.set(`${role}|${key}`, val); return n; });
  };

  async function save() {
    if (draft.size === 0) return;
    setSaving(true);
    try {
      const upserts = Array.from(draft.entries()).map(([k, enabled]) => {
        const [role, key] = k.split("|");
        const def = PERMISSIONS.find((p) => p.key === key)!;
        return { role: role as AppRole, key, kind: def.kind, enabled };
      });
      const { error } = await supabase.from("role_permissions").upsert(upserts, { onConflict: "role,key" });
      if (error) throw error;
      toast.success("Permissions updated");
      setDraft(new Map());
      qc.invalidateQueries({ queryKey: ["role-permissions-admin"] });
      qc.invalidateQueries({ queryKey: ["role-permissions-all"] });
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  }

  const groups = Array.from(new Set(PERMISSIONS.map((p) => p.group)));
  const dirty = draft.size > 0;

  return (
    <div className="space-y-4">
      <PreviewAndPresetsBar previewRole={previewRole} onApplied={() => {
        qc.invalidateQueries({ queryKey: ["role-permissions-admin"] });
        qc.invalidateQueries({ queryKey: ["role-permissions-all"] });
      }} />
      <KpiOrderEditor rows={rows} onSaved={() => {
        qc.invalidateQueries({ queryKey: ["role-permissions-admin"] });
        qc.invalidateQueries({ queryKey: ["role-permissions-all"] });
      }} />
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>KPI & Feature permissions per role</CardTitle>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-muted-foreground">{draft.size} pending change(s)</span>}
          <Button size="sm" variant="outline" onClick={() => setDraft(new Map())} disabled={!dirty || saving}>Discard</Button>
          <Button size="sm" onClick={save} disabled={!dirty || saving}>{saving ? "Saving…" : "Save changes"}</Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
        ) : (
          <div className="space-y-6">
            <p className="text-xs text-muted-foreground">
              Super Admin always has access to everything. Items disabled for a role are hidden in that role's UI.
            </p>
            <p className="text-xs text-muted-foreground">
              Super Admin always has user, role, and permission management. These capabilities are not delegated
              to other roles yet.
            </p>
            {groups.map((g) => (
              <PermGroup
                key={g}
                title={g}
                items={PERMISSIONS.filter((p) => p.group === g)}
                roles={rolesList}
                get={get}
                toggle={toggle}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
    </div>
  );
}

function PermGroup({
  title, items, roles, get, toggle,
}: {
  title: string;
  items: PermDef[];
  roles: AppRole[];
  get: (role: AppRole, key: string) => boolean;
  toggle: (role: AppRole, key: string, val: boolean) => void;
}) {
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div className="bg-muted/50 px-3 py-2 text-sm font-semibold">{title}</div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[240px]">Item</TableHead>
              <TableHead className="text-center whitespace-nowrap">Super Admin</TableHead>
              {roles.map((r) => (
                <TableHead key={r} className="text-center whitespace-nowrap">{ROLE_LABEL[r]}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((p) => (
              <TableRow key={p.key}>
                <TableCell className="text-sm">{p.label}</TableCell>
                {/* Super Admin is read-only: always granted, never delegated. */}
                <TableCell className="text-center">
                  <Checkbox checked disabled aria-label={`Super Admin always has ${p.label}`} />
                </TableCell>
                {roles.map((r) => (
                  <TableCell key={r} className="text-center">
                    <Checkbox
                      checked={ADMIN_ONLY_PERM_KEYS.includes(p.key as never) ? false : get(r, p.key)}
                      disabled={ADMIN_ONLY_PERM_KEYS.includes(p.key as never)}
                      onCheckedChange={(v) => toggle(r, p.key, Boolean(v))}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ---- Preview-as-role + Preset templates ----
const PRESET_ROLE_DEFAULTS: Record<string, string[]> = {
  viewer: ["kpi_total_transactions", "kpi_public_cloud", "kpi_private_cloud"],
  ops_user: [
    "kpi_total_transactions", "kpi_public_cloud", "kpi_private_cloud",
    "kpi_total_users", "kpi_current_month_users",
    "chart_tx_by_month", "feature_master_adr_entry",
  ],
  ops_lead: [
    "kpi_total_transactions", "kpi_public_cloud", "kpi_private_cloud",
    "kpi_total_users", "kpi_current_month_users", "kpi_avg_cost",
    "chart_tx_by_month", "chart_pub_priv", "chart_provider", "chart_lob",
    "feature_master_adr_entry", "feature_customer_edit", "feature_excel_export", "feature_reports_access",
  ],
  finance: [
    "kpi_total_revenue", "kpi_total_input_cost", "kpi_total_profit", "kpi_margin",
    "kpi_avg_cost", "kpi_current_month_revenue", "kpi_current_month_profit",
    "chart_revenue_by_month", "chart_top_revenue", "chart_top_profit",
    "feature_excel_export", "feature_reports_access",
  ],
  leadership: PERMISSIONS.filter((p) => p.kind === "kpi").map((p) => p.key)
    .concat(["feature_reports_access", "feature_excel_export"]),
};
const PRESETS = Object.keys(PRESET_ROLE_DEFAULTS);

function PreviewAndPresetsBar({ previewRole, onApplied }: { previewRole: AppRole | null; onApplied: () => void }) {
  const rolesList: AppRole[] = ["leadership", "finance", "ops_lead", "ops_user", "viewer"];
  const [presetRole, setPresetRole] = useState<string>("viewer");
  const [targetRole, setTargetRole] = useState<AppRole>("viewer");
  const [applying, setApplying] = useState(false);

  async function applyPreset() {
    setApplying(true);
    try {
      const enabledKeys = new Set(PRESET_ROLE_DEFAULTS[presetRole] ?? []);
      const upserts = PERMISSIONS.map((p) => ({
        role: targetRole, key: p.key, kind: p.kind, enabled: enabledKeys.has(p.key),
      }));
      const { error } = await supabase.from("role_permissions").upsert(upserts, { onConflict: "role,key" });
      if (error) throw error;
      toast.success(`Applied "${ROLE_LABEL[presetRole as AppRole] ?? presetRole}" preset to ${ROLE_LABEL[targetRole]}`);
      onApplied();
    } catch (e) { toast.error((e as Error).message); } finally { setApplying(false); }
  }

  return (
    <Card>
      <CardContent className="pt-6 flex flex-wrap items-end gap-6">
        <div className="space-y-1.5">
          <Label className="text-xs">Preview as role</Label>
          <div className="flex items-center gap-2">
            <Select value={previewRole ?? "__none"} onValueChange={(v) => setPreviewRole(v === "__none" ? null : (v as AppRole))}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Super Admin (you)</SelectItem>
                {rolesList.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
              </SelectContent>
            </Select>
            {previewRole && (
              <Button size="sm" variant="outline" onClick={() => setPreviewRole(null)}>Clear</Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">Affects the dashboard & sidebar in your current session.</p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Apply preset template</Label>
          <div className="flex items-center gap-2">
            <Select value={presetRole} onValueChange={setPresetRole}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRESETS.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r as AppRole] ?? r}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">→</span>
            <Select value={targetRole} onValueChange={(v) => setTargetRole(v as AppRole)}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {rolesList.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={applyPreset} disabled={applying}>{applying ? "Applying…" : "Apply"}</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Overwrites all permissions for the target role.</p>
        </div>
      </CardContent>
    </Card>
  );
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m}m ${r}s`;
}

function ExportJobsPanel() {
  const jobs = useExportJobs();
  const [status, setStatus] = useState<"all" | ExportJob["status"]>("all");
  const [jobType, setJobType] = useState<string>("__all");
  const [requestedBy, setRequestedBy] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<ExportJob | null>(null);
  const PAGE_SIZE = 25;

  const [retention, setRetention] = useState<number>(getRetentionDays());
  const [lastCleaned, setLastCleaned] = useState<number | null>(getLastCleanedAt());
  const retentionError = validateRetentionDays(retention);
  const nextCleanup = getNextCleanupAt(retention);

  // Auto-run cleanup once per page-mount so retention is always enforced.
  useEffect(() => {
    runCleanup();
    setLastCleaned(getLastCleanedAt());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derive job-type options from observed scopes (e.g. customers-all, customer-audit)
  const jobTypes = Array.from(new Set(jobs.map((j) => baseType(j.scope)))).sort();

  const filtered = jobs.filter((j) => {
    if (status !== "all" && j.status !== status) return false;
    if (jobType !== "__all" && baseType(j.scope) !== jobType) return false;
    if (requestedBy && !((j.user ?? "").toLowerCase().includes(requestedBy.toLowerCase()))) return false;
    if (from && j.startedAt < new Date(from).getTime()) return false;
    if (to) { const end = new Date(to); end.setHours(23, 59, 59, 999); if (j.startedAt > end.getTime()) return false; }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const paginated = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  function reset() { setStatus("all"); setJobType("__all"); setRequestedBy(""); setFrom(""); setTo(""); setPage(1); }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Async Export Jobs</CardTitle>
            <Button size="sm" variant="outline" onClick={() => { if (confirm("Clear all job history on this browser?")) clearJobs(); }}>
              Clear history
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Async Excel exports run in the browser. This log records jobs started on this device.
          </p>
          <div
            className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-3"
            data-testid="export-jobs-retention"
          >
            <div className="space-y-1">
              <Label htmlFor="retention-days" className="text-xs">Delete jobs older than (days)</Label>
              <Input
                id="retention-days"
                type="number"
                min={1}
                className="w-32"
                value={retention}
                aria-invalid={retentionError ? true : undefined}
                onChange={(e) => setRetention(Number(e.target.value))}
              />
              {retentionError && (
                <div className="text-[11px] text-destructive" data-testid="retention-error">
                  {retentionError}
                </div>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!!retentionError}
              onClick={() => {
                setRetentionDays(retention);
                toast.success(`Retention set to ${retention} day(s)`);
              }}
            >
              Save retention
            </Button>
            <Button
              size="sm"
              disabled={!!retentionError}
              onClick={() => {
                const removed = runCleanup(retention);
                setLastCleaned(getLastCleanedAt());
                toast.success(removed > 0 ? `Removed ${removed} old job(s)` : "No jobs needed cleanup");
              }}
            >
              Run cleanup now
            </Button>
            <div className="ml-auto text-right text-xs text-muted-foreground space-y-0.5">
              <div data-testid="last-cleaned-at">
                Last cleaned at:{" "}
                {lastCleaned ? format(new Date(lastCleaned), "yyyy-MM-dd HH:mm:ss") : "never"}
              </div>
              <div data-testid="next-cleanup-at">
                Next cleanup at:{" "}
                {nextCleanup
                  ? `${format(new Date(nextCleanup), "yyyy-MM-dd HH:mm:ss")} (when this panel is next opened)`
                  : "on next page load"}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            <Select value={jobType} onValueChange={(v) => { setJobType(v); setPage(1); }}>
              <SelectTrigger><SelectValue placeholder="Job type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All job types</SelectItem>
                {jobTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => { setStatus(v as any); setPage(1); }}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="done">Done</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="Requested by" value={requestedBy} onChange={(e) => { setRequestedBy(e.target.value); setPage(1); }} />
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div>{filtered.length} of {jobs.length} jobs</div>
            <Button size="sm" variant="ghost" onClick={reset}>Reset filters</Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Requested by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Progress</TableHead>
                <TableHead className="text-right">Attempts</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead>Last error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No export jobs match the filters.</TableCell></TableRow>
              )}
              {paginated.map((j) => {
                const dur = (j.endedAt ?? Date.now()) - j.startedAt;
                const pct = j.total > 0 ? Math.round((j.processed / j.total) * 100) : 0;
                const variant =
                  j.status === "done" ? "default" :
                  j.status === "error" ? "destructive" :
                  j.status === "cancelled" ? "secondary" : "outline";
                return (
                  <TableRow key={j.id}>
                    <TableCell className="whitespace-nowrap text-sm">{format(new Date(j.startedAt), "yyyy-MM-dd HH:mm:ss")}</TableCell>
                    <TableCell className="text-sm">{baseType(j.scope)}</TableCell>
                    <TableCell className="text-xs font-mono max-w-[240px] truncate" title={j.filename}>{j.filename}</TableCell>
                    <TableCell className="text-sm">{j.user ?? "—"}</TableCell>
                    <TableCell><Badge variant={variant as any}>{j.status}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums">{j.processed.toLocaleString()} / {j.total.toLocaleString()} ({pct}%)</TableCell>
                    <TableCell className="text-right tabular-nums">{j.attempts}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtDuration(dur)}</TableCell>
                    <TableCell className="text-xs">
                      {j.error ? (
                        <Button size="sm" variant="ghost" className="h-auto p-1 text-destructive" onClick={() => setViewing(j)}>
                          View error
                        </Button>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between text-sm">
            <div className="text-muted-foreground">
              {filtered.length === 0 ? "0 results" :
                `${(current - 1) * PAGE_SIZE + 1}–${Math.min(current * PAGE_SIZE, filtered.length)} of ${filtered.length}`}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={current <= 1} onClick={() => setPage(current - 1)}>Previous</Button>
              <span className="text-muted-foreground">Page {current} of {totalPages}</span>
              <Button size="sm" variant="outline" disabled={current >= totalPages} onClick={() => setPage(current + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <ExportJobErrorDrawer job={viewing} onClose={() => setViewing(null)} />
    </>
  );
}

function baseType(scope: string): string {
  // e.g. "customers-all-filtered" -> "customers"
  const dash = scope.indexOf("-");
  return dash > 0 ? scope.slice(0, dash) : scope;
}

function ExportJobErrorDrawer({ job, onClose }: { job: ExportJob | null; onClose: () => void }) {
  const canRetry = job ? hasRetryHandler(job.scope) : false;
  function onRetry() {
    if (!job) return;
    const ok = retryJob({ id: job.id, scope: job.scope });
    if (ok) {
      toast.success("Retrying export…");
      onClose();
    } else {
      toast.error("Open the page that started this export to retry it.");
    }
  }
  return (
    <Dialog open={!!job} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export job error</DialogTitle>
          <DialogDescription>
            {job ? `${job.filename} — started ${format(new Date(job.startedAt), "yyyy-MM-dd HH:mm:ss")}` : ""}
          </DialogDescription>
        </DialogHeader>
        {job && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Job type" value={baseType(job.scope)} />
              <Field label="Scope" value={job.scope} />
              <Field label="Status" value={job.status} />
              <Field label="Attempts" value={String(job.attempts)} />
              <Field label="Requested by" value={job.user ?? "—"} />
              <Field label="Duration" value={fmtDuration((job.endedAt ?? Date.now()) - job.startedAt)} />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Error name</div>
              <div className="font-mono text-xs">{job.errorName ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Message</div>
              <pre className="rounded border bg-muted/30 p-2 text-xs whitespace-pre-wrap break-words">{job.error ?? "—"}</pre>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Stack trace</div>
              <pre className="rounded border bg-muted/30 p-2 text-[11px] leading-snug overflow-auto max-h-72 whitespace-pre">{job.errorStack ?? "No stack trace available."}</pre>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button
            onClick={onRetry}
            disabled={!job}
            title={canRetry ? "Re-run this export with the same parameters" : "Open the source page to retry"}
            data-testid="retry-export-job"
          >
            Retry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

// ---- KPI order editor (per role) ----
function KpiOrderEditor({ rows, onSaved }: {
  rows: { role: string; key: string; enabled: boolean; sort_order: number }[];
  onSaved: () => void;
}) {
  const rolesList: AppRole[] = ["leadership", "finance", "ops_lead", "ops_user", "viewer"];
  const [role, setRole] = useState<AppRole>("viewer");
  const [saving, setSaving] = useState(false);

  const kpiDefs = PERMISSIONS.filter((p) => p.kind === "kpi");

  const initial = kpiDefs
    .map((p) => {
      const r = rows.find((x) => x.role === role && x.key === p.key);
      return { key: p.key, label: p.label, sort: r?.sort_order ?? 0, enabled: r?.enabled ?? false };
    })
    .sort((a, b) => a.sort - b.sort || kpiDefs.findIndex((d) => d.key === a.key) - kpiDefs.findIndex((d) => d.key === b.key));

  const [list, setList] = useState(initial);
  // Reset when role changes
  const roleKey = role + ":" + rows.length;
  const [snapshot, setSnapshot] = useState(roleKey);
  if (snapshot !== roleKey) { setSnapshot(roleKey); setList(initial); }

  const move = (idx: number, dir: -1 | 1) => {
    setList((cur) => {
      const n = cur.slice();
      const j = idx + dir;
      if (j < 0 || j >= n.length) return cur;
      [n[idx], n[j]] = [n[j], n[idx]];
      return n;
    });
  };

  async function save() {
    setSaving(true);
    try {
      const upserts = list.map((item, idx) => {
        const def = kpiDefs.find((d) => d.key === item.key)!;
        return { role, key: item.key, kind: def.kind, enabled: item.enabled, sort_order: idx };
      });
      const { error } = await supabase.from("role_permissions").upsert(upserts, { onConflict: "role,key" });
      if (error) throw error;
      toast.success(`Saved KPI layout for ${ROLE_LABEL[role]}`);
      onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>KPI card layout per role</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">Reorder and toggle KPI cards as they appear on the dashboard for the selected role.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {rolesList.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save layout"}</Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {list.map((item, idx) => (
            <div key={item.key} className="flex items-center justify-between gap-2 border border-border rounded-md p-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-muted-foreground w-6 text-right">{idx + 1}.</span>
                <Checkbox
                  checked={item.enabled}
                  onCheckedChange={(v) => setList((cur) => cur.map((it, i) => i === idx ? { ...it, enabled: Boolean(v) } : it))}
                />
                <span className="text-sm truncate">{item.label}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(idx, -1)} disabled={idx === 0}>↑</Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(idx, 1)} disabled={idx === list.length - 1}>↓</Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Permission audit log ----
function PermissionAuditLog() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["permission-audit-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("permission_audit_log")
        .select("id, role, perm_key, perm_kind, action, old_enabled, new_enabled, old_sort_order, new_sort_order, changed_by_email, changed_at")
        .order("changed_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const labelFor = (k: string) => PERMISSIONS.find((p) => p.key === k)?.label ?? k;

  return (
    <Card>
      <CardHeader><CardTitle>Permission Audit Log</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Change</TableHead>
              <TableHead>By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>}
            {!isLoading && data.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No permission changes yet.</TableCell></TableRow>}
            {data.map((a) => {
              const parts: string[] = [];
              if (a.old_enabled !== a.new_enabled) {
                parts.push(`${a.old_enabled === null ? "—" : a.old_enabled ? "on" : "off"} → ${a.new_enabled === null ? "—" : a.new_enabled ? "on" : "off"}`);
              }
              if (a.old_sort_order !== a.new_sort_order) {
                parts.push(`order ${a.old_sort_order ?? "—"} → ${a.new_sort_order ?? "—"}`);
              }
              return (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap text-sm">{format(new Date(a.changed_at), "yyyy-MM-dd HH:mm")}</TableCell>
                  <TableCell><Badge variant="secondary">{ROLE_LABEL[a.role as AppRole] ?? a.role}</Badge></TableCell>
                  <TableCell className="text-sm">
                    <span className="text-muted-foreground mr-1 uppercase text-[10px]">{a.perm_kind}</span>
                    {labelFor(a.perm_key)}
                  </TableCell>
                  <TableCell className="text-sm">
                    <Badge variant={a.action === "delete" ? "destructive" : "default"} className="mr-2">{a.action}</Badge>
                    {parts.join(" · ")}
                  </TableCell>
                  <TableCell className="text-sm">{a.changed_by_email ?? "system"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function randomTempPassword(len = 14): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
}

function UserRow({
  user, isSelf, isLastAdmin, canManage, canDelete, canReset,
  onSave, onSetActive, onDelete, onResetPassword,
}: {
  user: { id: string; email: string | null; full_name: string | null; is_active: boolean; roles: { role: AppRole; id: string }[] };
  isSelf: boolean;
  isLastAdmin: boolean;
  canManage: boolean;
  canDelete: boolean;
  canReset: boolean;
  onSave: (v: { fullName?: string; email?: string; isActive?: boolean; roles?: AppRole[] }) => Promise<void>;
  onSetActive: (active: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
  onResetPassword: (tempPassword: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<AppRole[]>(user.roles.map((r) => r.role));
  const [fullName, setFullName] = useState(user.full_name ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [active, setActive] = useState(user.is_active);
  const [busy, setBusy] = useState(false);

  const [resetOpen, setResetOpen] = useState(false);
  const [tempPassword, setTempPassword] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const toggle = (r: AppRole) =>
    setSelected((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

  async function save() {
    if (selected.length === 0) return toast.error("Pick at least one role.");
    if (!email.trim()) return toast.error("Email is required.");
    setBusy(true);
    try {
      const payload: { fullName?: string; email?: string; isActive?: boolean; roles?: AppRole[] } = {};
      if (fullName.trim() && fullName.trim() !== (user.full_name ?? "")) payload.fullName = fullName.trim();
      const nextEmail = email.trim().toLowerCase();
      if (nextEmail !== (user.email ?? "").toLowerCase()) payload.email = nextEmail;
      const before = user.roles.map((r) => r.role).sort().join(",");
      const after = [...selected].sort().join(",");
      if (before !== after) payload.roles = selected;
      if (active !== user.is_active) payload.isActive = active;
      if (Object.keys(payload).length === 0) { setEditing(false); return; }
      await onSave(payload);
      setEditing(false);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  async function toggleActive(next: boolean) {
    setBusy(true);
    try { await onSetActive(next); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  async function doReset() {
    if (tempPassword.length < 8) return toast.error("Temporary password must be at least 8 characters.");
    setBusy(true);
    try {
      await onResetPassword(tempPassword);
      setResetOpen(false);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  async function doDelete() {
    setBusy(true);
    try { await onDelete(); setDeleteOpen(false); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{user.full_name ?? user.email}</div>
        <div className="text-xs text-muted-foreground">{user.email}{isSelf && " (you)"}</div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {user.roles.length === 0 && <span className="text-xs text-muted-foreground">No roles</span>}
          {user.roles.map((r) => (
            <Badge key={r.id} variant={r.role === "admin" ? "default" : "secondary"}>{ROLE_LABEL[r.role]}</Badge>
          ))}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Switch checked={user.is_active} disabled={busy || isSelf || !canManage} onCheckedChange={toggleActive} />
          <span className="text-xs text-muted-foreground">{user.is_active ? "Active" : "Disabled"}</span>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-wrap items-center gap-1 justify-end">
          {canManage && (
            <Dialog
              open={editing}
              onOpenChange={(o) => {
                setEditing(o);
                if (o) {
                  setSelected(user.roles.map((r) => r.role));
                  setFullName(user.full_name ?? "");
                  setEmail(user.email ?? "");
                  setActive(user.is_active);
                }
              }}
            >
              <DialogTrigger asChild><Button size="sm" variant="outline">Edit</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit user</DialogTitle>
                  <DialogDescription>{user.email}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="edit-user-email" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Full name</Label>
                    <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Roles</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {ROLES.map((r) => (
                        <label key={r} className="flex items-center gap-2 text-sm rounded-md border border-border p-2">
                          <Checkbox checked={selected.includes(r)} onCheckedChange={() => toggle(r)} />
                          <span>{ROLE_LABEL[r]}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={active} disabled={isSelf} onCheckedChange={setActive} data-testid="edit-user-status" />
                    <span className="text-sm">{active ? "Active" : "Disabled"}</span>
                    {isSelf && <span className="text-xs text-muted-foreground">(you cannot disable yourself)</span>}
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                  <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          {canReset && (
            <Dialog
              open={resetOpen}
              onOpenChange={(o) => { setResetOpen(o); if (o) setTempPassword(randomTempPassword()); }}
            >
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" data-testid="reset-password-open">Reset password</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Set a temporary password</DialogTitle>
                  <DialogDescription>
                    {user.email} will sign in with this password and should change it immediately.
                    It is never emailed — copy it now and share it securely.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label>Temporary password</Label>
                  <div className="flex gap-2">
                    <Input value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} data-testid="temp-password-input" />
                    <Button variant="outline" onClick={() => setTempPassword(randomTempPassword())}>Regenerate</Button>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setResetOpen(false)}>Cancel</Button>
                  <Button onClick={doReset} disabled={busy} data-testid="reset-password-confirm">
                    {busy ? "Saving…" : "Set password"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          {canDelete && (
            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={isSelf || isLastAdmin}
                  title={isSelf ? "You cannot delete your own account" : isLastAdmin ? "Cannot delete the last Super Admin" : "Delete this user"}
                  data-testid="delete-user-open"
                >
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete user</AlertDialogTitle>
                  <AlertDialogDescription>
                    Permanently delete {user.email}? This removes their login and cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={(e) => { e.preventDefault(); void doDelete(); }} data-testid="delete-user-confirm">
                    {busy ? "Deleting…" : "Delete permanently"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function CreateUserDialog({ onCreate }: { onCreate: (v: { email: string; password: string; fullName: string; roles: AppRole[]; isActive: boolean }) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [roles, setRoles] = useState<AppRole[]>(["viewer"]);
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);

  const toggle = (r: AppRole) => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

  async function submit() {
    if (!email || !password || !fullName || roles.length === 0) return toast.error("Fill all fields and pick a role.");
    if (password.length < 8) return toast.error("Password must be at least 8 characters.");
    setBusy(true);
    try {
      await onCreate({ email: email.trim().toLowerCase(), password, fullName: fullName.trim(), roles, isActive });
      setOpen(false); setEmail(""); setPassword(""); setFullName(""); setRoles(["viewer"]); setIsActive(true);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Add user</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add new user</DialogTitle>
          <DialogDescription>User is created with a confirmed email; emails must be unique.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Full name</Label><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>Temporary password</Label>
            <div className="flex gap-2">
              <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button variant="outline" onClick={() => setPassword(randomTempPassword())}>Generate</Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Roles</Label>
            <div className="grid grid-cols-2 gap-2">
              {ROLES.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm rounded-md border border-border p-2">
                  <Checkbox checked={roles.includes(r)} onCheckedChange={() => toggle(r)} />
                  <span>{ROLE_LABEL[r]}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} data-testid="create-user-status" />
            <span className="text-sm">{isActive ? "Active" : "Disabled"}</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create user"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountManagersAdmin() {
  const qc = useQueryClient();
  const upsert = useServerFn(upsertAccountManagerFn);
  const setActive = useServerFn(setAccountManagerActiveFn);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["am-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_managers")
        .select("id, name, email, is_active, created_at")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  async function add() {
    if (!name.trim()) return toast.error("Name is required");
    setBusy(true);
    try {
      await upsert({ data: { name, email: email || null } });
      toast.success("Account manager saved");
      setName(""); setEmail("");
      qc.invalidateQueries({ queryKey: ["am-admin"] });
      qc.invalidateQueries({ queryKey: ["account-managers"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  }

  async function toggle(id: string, current: boolean) {
    try {
      await setActive({ data: { id, active: !current } });
      qc.invalidateQueries({ queryKey: ["am-admin"] });
      qc.invalidateQueries({ queryKey: ["account-managers"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Account Managers</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
          <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Email (optional)</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <Button onClick={add} disabled={busy}>{busy ? "Saving…" : "Add account manager"}</Button>
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>}
            {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No account managers yet.</TableCell></TableRow>}
            {rows.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-sm">{r.email ?? "—"}</TableCell>
                <TableCell><Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => toggle(r.id, r.is_active)}>{r.is_active ? "Disable" : "Enable"}</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function CustomerAuditLog() {
  const { user: me } = useAuth();
  const [customer, setCustomer] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("__all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["customer-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_audit_log")
        .select("id, customer_id, customer_name, action, changes, changed_by, changed_by_email, changed_at")
        .order("changed_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = rows.filter((a: any) => {
    if (action !== "__all" && a.action !== action) return false;
    if (customer && !(a.customer_name ?? "").toLowerCase().includes(customer.toLowerCase())) return false;
    if (actor && !((a.changed_by_email ?? "") + (a.changed_by ?? "")).toLowerCase().includes(actor.toLowerCase())) return false;
    if (from) { if (new Date(a.changed_at) < new Date(from)) return false; }
    if (to) {
      const end = new Date(to); end.setHours(23, 59, 59, 999);
      if (new Date(a.changed_at) > end) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a: any, b: any) => {
    const av = new Date(a.changed_at).getTime();
    const bv = new Date(b.changed_at).getTime();
    return sortDir === "asc" ? av - bv : bv - av;
  });

  function exportAudit() {
    const data = sorted.map((a: any) => ({
      When: format(new Date(a.changed_at), "yyyy-MM-dd HH:mm:ss"),
      Action: a.action,
      Customer: a.customer_name ?? a.customer_id,
      "Acting User": a.changed_by_email ?? a.changed_by ?? "system",
      "Deactivation Reason": a.action === "deactivate"
        ? (a.changes?.deactivation_reason ?? "")
        : "",
      Changes: a.changes ? JSON.stringify(a.changes) : "",
    }));
    exportToExcel("customer-audit-log", data, {
      generatedBy: me?.email ?? "—",
      filters: { customer, actor, action, from, to, sortBy: "changed_at", sortDir },
    });
  }

  return (
    <Card>
      <CardHeader><CardTitle>Customer Audit Log</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <Input placeholder="Customer" value={customer} onChange={(e) => setCustomer(e.target.value)} />
          <Input placeholder="Acting user (email)" value={actor} onChange={(e) => setActor(e.target.value)} />
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger><SelectValue placeholder="Action" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All actions</SelectItem>
              <SelectItem value="create">Create</SelectItem>
              <SelectItem value="update">Update</SelectItem>
              <SelectItem value="activate">Activate</SelectItem>
              <SelectItem value="deactivate">Deactivate</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">{sorted.length} of {rows.length} entries</div>
          <Button size="sm" variant="outline" onClick={exportAudit} disabled={sorted.length === 0}>
            <Download className="h-4 w-4 mr-1" />Export to Excel
          </Button>
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>
              <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSortDir((d) => d === "asc" ? "desc" : "asc")}>
                When <ArrowUpDown className="h-3 w-3 opacity-60" />
              </button>
            </TableHead>
            <TableHead>Action</TableHead><TableHead>Customer</TableHead><TableHead>Changes</TableHead><TableHead>By</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>}
            {!isLoading && sorted.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No matching customer audit entries.</TableCell></TableRow>}
            {sorted.map((a: any) => (
              <TableRow key={a.id}>
                <TableCell className="whitespace-nowrap text-sm">{format(new Date(a.changed_at), "yyyy-MM-dd HH:mm")}</TableCell>
                <TableCell><Badge variant={a.action === "deactivate" ? "destructive" : a.action === "create" ? "default" : "secondary"}>{a.action}</Badge></TableCell>
                <TableCell className="text-sm">{a.customer_name ?? a.customer_id}</TableCell>
                <TableCell className="text-xs font-mono max-w-[420px] truncate" title={JSON.stringify(a.changes)}>{a.changes ? JSON.stringify(a.changes) : "—"}</TableCell>
                <TableCell className="text-sm">{a.changed_by_email ?? a.changed_by ?? "system"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}