import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";

export type AppRole = "admin" | "leadership" | "finance" | "ops_lead" | "ops_user" | "viewer";

interface AuthState {
  user: User | null;
  roles: AppRole[];
  loading: boolean;
  hasRole: (r: AppRole) => boolean;
  hasAnyRole: (rs: AppRole[]) => boolean;
  canEditTransactions: boolean;
  isAdmin: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    const loadRoles = async (u: User | null) => {
      if (!u) {
        if (mounted) setRoles([]);
        return;
      }
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", u.id);
      if (mounted) setRoles((data ?? []).map((r) => r.role as AppRole));
    };

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setUser(data.session?.user ?? null);
      await loadRoles(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      setUser(session?.user ?? null);
      setTimeout(() => {
        loadRoles(session?.user ?? null);
      }, 0);
      router.invalidate();
      if (event !== "SIGNED_OUT") qc.invalidateQueries();
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [qc, router]);

  const hasRole = (r: AppRole) => roles.includes(r);
  const hasAnyRole = (rs: AppRole[]) => rs.some((r) => roles.includes(r));

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    window.location.href = "/auth";
  };

  return (
    <Ctx.Provider
      value={{
        user,
        roles,
        loading,
        hasRole,
        hasAnyRole,
        canEditTransactions: hasAnyRole(["admin", "ops_lead", "ops_user"]),
        isAdmin: hasRole("admin"),
        signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
