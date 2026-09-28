// Pure pricing helpers for the MML Lab cost catalog and the private-cloud 20% rule.
// Nothing here is saved. Rates come from cost_rates; the percent is admin-editable.

export const COST_RATE_KEYS = [
  "vcpu_per_day",
  "ram_gb_per_day",
  "storage_gb_per_day",
  "private_input_cost_pct",
] as const;
export type CostRateKey = (typeof COST_RATE_KEYS)[number];

export type CustomVmInput = {
  vcpu: number;
  ramGb: number;
  storageGb: number;
  days: number;
  vms: number;
};

export type RateMap = {
  vcpu_per_day: number | null;
  ram_gb_per_day: number | null;
  storage_gb_per_day: number | null;
};

export type TierMatch = {
  code: string;
  vcpu: number;
  ramGb: number;
  storageGb: number | null;
  pricePerDay: number | null;
};

export type CustomVmResult =
  | {
      ok: true;
      perVmPerDay: number;
      perVmPeriod: number;
      total: number;
      matchedTier: string | null;
      tierTotal: number | null;
    }
  | { ok: false; error: string };

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function customVmQuote(
  input: CustomVmInput,
  rates: RateMap,
  tiers: TierMatch[] = [],
): CustomVmResult {
  if (!Number.isInteger(input.vcpu) || input.vcpu < 1 || input.vcpu > 64)
    return { ok: false, error: "vCPU must be a whole number from 1 to 64" };
  if (!Number.isInteger(input.ramGb) || input.ramGb < 1 || input.ramGb > 512)
    return { ok: false, error: "RAM must be a whole number from 1 to 512 GB" };
  if (!Number.isInteger(input.storageGb) || input.storageGb < 0 || input.storageGb > 10_000)
    return { ok: false, error: "Storage must be a whole number from 0 to 10,000 GB" };
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 365)
    return { ok: false, error: "Days must be a whole number from 1 to 365" };
  if (!Number.isInteger(input.vms) || input.vms < 1 || input.vms > 100_000)
    return { ok: false, error: "Number of VMs must be a whole number from 1 to 100,000" };
  if (
    rates.vcpu_per_day == null ||
    rates.ram_gb_per_day == null ||
    rates.storage_gb_per_day == null
  ) {
    return { ok: false, error: "Rate not set by admin" };
  }
  const perDay =
    input.vcpu * rates.vcpu_per_day +
    input.ramGb * rates.ram_gb_per_day +
    input.storageGb * rates.storage_gb_per_day;
  const matched = tiers.find(
    (t) =>
      t.vcpu === input.vcpu &&
      t.ramGb === input.ramGb &&
      (t.storageGb == null || t.storageGb === input.storageGb),
  );
  const tierTotal =
    matched?.pricePerDay != null ? round2(matched.pricePerDay * input.days * input.vms) : null;
  return {
    ok: true,
    perVmPerDay: round2(perDay),
    perVmPeriod: round2(perDay * input.days),
    total: round2(perDay * input.days * input.vms),
    matchedTier: matched ? matched.code : null,
    tierTotal,
  };
}

/** Input cost is X% of the entered per-user selling price. Margin is the rest. Batch totals multiply by users. */
export function privateCloudSplit(sellingPerUser: number, users: number, pct: number) {
  const share = pct / 100;
  const inputPerUser = round2(sellingPerUser * share);
  const marginPerUser = round2(sellingPerUser * (1 - share));
  return {
    pct,
    sellingPerUser,
    users,
    inputPerUser,
    marginPerUser,
    revenue: round2(sellingPerUser * users),
    inputTotal: round2(inputPerUser * users),
    marginTotal: round2(marginPerUser * users),
  };
}

export function componentTotal(
  pricePerUser: number | null | undefined,
  users: number | null | undefined,
): number | null {
  if (pricePerUser == null || users == null) return null;
  return round2(pricePerUser * users);
}

/** Plain mean. Empty input means there is nothing to fill. */
export function gapFillMean(known: number[]): number | null {
  if (known.length === 0) return null;
  return round2(known.reduce((s, n) => s + n, 0) / known.length);
}

export type GapFillMethod = "mean" | "mean_90d" | "none";

/** Batch mean first. If the batch has no known costs, use the 90-day fallback sample. Otherwise leave blank. */
export function gapFillWithFallback(
  batchKnown: number[],
  fallbackKnown: number[],
): { value: number | null; method: GapFillMethod } {
  if (batchKnown.length > 0) return { value: gapFillMean(batchKnown), method: "mean" };
  if (fallbackKnown.length > 0) return { value: gapFillMean(fallbackKnown), method: "mean_90d" };
  return { value: null, method: "none" };
}

export function invoiceAmountInr(
  currency: "INR" | "USD",
  amount: number,
  fxRateToInr: number | null,
): number | { error: string } {
  if (currency === "INR") return round2(amount);
  if (fxRateToInr == null || !(fxRateToInr > 0))
    return { error: "A USD invoice needs an FX rate to INR" };
  return round2(amount * fxRateToInr);
}

export type CostBasis = "actual" | "entered" | "auto_avg" | "none";

export function effectiveCost(row: {
  input_cost_actual_alloc?: number | null;
  input_cost?: number | null;
  input_cost_auto?: number | null;
}): { amount: number | null; basis: CostBasis } {
  if (row.input_cost_actual_alloc != null)
    return { amount: Number(row.input_cost_actual_alloc), basis: "actual" };
  if (row.input_cost != null) return { amount: Number(row.input_cost), basis: "entered" };
  if (row.input_cost_auto != null)
    return { amount: Number(row.input_cost_auto), basis: "auto_avg" };
  return { amount: null, basis: "none" };
}

export const COST_BASIS_LABEL: Record<CostBasis, string> = {
  actual: "Actual (invoice)",
  entered: "Entered estimate",
  auto_avg: "Auto-filled average",
  none: "Cost unknown",
};

/** Largest weight takes the rounding remainder so the parts sum to the invoice. */
export function allocateProRata(total: number, weights: number[]): number[] {
  const useEqual = weights.every((w) => !w) || weights.reduce((s, w) => s + w, 0) === 0;
  const w = useEqual ? weights.map(() => 1) : weights;
  const sum = w.reduce((s, n) => s + n, 0);
  const raw = w.map((n) => round2((total * n) / sum));
  let rem = round2(total - raw.reduce((s, n) => s + n, 0));
  let largest = 0;
  for (let i = 1; i < w.length; i++) {
    if (w[i] > w[largest]) largest = i;
  }
  if (raw.length) raw[largest] = round2(raw[largest] + rem);
  rem = 0;
  return raw;
}

export function looksLikeSecret(value: string): boolean {
  const s = value.trim();
  if (
    /^sk-[A-Za-z0-9]/.test(s) ||
    /^sk_live_|^sk_test_|^AKIA[0-9A-Z]{16}|^ghp_|^github_pat_|^xox[baprs]-/.test(s) ||
    /^eyJ[A-Za-z0-9_-]{10,}\./.test(s)
  )
    return true;
  if (/^[A-Za-z0-9_+/=-]{32,}$/.test(s)) return true;
  return false;
}
