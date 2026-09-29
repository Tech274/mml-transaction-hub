export const SUPERADMIN_CAPTURE_MODE_ENV_VAR = "VITE_SUPERADMIN_CAPTURE_MODE" as const;

/**
 * Screenshot/example-data capture gate for Super Admin review runs.
 * This mode is development-only and is ignored by production builds.
 */
export function isSuperadminCaptureModeEnabled(
  env: Record<string, string | undefined>,
  isDev = import.meta.env.DEV,
): boolean {
  if (!isDev) return false;
  return env[SUPERADMIN_CAPTURE_MODE_ENV_VAR] === "true";
}

export function getSuperadminCaptureModeEnvForClient(): Record<string, string | undefined> {
  return {
    [SUPERADMIN_CAPTURE_MODE_ENV_VAR]:
      import.meta.env.VITE_SUPERADMIN_CAPTURE_MODE ??
      (typeof process !== "undefined" ? process.env?.VITE_SUPERADMIN_CAPTURE_MODE : undefined),
  };
}
