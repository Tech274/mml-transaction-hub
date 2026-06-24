import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth, type AppRole } from "@/lib/auth-context";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
});

const ROLES: AppRole[] = ["admin", "leadership", "finance", "ops_lead", "ops_user", "viewer"];

function AdminPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();

  const { data: users = [] } = useQuery({
    queryKey: ["admin-users"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data: profiles } = await supabase.from("profiles").select("id, email, full_name, is_active, created_at").order("created_at");
      const { data: roles } = await supabase.from("user_roles").select("user_id, role, id");
      const rolesByUser = new Map<string, { role: AppRole; id: string }[]>();
      for (const r of roles ?? []) {
        const arr = rolesByUser.get(r.user_id) ?? [];
        arr.push({ role: r.role as AppRole, id: r.id });
        rolesByUser.set(r.user_id, arr);
      }
      return (profiles ?? []).map((p) => ({ ...p, roles: rolesByUser.get(p.id) ?? [] }));
    },
  });

  if (!isAdmin) {
    return (
      <AppShell title="Admin Settings">
        <Card><CardContent className="py-12 text-center text-muted-foreground">Admins only.</CardContent></Card>
      </AppShell>
    );
  }

  return (
    <AppShell title="Admin Settings">
      <Card>
        <CardHeader><CardTitle>Users & Roles</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Current Roles</TableHead>
                <TableHead>Grant Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <UserRow key={u.id} user={u} onChanged={() => qc.invalidateQueries({ queryKey: ["admin-users"] })} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}

function UserRow({
  user, onChanged,
}: { user: { id: string; email: string | null; full_name: string | null; roles: { role: AppRole; id: string }[] }; onChanged: () => void }) {
  const [pending, setPending] = useState<AppRole | "">("");

  async function grant() {
    if (!pending) return;
    const { error } = await supabase.from("user_roles").insert({ user_id: user.id, role: pending });
    if (error) return toast.error(error.message);
    toast.success(`Granted ${pending}`);
    setPending("");
    onChanged();
  }

  async function revoke(roleId: string) {
    const { error } = await supabase.from("user_roles").delete().eq("id", roleId);
    if (error) return toast.error(error.message);
    onChanged();
  }

  const heldRoles = user.roles.map((r) => r.role);
  const available = ROLES.filter((r) => !heldRoles.includes(r));

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{user.full_name ?? user.email}</div>
        <div className="text-xs text-muted-foreground">{user.email}</div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {user.roles.length === 0 && <span className="text-xs text-muted-foreground">No roles</span>}
          {user.roles.map((r) => (
            <Badge key={r.id} variant="secondary" className="gap-1">
              {r.role.replace("_", " ")}
              <button onClick={() => revoke(r.id)} className="ml-1 hover:text-destructive">×</button>
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex gap-2">
          <Select value={pending} onValueChange={(v) => setPending(v as AppRole)}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Select role" /></SelectTrigger>
            <SelectContent>
              {available.map((r) => <SelectItem key={r} value={r}>{r.replace("_", " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={!pending} onClick={grant}>Grant</Button>
        </div>
      </TableCell>
    </TableRow>
  );
}