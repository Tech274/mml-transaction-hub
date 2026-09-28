export const SCRUM44_UI_REVIEW_ENABLED_ENV_VAR = "VITE_SCRUM44_UI_REVIEW_ENABLED" as const;

/**
 * SCRUM-44 UI review gate.
 * Anything other than the exact string "true" keeps the UI changes off.
 */
export function isScrum44UiReviewEnabled(env: Record<string, string | undefined>): boolean {
  return env[SCRUM44_UI_REVIEW_ENABLED_ENV_VAR] === "true";
}

export function getScrum44UiReviewEnvForClient(): Record<string, string | undefined> {
  return {
    [SCRUM44_UI_REVIEW_ENABLED_ENV_VAR]:
      import.meta.env.VITE_SCRUM44_UI_REVIEW_ENABLED ??
      (typeof process !== "undefined" ? process.env?.VITE_SCRUM44_UI_REVIEW_ENABLED : undefined),
  };
}
