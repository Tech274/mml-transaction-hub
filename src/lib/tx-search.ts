export type TxSearch = {
  q?: string;
  month?: number;
  year?: number;
  provider?: string;
  lob?: string;
  systemConfig?: string;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export function validateTxSearch(s: Record<string, unknown>): TxSearch {
  return {
    q: typeof s.q === "string" && s.q ? s.q : undefined,
    month: num(s.month),
    year: num(s.year),
    provider: typeof s.provider === "string" && s.provider ? s.provider : undefined,
    lob: typeof s.lob === "string" && s.lob ? s.lob : undefined,
    systemConfig: typeof s.systemConfig === "string" && s.systemConfig ? s.systemConfig : undefined,
  };
}
