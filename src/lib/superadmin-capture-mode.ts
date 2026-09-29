export const SUPERADMIN_CAPTURE_MODE_ENV_VAR = "VITE_SUPERADMIN_CAPTURE_MODE" as const;

/**
 * Screenshot capture gate for Super Admin review runs.
 * Only the exact string "true" enables capture mode.
 */
export function isSuperadminCaptureModeEnabled(env: Record<string, string | undefined>): boolean {
  return env[SUPERADMIN_CAPTURE_MODE_ENV_VAR] === "true";
}

export function getSuperadminCaptureModeEnvForClient(): Record<string, string | undefined> {
  return {
    [SUPERADMIN_CAPTURE_MODE_ENV_VAR]:
      import.meta.env.VITE_SUPERADMIN_CAPTURE_MODE ??
      (typeof process !== "undefined" ? process.env?.VITE_SUPERADMIN_CAPTURE_MODE : undefined),
  };
}
