import { useQuery } from "@tanstack/react-query";
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
  { key: "kpi_current_month_revenue", kind: "kpi", label: "Current Month Revenue", group: "KPI Cards" },
  { key: "kpi_current_month_profit", kind: "kpi", label: "Current Month Profit", group: "KPI Cards" },
  { key: "kpi_current_month_users", kind: "kpi", label: "Current Month Users", group: "KPI Cards" },
  // Charts
  { key: "chart_tx_by_month", kind: "kpi", label: "Transactions by Month", group: "Charts" },
  { key: "chart_revenue_by_month", kind: "kpi", label: "Revenue / Cost / Profit by Month", group: "Charts" },
  { key: "chart_pub_priv", kind: "kpi", label: "Public vs Private Cloud", group: "Charts" },
  { key: "chart_provider", kind: "kpi", label: "Public Cloud Provider Split", group: "Charts" },
  { key: "chart_top_revenue", kind: "kpi", label: "Top Customers by Revenue", group: "Charts" },
  { key: "chart_top_users", kind: "kpi", label: "Top Customers by Users", group: "Charts" },
  { key: "chart_top_profit", kind: "kpi", label: "Top Customers by Profit", group: "Charts" },
  { key: "chart_lob", kind: "kpi", label: "Line of Business Split", group: "Charts" },
  // Features
  { key: "feature_excel_export", kind: "feature", label: "Excel export", group: "Features" },
  { key: "feature_customer_edit", kind: "feature", label: "Edit customer details", group: "Features" },
  { key: "feature_master_adr_entry", kind: "feature", label: "Master ADR entry", group: "Features" },
  { key: "feature_reports_access", kind: "feature", label: "Reports page access", group: "Features" },
];

export const PERM_KEYS = PERMISSIONS.map((p) => p.key);

export type RolePermissionsMap = Record<string, Set<string>>;

export function usePermissions() {
  const { roles, isAdmin, loading: authLoading } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["role-permissions-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_permissions")
        .select("role,key,enabled");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const enabled = new Set<string>();
  if (isAdmin) {
    // Super admin always has everything
    for (const p of PERMISSIONS) enabled.add(p.key);
  } else if (data) {
    for (const row of data) {
      if (row.enabled && roles.includes(row.role as AppRole)) {
        enabled.add(row.key);
      }
    }
  }

  return {
    loading: authLoading || isLoading,
    can: (key: string) => enabled.has(key),
    enabledKeys: enabled,
  };
}