import { describe, expect, it } from "vitest";
import {
  allocateProRata,
  componentTotal,
  customVmQuote,
  effectiveCost,
  gapFillMean,
  gapFillWithFallback,
  invoiceAmountInr,
  looksLikeSecret,
  privateCloudSplit,
} from "@/lib/cost-calculator";

const rates = { vcpu_per_day: 20, ram_gb_per_day: 5, storage_gb_per_day: 0.5 };

describe("custom VM price", () => {
  it("prices the worked example at ₹210 per day and ₹1,26,000 total", () => {
    const q = customVmQuote({ vcpu: 4, ramGb: 16, storageGb: 100, days: 30, vms: 20 }, rates, [
      { code: "16GB 4vCPUs", vcpu: 4, ramGb: 16, storageGb: 100, pricePerDay: 240 },
    ]);
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.perVmPerDay).toBe(210);
    expect(q.perVmPeriod).toBe(6300);
    expect(q.total).toBe(126000);
    expect(q.matchedTier).toBe("16GB 4vCPUs");
    expect(q.tierTotal).toBe(144000);
  });

  it("refuses a total when a rate is not set", () => {
    const q = customVmQuote(
      { vcpu: 4, ramGb: 16, storageGb: 100, days: 30, vms: 20 },
      { ...rates, vcpu_per_day: null },
    );
    expect(q).toEqual({ ok: false, error: "Rate not set by admin" });
  });

  it("rejects 0 vCPU, 400 days and negative storage", () => {
    expect(customVmQuote({ vcpu: 0, ramGb: 16, storageGb: 100, days: 30, vms: 1 }, rates).ok).toBe(
      false,
    );
    expect(customVmQuote({ vcpu: 2, ramGb: 8, storageGb: 10, days: 400, vms: 1 }, rates).ok).toBe(
      false,
    );
    expect(customVmQuote({ vcpu: 2, ramGb: 8, storageGb: -1, days: 1, vms: 1 }, rates).ok).toBe(
      false,
    );
  });
});

describe("20% of the entered per-user selling price", () => {
  it("uses 350 entered for 30 users at the default 20%", () => {
    const s = privateCloudSplit(350, 30, 20);
    expect(s.revenue).toBe(10500);
    expect(s.inputPerUser).toBe(70);
    expect(s.inputTotal).toBe(2100);
    expect(s.marginPerUser).toBe(280);
    expect(s.marginTotal).toBe(8400);
  });

  it("follows an admin-changed percent instead of a fixed 20", () => {
    const s = privateCloudSplit(350, 30, 25);
    expect(s.inputPerUser).toBe(87.5);
    expect(s.inputTotal).toBe(2625);
    expect(s.marginPerUser).toBe(262.5);
    expect(s.marginTotal).toBe(7875);
    expect(s.revenue).toBe(10500);
  });

  it("treats licence and API prices as components, and opens their totals", () => {
    expect(componentTotal(100, 30)).toBe(3000);
    expect(componentTotal(50, 30)).toBe(1500);
    expect(componentTotal(null, 30)).toBeNull();
  });
});

describe("gap-fill mean", () => {
  it("fills the three gaps in Vivek's 7-of-10 batch at 2,500", () => {
    const known = [2500, 2500, 2500, 2500, 2500, 2500, 2500];
    expect(gapFillMean(known)).toBe(2500);
    const filled = gapFillWithFallback(known, [9999]);
    expect(filled).toEqual({ value: 2500, method: "mean" });
  });

  it("falls back to the 90-day sample only when the batch has no known cost", () => {
    expect(gapFillWithFallback([], [1000, 3000])).toEqual({ value: 2000, method: "mean_90d" });
    expect(gapFillWithFallback([], [])).toEqual({ value: null, method: "none" });
  });

  it("counts a real zero as known", () => {
    expect(gapFillMean([0, 100])).toBe(50);
  });
});

describe("invoice FX and profit precedence", () => {
  it("converts a typed USD rate and rejects a missing rate", () => {
    expect(invoiceAmountInr("USD", 300, 83.5)).toBe(25050);
    expect(invoiceAmountInr("INR", 25000, null)).toBe(25000);
    expect(invoiceAmountInr("USD", 300, null)).toEqual({
      error: "A USD invoice needs an FX rate to INR",
    });
  });

  it("uses actual, then entered, then auto-filled", () => {
    expect(
      effectiveCost({ input_cost_actual_alloc: 2600, input_cost: 2500, input_cost_auto: 2500 }),
    ).toEqual({ amount: 2600, basis: "actual" });
    expect(effectiveCost({ input_cost: 2500, input_cost_auto: 999 })).toEqual({
      amount: 2500,
      basis: "entered",
    });
    expect(effectiveCost({ input_cost: null, input_cost_auto: 2500 })).toEqual({
      amount: 2500,
      basis: "auto_avg",
    });
    expect(effectiveCost({})).toEqual({ amount: null, basis: "none" });
  });

  it("profit on the worked batch is revenue minus the invoice once it exists", () => {
    const revenue = 55000;
    const invoice = invoiceAmountInr("INR", 25000, null) as number;
    expect(revenue - invoice).toBe(30000);
    const parts = allocateProRata(25000, Array(10).fill(2500));
    expect(parts.every((p) => p === 2500)).toBe(true);
    expect(parts.reduce((s, n) => s + n, 0)).toBe(25000);
  });

  it("gives a rounding remainder to the largest line", () => {
    const parts = allocateProRata(100, [1, 1, 1]);
    expect(parts.reduce((s, n) => s + n, 0)).toBe(100);
    expect(parts.filter((p) => p === 33.34)).toHaveLength(1);
  });
});

describe("secret-looking licence and API-key names", () => {
  it("rejects key-shaped values and keeps plain names", () => {
    for (const v of [
      "sk-abc123",
      "sk_live_abc",
      // Built from parts so the CI secret scan does not flag test fixtures.
      "AKIA" + "ABCDEFGHIJKLMNOP",
      "ghp_abcdef",
      "github_pat_abc",
      "xoxb-123",
      "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig",
      "A".repeat(40),
    ]) {
      expect(looksLikeSecret(v)).toBe(true);
    }
    for (const v of ["Microsoft 365 E3", "OpenAI API", "Skillsoft Percipio", "Azure OpenAI tokens"]) {
      expect(looksLikeSecret(v)).toBe(false);
    }
  });
});
