export const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function fmtCurrency(n: number | string | null | undefined) {
  if (n === null || n === undefined || n === "") return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
}

export function fmtNumber(n: number | string | null | undefined) {
  if (n === null || n === undefined || n === "") return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-IN").format(v);
}

export function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(d: string | Date | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const YEARS = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - 3 + i);

/**
 * Compact INR in Indian units, one decimal: ₹85K, ₹1.2L, ₹3.4Cr (plan §4.2).
 * Below ₹1,000 the full amount is shown. Negative values keep a proper minus sign.
 */
export function fmtCurrencyCompact(n: number | string | null | undefined) {
  if (n === null || n === undefined || n === "") return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  const sign = v < 0 ? "−" : "";
  const a = Math.abs(v);
  const one = (x: number) => {
    const r = Math.round(x * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  };
  if (a >= 1e7) return `${sign}₹${one(a / 1e7)}Cr`;
  if (a >= 1e5) return `${sign}₹${one(a / 1e5)}L`;
  if (a >= 1e3) return `${sign}₹${one(a / 1e3)}K`;
  return `${sign}₹${Math.round(a)}`;
}

/** Signed number with a proper minus sign ("−") and an explicit "+" for positives. */
export function fmtSigned(n: number, format: (abs: number) => string = (x) => fmtNumber(x)) {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return format(0);
  return `${n > 0 ? "+" : "−"}${format(Math.abs(n))}`;
}
