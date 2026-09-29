export const SIDEBAR_COLLAPSED_STORAGE_KEY = "mml.sidebar.collapsed" as const;

type StorageReader = Pick<Storage, "getItem"> | null;
type StorageWriter = Pick<Storage, "setItem"> | null;

export function readSidebarCollapsedFromStorage(storage: StorageReader): boolean {
  if (!storage) return false;
  return storage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
}

export function getSidebarOpenFromStorage(storage: StorageReader): boolean {
  return !readSidebarCollapsedFromStorage(storage);
}

export function persistSidebarCollapsed(storage: StorageWriter, collapsed: boolean): void {
  if (!storage) return;
  storage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
}
