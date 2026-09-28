import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/lib/auth-context";

export type PermKind = "kpi" | "feature";

export interface PermDef {
  key: string;
  kind: PermKind;
  label: string;
  group: string;
}

export const PERMISSIONS: PermDef[] = [
  // KPI cards
  { key: "kpi_total_transactions", kind: "kpi", label: "Total Transactions", group: "KPI Cards" },
  { key: "kpi_public_cloud", kind: "kpi", label: "Public Cloud count", group: "KPI Cards" },
  { key: "kpi_private_cloud", kind: "kpi", label: "Private Cloud count", group: "KPI Cards" },
  { key: "kpi_total_users", kind: "kpi", label: "Total Users", group: "KPI Cards" },
  { key: "kpi_total_revenue", kind: "kpi", label: "Total Revenue", group: "KPI Cards" },
  { key: "kpi_total_input_cost", kind: "kpi", label: "Total Input Cost", group: "KPI Cards" },
  { key: "kpi_total_profit", kind: "kpi", label: "Total Profit", group: "KPI Cards" },
  { key: "kpi_margin", kind: "kpi", label: "Margin %", group: "KPI Cards" },
  { key: "kpi_avg_cost", kind: "kpi", label: "Avg Selling Cost", group: "KPI Cards" },
  {
    key: "kpi_current_month_revenue",
    kind: "kpi",
    label: "Current Month Revenue",
    group: "KPI Cards",
  },
  {
    key: "kpi_current_month_profit",
    kind: "kpi",
    label: "Current Month Profit",
    group: "KPI Cards",
  },
  { key: "kpi_current_month_users", kind: "kpi", label: "Current Month Users", group: "KPI Cards" },
  // Charts
  { key: "chart_tx_by_month", kind: "kpi", label: "Transactions by Month", group: "Charts" },
  {
    key: "chart_revenue_by_month",
    kind: "kpi",
    label: "Revenue / Cost / Profit by Month",
    group: "Charts",
  },
  { key: "chart_pub_priv", kind: "kpi", label: "Public vs Private Cloud", group: "Charts" },
  { key: "chart_provider", kind: "kpi", label: "Public Cloud Provider Split", group: "Charts" },
  { key: "chart_top_revenue", kind: "kpi", label: "Top Customers by Revenue", group: "Charts" },
  { key: "chart_top_users", kind: "kpi", label: "Top Customers by Users", group: "Charts" },
  { key: "chart_top_profit", kind: "kpi", label: "Top Customers by Profit", group: "Charts" },
  { key: "chart_lob", kind: "kpi", label: "Line of Business Split", group: "Charts" },
  {
    key: "widget_customers_by_am",
    kind: "kpi",
    label: "Customers by Account Manager",
    group: "Charts",
  },
  // Features
  { key: "feature_excel_export", kind: "feature", label: "Excel export", group: "Features" },
  {
    key: "feature_customer_edit",
    kind: "feature",
    label: "Edit customer details",
    group: "Features",
  },
  {
    key: "feature_master_adr_entry",
    kind: "feature",
    label: "Master ADR entry",
    group: "Features",
  },
  {
    key: "feature_reports_access",
    kind: "feature",
    label: "Reports page access",
    group: "Features",
  },
  {
    key: "feature_export_jobs_view",
    kind: "feature",
    label: "View async export jobs",
    group: "Features",
  },
  {
    key: "feature_export_jobs_trigger",
    kind: "feature",
    label: "Trigger async export jobs (large exports)",
    group: "Features",
  },
  // Admin capabilities — Super Admin only; not delegated to other roles yet.
  {
    key: "feature_user_manage",
    kind: "feature",
    label: "Create and edit users (email, name, roles, status)",
    group: "Admin",
  },
  { key: "feature_user_delete", kind: "feature", label: "Delete users", group: "Admin" },
  {
    key: "feature_user_reset_password",
    kind: "feature",
    label: "Reset / set temporary password",
    group: "Admin",
  },
  { key: "feature_roles_manage", kind: "feature", label: "Assign roles", group: "Admin" },
  {
    key: "feature_permissions_manage",
    kind: "feature",
    label: "Edit the permission matrix",
    group: "Admin",
  },
  {
    key: "feature_rates_manage",
    kind: "feature",
    label: "Edit VM tier prices and cost rates",
    group: "Admin",
  },
  { key: "feature_hybrid_tag", kind: "feature", label: "Tag hybrid programs", group: "Admin" },
  {
    key: "feature_lab_catalog_view",
    kind: "feature",
    label: "View the lab catalog",
    group: "MML Lab",
  },
  {
    key: "feature_cost_catalog_view",
    kind: "feature",
    label: "View the cost catalog",
    group: "MML Lab",
  },
  {
    key: "feature_lab_batches_manage",
    kind: "feature",
    label: "View lab batches",
    group: "MML Lab",
  },
];

// Keys reserved for Super Admin. Rendered as an always-on, read-only column.
export const ADMIN_ONLY_PERM_KEYS = [
  "feature_user_manage",
  "feature_user_delete",
  "feature_user_reset_password",
  "feature_roles_manage",
  "feature_permissions_manage",
  "feature_rates_manage",
  "feature_hybrid_tag",
] as const;

export const PERM_KEYS = PERMISSIONS.map((p) => p.key);

export type RolePermissionsMap = Record<string, Set<string>>;

// ---------- Preview-as-role store ----------
const PREVIEW_KEY = "lovable:previewRole";
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
function readPreview(): AppRole | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(PREVIEW_KEY);
  return (v as AppRole | null) ?? null;
}
export function setPreviewRole(role: AppRole | null) {
  if (typeof window === "undefined") return;
  if (role) window.localStorage.setItem(PREVIEW_KEY, role);
  else window.localStorage.removeItem(PREVIEW_KEY);
  emit();
}
export function usePreviewRole(): AppRole | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    readPreview,
    () => null,
  );
}

export function usePermissions() {
  const { roles, isAdmin, loading: authLoading } = useAuth();
  const preview = usePreviewRole();
  const { data, isLoading } = useQuery({
    queryKey: ["role-permissions-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_permissions")
        .select("role,key,enabled,sort_order");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });

  // Effective roles: when admin is previewing, ignore their own admin override.
  const effectiveRoles: AppRole[] = isAdmin && preview ? [preview] : roles;
  const treatAsAdmin = isAdmin && !preview;

  const enabled = new Set<string>();
  const order = new Map<string, number>();
  if (treatAsAdmin) {
    for (const p of PERMISSIONS) enabled.add(p.key);
    if (data)
      for (const row of data) if (row.role === "admin") order.set(row.key, row.sort_order ?? 0);
  } else if (data) {
    for (const row of data) {
      if (effectiveRoles.includes(row.role as AppRole)) {
        if (row.enabled) enabled.add(row.key);
        // Lower sort_order wins when multiple roles overlap
        const cur = order.get(row.key);
        if (cur === undefined || (row.sort_order ?? 0) < cur)
          order.set(row.key, row.sort_order ?? 0);
      }
    }
  }

  const orderedKpis = PERMISSIONS.filter((p) => p.kind === "kpi")
    .map((p, idx) => ({ key: p.key, sort: order.get(p.key) ?? 0, idx }))
    .sort((a, b) => a.sort - b.sort || a.idx - b.idx)
    .map((x) => x.key);

  return {
    loading: authLoading || isLoading,
    can: (key: string) => enabled.has(key),
    enabledKeys: enabled,
    orderedKpis,
    previewRole: preview,
    isPreviewing: Boolean(isAdmin && preview),
  };
}
