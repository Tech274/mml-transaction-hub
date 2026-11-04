// SCRUM-129: the ONE provider -> cloud type rule (Chief's standing cloud rule, 6 Oct 2026).
//
//   Private cloud: MakeMyLabs (stored "MakeMyLabs Private Cloud"), Oracle, SAP.
//   Public cloud:  AWS, Azure, GCP.
//   Nothing else is private. A blank or unknown provider is a blocking error (D1, D2);
//   it is never defaulted, blanked or stamped public.
//
// Pure, dependency-free and isomorphic: used by the browser (Bulk Upload preview,
// dropdowns, badges) and by the server (strict-import validate/service, ADR entry).
// Keep it free of imports so the server can use it as is.

export type CloudType = "private_cloud" | "public_cloud";

export const CLOUD_TYPES: readonly CloudType[] = ["private_cloud", "public_cloud"] as const;

/**
 * Stored canonical name for MakeMyLabs' own cloud (decision b, 6 Oct 2026).
 * If John decides on plain "MakeMyLabs", change this one line.
 */
export const MAKEMYLABS_PROVIDER = "MakeMyLabs Private Cloud" as const;

export const PRIVATE_CLOUD_PROVIDERS = [MAKEMYLABS_PROVIDER, "Oracle", "SAP"] as const;
export const PUBLIC_CLOUD_PROVIDERS = ["AWS", "Azure", "GCP"] as const;

export type PrivateCloudProvider = (typeof PRIVATE_CLOUD_PROVIDERS)[number];
export type PublicCloudProvider = (typeof PUBLIC_CLOUD_PROVIDERS)[number];
export type CanonicalProvider = PrivateCloudProvider | PublicCloudProvider;

/** All six canonical providers, Private first then Public. */
export const CANONICAL_PROVIDERS: readonly CanonicalProvider[] = [
  ...PRIVATE_CLOUD_PROVIDERS,
  ...PUBLIC_CLOUD_PROVIDERS,
];

/** Provider -> cloud type. The rule itself. */
export const PROVIDER_CLOUD_TYPE: Readonly<Record<CanonicalProvider, CloudType>> = {
  [MAKEMYLABS_PROVIDER]: "private_cloud",
  Oracle: "private_cloud",
  SAP: "private_cloud",
  AWS: "public_cloud",
  Azure: "public_cloud",
  GCP: "public_cloud",
} as Record<CanonicalProvider, CloudType>;

/** Sentence-case labels used on every surface (SCRUM-129 §129.4). */
export const CLOUD_TYPE_LABEL: Readonly<Record<CloudType, string>> = {
  private_cloud: "Private cloud",
  public_cloud: "Public cloud",
};

/** Label for a stored cloud type. Unknown / NULL returns "Not set"; never public. */
export function cloudTypeLabel(value: string | null | undefined): string {
  return isCloudType(value) ? CLOUD_TYPE_LABEL[value] : "Not set";
}

export function isCloudType(value: unknown): value is CloudType {
  return value === "private_cloud" || value === "public_cloud";
}

/** Provider options for selects, grouped Private / Public. */
export const PROVIDER_GROUPS: ReadonlyArray<{
  cloudType: CloudType;
  label: string;
  providers: readonly CanonicalProvider[];
}> = [
  { cloudType: "private_cloud", label: "Private cloud", providers: PRIVATE_CLOUD_PROVIDERS },
  { cloudType: "public_cloud", label: "Public cloud", providers: PUBLIC_CLOUD_PROVIDERS },
];

/** Providers allowed for one cloud type (ADR form: options follow the chosen type). */
export function providersForCloudType(cloudType: CloudType): readonly CanonicalProvider[] {
  return cloudType === "private_cloud" ? PRIVATE_CLOUD_PROVIDERS : PUBLIC_CLOUD_PROVIDERS;
}

/** The one-line rule, for help text on Bulk Upload and forms. */
export const CLOUD_RULE_HELP_TEXT =
  "Private cloud is MakeMyLabs, Oracle or SAP. Public cloud is AWS, Azure or GCP. Any other or blank provider stops the import with a row error.";

function key(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Alias status, as in spec §129.3a (D2). */
export type AliasStatus =
  | "rule" // Chief's standing rule (05:51 IST, confirmed 06:01)
  | "approved_0602" // approved by name, comment 11505
  | "approved_0611" // John, 06:11 IST: every remaining row of the §129.3a table
  | "obvious_variant_john_to_confirm" // treated as approved under D2 once John confirms
  | "proposed_pending_chief"; // blocking error until Chief approves

export type AliasEntry = readonly [
  alias: string,
  canonical: CanonicalProvider,
  status: AliasStatus,
];

/**
 * ACTIVE aliases: the whole spec §129.3a table. Rule + Approved 06:02 rows, plus every
 * "Obvious variant" and "Proposed" row, all approved by John at 06:11 IST.
 * To retire one, move its line to PENDING_ALIAS_ENTRIES.
 */
export const ACTIVE_ALIAS_ENTRIES: readonly AliasEntry[] = [
  // Private cloud: MakeMyLabs
  [MAKEMYLABS_PROVIDER, MAKEMYLABS_PROVIDER, "rule"],
  ["MakeMyLabs Private Cloud", MAKEMYLABS_PROVIDER, "rule"],
  ["MakeMyLabs", MAKEMYLABS_PROVIDER, "rule"],
  ["Make My Labs", MAKEMYLABS_PROVIDER, "approved_0611"],
  ["Make My Labs Private Cloud", MAKEMYLABS_PROVIDER, "approved_0611"],
  ["MakeMyLabs Cloud", MAKEMYLABS_PROVIDER, "approved_0611"],
  ["MML", MAKEMYLABS_PROVIDER, "approved_0611"],
  ["MML Private Cloud", MAKEMYLABS_PROVIDER, "approved_0611"],
  // Private cloud: Oracle
  ["Oracle", "Oracle", "rule"],
  ["Oracle Cloud", "Oracle", "approved_0602"],
  ["OCI", "Oracle", "approved_0602"],
  ["Oracle Cloud Infrastructure", "Oracle", "approved_0611"],
  // Private cloud: SAP
  ["SAP", "SAP", "rule"],
  ["SAP Cloud", "SAP", "approved_0611"],
  ["SAP BTP", "SAP", "approved_0611"],
  ["SAP Business Technology Platform", "SAP", "approved_0611"],
  ["SAP HANA Enterprise Cloud", "SAP", "approved_0611"],
  ["SAP HEC", "SAP", "approved_0611"],
  ["RISE with SAP", "SAP", "approved_0611"],
  ["SAP RISE", "SAP", "approved_0611"],
  // Public cloud
  ["AWS", "AWS", "rule"],
  ["Amazon Web Services", "AWS", "approved_0611"],
  ["Amazon AWS", "AWS", "approved_0611"],
  ["Azure", "Azure", "rule"],
  ["Microsoft Azure", "Azure", "approved_0611"],
  ["Azure Cloud", "Azure", "approved_0611"],
  ["MS Azure", "Azure", "approved_0611"],
  ["GCP", "GCP", "rule"],
  ["Google Cloud", "GCP", "approved_0611"],
  ["Google Cloud Platform", "GCP", "approved_0611"],
];

/**
 * PENDING aliases: not used for matching. Empty since John's 06:11 decision; kept so a
 * future proposal is a one-line add here and a one-line move to ACTIVE_ALIAS_ENTRIES.
 */
export const PENDING_ALIAS_ENTRIES: readonly AliasEntry[] = [];

/**
 * Never aliases (spec §129.3a): always a blocking row error, even if someone later
 * adds them to the active list (normalizeProvider checks this first).
 * Cloud types belong in the Cloud Type column; company names are not clouds.
 */
export const NEVER_ALIASES: readonly string[] = [
  "Hybrid",
  "Private",
  "Public",
  "Private cloud",
  "Public cloud",
  "On-prem",
  "IBM",
  "IBM Cloud",
  "Alibaba",
  "Other",
  "N/A",
  "-",
  "0",
  "",
  "Amazon",
  "Microsoft",
  "Google",
];

function toAliasMap(entries: readonly AliasEntry[]): Readonly<Record<string, CanonicalProvider>> {
  const map: Record<string, CanonicalProvider> = {};
  for (const [alias, canonical] of entries) map[key(alias)] = canonical;
  return Object.freeze(map);
}

/** ACTIVE alias lookup. Keys are trimmed, inner spaces collapsed, lower-cased. */
export const PROVIDER_ALIASES: Readonly<Record<string, CanonicalProvider>> =
  toAliasMap(ACTIVE_ALIAS_ENTRIES);

/** PENDING alias lookup (alias key -> { canonical, status }). Never used for matching. */
export const PENDING_ALIASES: Readonly<
  Record<string, { canonical: CanonicalProvider; status: AliasStatus }>
> = Object.freeze(
  Object.fromEntries(
    PENDING_ALIAS_ENTRIES.map(([a, canonical, status]) => [key(a), { canonical, status }]),
  ),
);

const NEVER_ALIAS_KEYS: ReadonlySet<string> = new Set(NEVER_ALIASES.map(key));

/** True for a value on the spec's never-alias block list (blank included). */
export function isNeverAlias(raw: unknown): boolean {
  return NEVER_ALIAS_KEYS.has(key(raw == null ? "" : String(raw)));
}

export const PROVIDER_REQUIRED_MESSAGE = "Cloud Provider is required";

export function unknownProviderMessage(value: string): string {
  return `Cloud Provider '${value.trim()}' is not allowed. Use MakeMyLabs, Oracle or SAP (Private cloud) or AWS, Azure or GCP (Public cloud).`;
}

export type ProviderErrorCode = "blank" | "unknown";

export type NormalizedProvider =
  | {
      ok: true;
      provider: CanonicalProvider;
      /** Same as provider; the canonical stored name. */
      canonical: CanonicalProvider;
      cloudType: CloudType;
      /** The trimmed raw value differs from the canonical name (spelling or case), e.g. "OCI" -> "Oracle". Shown as a Healer fix. */
      aliasApplied: boolean;
      /** The raw value, trimmed. */
      raw: string;
    }
  | { ok: false; provider: null; cloudType: null; code: ProviderErrorCode; message: string };

/**
 * Normalise a raw provider value (trimmed, case-insensitive, active aliases only).
 * Blank or unknown (including "Hybrid") -> ok:false with cloudType null: the row is blocked.
 */
export function normalizeProvider(raw: unknown): NormalizedProvider {
  const text = raw == null ? "" : String(raw);
  if (text.trim() === "") {
    return {
      ok: false,
      provider: null,
      cloudType: null,
      code: "blank",
      message: PROVIDER_REQUIRED_MESSAGE,
    };
  }
  const provider = isNeverAlias(text) ? undefined : PROVIDER_ALIASES[key(text)];
  if (!provider) {
    return {
      ok: false,
      provider: null,
      cloudType: null,
      code: "unknown",
      message: unknownProviderMessage(text),
    };
  }
  const trimmed = text.trim();
  return {
    ok: true,
    provider,
    canonical: provider,
    cloudType: PROVIDER_CLOUD_TYPE[provider],
    aliasApplied: trimmed !== provider,
    raw: trimmed,
  };
}

/** Cloud type of a stored/canonical provider name, or null if outside the six. */
export function providerCloudType(raw: unknown): CloudType | null {
  const r = normalizeProvider(raw);
  return r.ok ? r.cloudType : null;
}

/**
 * Parse an optional "Cloud Type" cell. Accepts "Private cloud" / "Private" /
 * "private_cloud" and the public equivalents (trimmed, case-insensitive).
 * Blank -> null (no value given). Anything else -> "invalid".
 */
export function parseCloudTypeValue(raw: unknown): CloudType | null | "invalid" {
  const text = raw == null ? "" : String(raw);
  if (text.trim() === "") return null;
  const k = key(text).replace(/_/g, " ");
  if (k === "private cloud" || k === "private") return "private_cloud";
  if (k === "public cloud" || k === "public") return "public_cloud";
  return "invalid";
}

export type ProviderRowCheck =
  | {
      ok: true;
      provider: CanonicalProvider;
      cloudType: CloudType;
      aliasApplied: boolean;
      raw: string;
    }
  | { ok: false; provider: CanonicalProvider | null; cloudType: null; errors: string[] };

/**
 * Full row check: provider must normalise, and an optional Cloud Type value must
 * agree with the provider's type. Any failure blocks the row (cloudType null).
 */
export function checkProviderRow(rawProvider: unknown, rawCloudType?: unknown): ProviderRowCheck {
  const norm = normalizeProvider(rawProvider);
  const errors: string[] = [];
  if (!norm.ok) errors.push(norm.message);

  const declared = parseCloudTypeValue(rawCloudType);
  if (declared === "invalid") {
    errors.push(
      `Cloud Type '${String(rawCloudType).trim()}' is not allowed. Use Private cloud or Public cloud.`,
    );
  } else if (declared && norm.ok && declared !== norm.cloudType) {
    errors.push(cloudTypeConflictMessage(norm.provider, declared));
  }

  if (errors.length > 0 || !norm.ok) {
    return { ok: false, provider: norm.ok ? norm.provider : null, cloudType: null, errors };
  }
  return {
    ok: true,
    provider: norm.provider,
    cloudType: norm.cloudType,
    aliasApplied: norm.aliasApplied,
    raw: norm.raw,
  };
}

/** "OCI → Oracle": the Healer fix line for an alias mapping, or null when none applied. */
export function healerFixLabel(raw: unknown): string | null {
  const r = normalizeProvider(raw);
  return r.ok && r.aliasApplied ? `${r.raw} → ${r.canonical}` : null;
}

export function cloudTypeConflictMessage(provider: CanonicalProvider, declared: CloudType): string {
  return `Cloud Type '${CLOUD_TYPE_LABEL[declared]}' conflicts with provider ${provider}, which is ${CLOUD_TYPE_LABEL[PROVIDER_CLOUD_TYPE[provider]]}.`;
}

/**
 * Conflict check against an optional Cloud Type value. Returns an error message, or
 * null when there is no conflict (including when no Cloud Type value was given).
 * Does not report blank/unknown providers; use normalizeProvider for that.
 */
export function cloudTypeConflict(rawProvider: unknown, rawCloudType: unknown): string | null {
  const norm = normalizeProvider(rawProvider);
  const declared = parseCloudTypeValue(rawCloudType);
  if (declared === "invalid")
    return `Cloud Type '${String(rawCloudType).trim()}' is not allowed. Use Private cloud or Public cloud.`;
  if (!norm.ok || declared == null) return null;
  return declared === norm.cloudType ? null : cloudTypeConflictMessage(norm.provider, declared);
}

/** True when the provider (any active alias) belongs to the given cloud type. */
export function isProviderAllowedForCloudType(rawProvider: unknown, cloudType: CloudType): boolean {
  return providerCloudType(rawProvider) === cloudType;
}
