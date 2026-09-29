export const SUPERADMIN_CAPTURE_ROLE_ENV_VAR = "VITE_SUPERADMIN_CAPTURE_ROLE" as const;
export const SUPERADMIN_CAPTURE_ROLE_QUERY_PARAM = "captureRole" as const;

export type CaptureRole = "admin" | "leadership" | "finance" | "ops_lead" | "ops_user" | "viewer";

export interface CapturePersona {
  role: CaptureRole;
  roleLabel: string;
  personName: string;
  email: string;
  dashboardSummary: string;
}

export const CAPTURE_PERSONAS: Record<CaptureRole, CapturePersona> = {
  admin: {
    role: "admin",
    roleLabel: "Super Admin",
    personName: "Admin Demo",
    email: "admin.demo@mml.local",
    dashboardSummary: "Full KPI and chart visibility with all admin navigation.",
  },
  leadership: {
    role: "leadership",
    roleLabel: "Leadership",
    personName: "Meera Krishnan",
    email: "leadership.demo@mml.local",
    dashboardSummary: "Executive KPI-heavy dashboard with business trends and reports access.",
  },
  finance: {
    role: "finance",
    roleLabel: "Finance",
    personName: "Kavya Iyer",
    email: "finance.demo@mml.local",
    dashboardSummary: "Revenue, cost, profit and margin-focused dashboard for commercial review.",
  },
  ops_lead: {
    role: "ops_lead",
    roleLabel: "Ops Lead",
    personName: "Nisha Patel",
    email: "opslead.demo@mml.local",
    dashboardSummary: "Operational KPIs plus reports with expanded chart visibility.",
  },
  ops_user: {
    role: "ops_user",
    roleLabel: "Ops User (Support Agent)",
    personName: "Ritu Sharma",
    email: "ops.demo@mml.local",
    dashboardSummary: "Operational dashboard with personal support queue card and core activity metrics.",
  },
  viewer: {
    role: "viewer",
    roleLabel: "Viewer",
    personName: "Arjun Kapoor",
    email: "viewer.demo@mml.local",
    dashboardSummary: "Read-only high-level dashboard with minimal KPI visibility.",
  },
};

const CAPTURE_ROLE_SET = new Set<CaptureRole>(
  Object.keys(CAPTURE_PERSONAS) as CaptureRole[],
);

export function getCaptureRoleFromSearch(
  search: string,
): CaptureRole | null {
  try {
    const params = new URLSearchParams(search);
    const value = params.get(SUPERADMIN_CAPTURE_ROLE_QUERY_PARAM);
    if (!value || !CAPTURE_ROLE_SET.has(value as CaptureRole)) return null;
    return value as CaptureRole;
  } catch {
    return null;
  }
}

export function getCaptureRole(
  env: Record<string, string | undefined>,
  search: string,
): CaptureRole {
  const fromSearch = getCaptureRoleFromSearch(search);
  if (fromSearch) return fromSearch;
  const fromEnv = env[SUPERADMIN_CAPTURE_ROLE_ENV_VAR];
  if (fromEnv && CAPTURE_ROLE_SET.has(fromEnv as CaptureRole)) {
    return fromEnv as CaptureRole;
  }
  return "admin";
}
