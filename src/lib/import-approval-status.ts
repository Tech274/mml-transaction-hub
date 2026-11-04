// SCRUM-131: ONE status read for the sidebar, the route guard and the Bulk Upload confirmation link:
// Chris's getImportApprovalStatus() -> { isApprover, canUpload, pendingCount, unreadNotifications }.
// It is a single READ-ONLY RPC (import_approval_status(), STABLE; never expire_import_stages: QC S8),
// so the badge may poll it. Everything shares one react-query cache entry (same key, same options).
//   - isApprover: on the approver list (any role) -> "Import approvals" nav item and routes.
//   - canUpload: holds an import role -> "My uploads" (via uploaderFlagFrom in lib/my-uploads.ts).
//   - pendingCount: the nav badge, hidden at 0 (0 for non-approvers).
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getImportApprovalStatus } from "@/lib/import-approvals.functions";

export const IMPORT_APPROVAL_STATUS_QUERY_KEY = ["import-approval-status"] as const;

/** Badge poll: once a minute while the tab is visible. Safe because the status read never writes. */
export const IMPORT_APPROVAL_STATUS_POLL_MS = 60_000;

export interface ImportApprovalStatusView {
  isApprover: boolean;
  canUpload: boolean;
  pendingCount: number;
  unreadNotifications: number;
}

export const NO_IMPORT_APPROVAL_STATUS: ImportApprovalStatusView = {
  isApprover: false,
  canUpload: false,
  pendingCount: 0,
  unreadNotifications: 0,
};

type RawStatus = Partial<ImportApprovalStatusView> | null | undefined;

/** Normalise the server answer; unknown or failed reads count as "no" and 0. */
export function importApprovalStatusFrom(raw: RawStatus): ImportApprovalStatusView {
  const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  return {
    isApprover: raw?.isApprover === true,
    canUpload: raw?.canUpload === true,
    pendingCount: count(raw?.pendingCount),
    unreadNotifications: count(raw?.unreadNotifications),
  };
}

/** Shared query options (sidebar hook and route guard), so both read the same cache entry. */
export function importApprovalStatusQueryOptions(fetchStatus: () => Promise<RawStatus>) {
  return {
    queryKey: IMPORT_APPROVAL_STATUS_QUERY_KEY,
    queryFn: async () => importApprovalStatusFrom(await fetchStatus()),
    staleTime: 30_000,
    refetchInterval: IMPORT_APPROVAL_STATUS_POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  } as const;
}

/** For loaders and guards outside React (routes/_authenticated/route.tsx). */
export const fetchImportApprovalStatus = () => getImportApprovalStatus();

export function useImportApprovalStatus(enabled: boolean): ImportApprovalStatusView {
  const status = useServerFn(getImportApprovalStatus);
  const q = useQuery({ ...importApprovalStatusQueryOptions(() => status()), enabled });
  return enabled ? importApprovalStatusFrom(q.data) : NO_IMPORT_APPROVAL_STATUS;
}
