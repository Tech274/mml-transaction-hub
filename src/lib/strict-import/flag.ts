// SCRUM-103: feature flag for the strict importer. OFF unless the server
// environment variable STRICT_IMPORT_ENABLED is exactly "true".
// Turning it on is a deliberate deploy-time decision (Atlas go-ahead + Vivek
// approval, after the SCRUM-103 migration is applied and the rules confirmed).
export const STRICT_IMPORT_FLAG = "strict_import_enabled" as const;
export const STRICT_IMPORT_ENV_VAR = "STRICT_IMPORT_ENABLED" as const;

export function isStrictImportEnabled(env: Record<string, string | undefined>): boolean {
  return env[STRICT_IMPORT_ENV_VAR] === "true";
}
