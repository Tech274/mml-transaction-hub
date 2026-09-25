import { describe, it, expect } from "vitest";
import {
  computeTotals, groupByKey, computeForecast, forecastByDimension, type ReportRow,
} from "@/lib/reports-metrics";

const rows: ReportRow[] = [
  { month: 1, year: 2026, repository_type: "public_cloud", cloud_provider: "AWS",
    line_of_business: "VILT", customer_name: "Acme", lab_name: "Lab-1",
    total_users: 10, input_cost: 100, selling_cost: 250,
    start_date: "2026-01-01", end_date: "2026-06-30" },
  { month: 1, year: 2026, repository_type: "public_cloud", cloud_provider: "AWS",
    line_of_business: "Integrated", customer_name: "Acme", lab_name: "Lab-2",
    total_users: 5, input_cost: 50, selling_cost: 200,
    start_date: "2026-01-01", end_date: "2026-03-31" },
  { month: 2, year: 2026, repository_type: "public_cloud", cloud_provider: "Azure",
    line_of_business: "Standalone", customer_name: "Beta", lab_name: "Lab-3",
    total_users: 20, input_cost: 400, selling_cost: 500,
    start_date: "2026-02-01", end_date: "2026-05-31" },
];

describe("computeTotals", () => {
  it("aggregates revenue, cost, profit, margin", () => {
    const t = computeTotals(rows);
    expect(t.revenue).toBe(950);       // 250+200+500
    expect(t.cost).toBe(550);          // 100+50+400
    expect(t.profit).toBe(400);
    expect(t.margin).toBeCloseTo((400 / 950) * 100, 5);
    expect(t.count).toBe(3);
  });
  it("handles zero revenue safely", () => {
    expect(computeTotals([]).margin).toBe(0);
  });
});

describe("groupByKey", () => {
  it("groups by cloud_provider with correct margin per group", () => {
    const groups = groupByKey(rows, (r) => r.cloud_provider);
    const aws = groups.find((g) => g.key === "AWS")!;
    expect(aws.revenue).toBe(450);
    expect(aws.cost).toBe(150);
    expect(aws.profit).toBe(300);
    expect(aws.margin).toBeCloseTo((300 / 450) * 100, 5);
    const az = groups.find((g) => g.key === "Azure")!;
    expect(az.margin).toBeCloseTo((100 / 500) * 100, 5);
  });
  it("groups by customer_name matching expected profitability fixture", () => {
    const groups = groupByKey(rows, (r) => r.customer_name);
    const acme = groups.find((g) => g.key === "Acme")!;
    expect(acme.revenue).toBe(450);
    expect(acme.profit).toBe(300);
    expect(acme.rows.length).toBe(2);
  });
});

describe("computeForecast", () => {
  it("projects monthly revenue only while contracts are active", () => {
    // From Feb 2026, horizon 6 months → Feb..Jul 2026.
    const f = computeForecast(rows, new Date(2026, 1, 1), 6);
    // Feb: all three active (250+200+500 = 950)
    expect(f[0].revenue).toBe(950);
    // Mar: Lab-2 ends Mar 31 (still active), so still 950
    expect(f[1].revenue).toBe(950);
    // Apr: Lab-2 ended → 250+500 = 750
    expect(f[2].revenue).toBe(750);
    // Jun: Lab-1 still active last month, Azure ended May → 250
    expect(f[4].revenue).toBe(250);
    // Jul: nothing
    expect(f[5].revenue).toBe(0);
  });
  it("computes margin per bucket", () => {
    const f = computeForecast(rows, new Date(2026, 3, 1), 1); // Apr only
    expect(f[0].revenue).toBe(750);
    expect(f[0].cost).toBe(500);
    expect(f[0].profit).toBe(250);
    expect(f[0].margin).toBeCloseTo((250 / 750) * 100, 5);
  });
});

describe("forecastByDimension", () => {
  it("splits totals by customer over the horizon", () => {
    const byCustomer = forecastByDimension(rows, "customer_name", new Date(2026, 1, 1), 6);
    const acme = byCustomer.find((g) => g.key === "Acme")!;
    // Feb+Mar: 450, Apr..Jun: 250 → 450*2 + 250*3 = 1650
    expect(acme.revenue).toBe(1650);
    const beta = byCustomer.find((g) => g.key === "Beta")!;
    // Feb..May: 500 * 4 = 2000
    expect(beta.revenue).toBe(2000);
  });
});
