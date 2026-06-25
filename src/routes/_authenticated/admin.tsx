import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  adminCreateUser, adminSetUserRoles, adminSetUserActive, adminUpdateUserProfile,
} from "@/lib/admin.functions";
import { format } from "date-fns";
import { PERMISSIONS, type PermDef, setPreviewRole, usePreviewRole } from "@/lib/permissions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/admin")({
  ssr: false,
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/auth" });
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) throw redirect({ to: "/dashboard" });
  },
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
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const createUserFn = useServerFn(adminCreateUser);
  const setRolesFn = useServerFn(adminSetUserRoles);
  const setActiveFn = useServerFn(adminSetUserActive);
  const updateProfileFn = useServerFn(adminUpdateUserProfile);

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
                      onSetRoles={async (roles) => { await setRolesFn({ data: { userId: u.id, roles } }); toast.success("Roles updated"); refresh(); }}
                      onSetActive={async (active) => { await setActiveFn({ data: { userId: u.id, active } }); toast.success(active ? "User enabled" : "User disabled"); refresh(); }}
                      onSaveProfile={async (fullName) => { await updateProfileFn({ data: { userId: u.id, fullName } }); toast.success("Profile updated"); refresh(); }}
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
              {roles.map((r) => (
                <TableHead key={r} className="text-center whitespace-nowrap">{ROLE_LABEL[r]}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((p) => (
              <TableRow key={p.key}>
                <TableCell className="text-sm">{p.label}</TableCell>
                {roles.map((r) => (
                  <TableCell key={r} className="text-center">
                    <Checkbox checked={get(r, p.key)} onCheckedChange={(v) => toggle(r, p.key, Boolean(v))} />
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

function UserRow({
  user, isSelf, onSetRoles, onSetActive, onSaveProfile,
}: {
  user: { id: string; email: string | null; full_name: string | null; is_active: boolean; roles: { role: AppRole; id: string }[] };
  isSelf: boolean;
  onSetRoles: (roles: AppRole[]) => Promise<void>;
  onSetActive: (active: boolean) => Promise<void>;
  onSaveProfile: (fullName: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<AppRole[]>(user.roles.map((r) => r.role));
  const [fullName, setFullName] = useState(user.full_name ?? "");
  const [busy, setBusy] = useState(false);

  const toggle = (r: AppRole) =>
    setSelected((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

  async function save() {
    if (selected.length === 0) return toast.error("Pick at least one role.");
    setBusy(true);
    try {
      if (fullName.trim() && fullName.trim() !== (user.full_name ?? "")) await onSaveProfile(fullName.trim());
      const before = user.roles.map((r) => r.role).sort().join(",");
      const after = [...selected].sort().join(",");
      if (before !== after) await onSetRoles(selected);
      setEditing(false);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  async function toggleActive(next: boolean) {
    setBusy(true);
    try { await onSetActive(next); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
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
          <Switch checked={user.is_active} disabled={busy || isSelf} onCheckedChange={toggleActive} />
          <span className="text-xs text-muted-foreground">{user.is_active ? "Active" : "Disabled"}</span>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <Dialog open={editing} onOpenChange={(o) => { setEditing(o); if (o) { setSelected(user.roles.map((r) => r.role)); setFullName(user.full_name ?? ""); } }}>
          <DialogTrigger asChild><Button size="sm" variant="outline">Edit</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit user</DialogTitle>
              <DialogDescription>{user.email}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
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
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TableCell>
    </TableRow>
  );
}

function CreateUserDialog({ onCreate }: { onCreate: (v: { email: string; password: string; fullName: string; roles: AppRole[] }) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [roles, setRoles] = useState<AppRole[]>(["viewer"]);
  const [busy, setBusy] = useState(false);

  const toggle = (r: AppRole) => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

  async function submit() {
    if (!email || !password || !fullName || roles.length === 0) return toast.error("Fill all fields and pick a role.");
    if (password.length < 8) return toast.error("Password must be at least 8 characters.");
    setBusy(true);
    try {
      await onCreate({ email: email.trim().toLowerCase(), password, fullName: fullName.trim(), roles });
      setOpen(false); setEmail(""); setPassword(""); setFullName(""); setRoles(["viewer"]);
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
          <div className="space-y-1.5"><Label>Temporary password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create user"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}