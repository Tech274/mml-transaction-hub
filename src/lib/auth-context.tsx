import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";
import { CAPTURE_PERSONAS, getCaptureRole } from "@/lib/capture-persona";

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
  const isCaptureMode = isSuperadminCaptureModeEnabled(getSuperadminCaptureModeEnvForClient());

  useEffect(() => {
    if (isCaptureMode) {
      const captureEnv = getSuperadminCaptureModeEnvForClient();
      const captureRole = getCaptureRole(
        captureEnv,
        typeof window !== "undefined" ? window.location.search : "",
      ) as AppRole;
      const persona = CAPTURE_PERSONAS[captureRole];
      const captureIdByRole: Record<AppRole, string> = {
        admin: "00000000-0000-4000-8000-000000000001",
        leadership: "00000000-0000-4000-8000-000000000002",
        finance: "00000000-0000-4000-8000-000000000003",
        ops_lead: "00000000-0000-4000-8000-000000000004",
        ops_user: "00000000-0000-4000-8000-000000000005",
        viewer: "00000000-0000-4000-8000-000000000006",
      };
      const captureUser = {
        id: captureIdByRole[captureRole],
        aud: "authenticated",
        role: "authenticated",
        email: persona.email,
        created_at: "2026-01-01T00:00:00.000Z",
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: { full_name: persona.personName },
      } as unknown as User;
      setUser(captureUser);
      setRoles([captureRole]);
      setLoading(false);
      return;
    }

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
  }, [isCaptureMode, qc, router]);

  const hasRole = (r: AppRole) => roles.includes(r);
  const hasAnyRole = (rs: AppRole[]) => rs.some((r) => roles.includes(r));

  const signOut = async () => {
    if (isCaptureMode) {
      window.location.href = "/dashboard";
      return;
    }
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
