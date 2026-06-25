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
import { PERMISSIONS, type PermDef } from "@/lib/permissions";

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