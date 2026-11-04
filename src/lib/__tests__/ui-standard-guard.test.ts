// SCRUM-128 plan §7.2 (C13): the lasting UI-standard guard. Reads every .ts/.tsx file under src/
// (except components/ui/, integrations/, __tests__/ and the generated route tree) and fails with
// file:line for anything that breaks the standard: hex colours, palette classes, arbitrary text
// sizes, inline styles, theme switches, `lg:` in pages, oklch() outside CSS, KPI tiles without a
// period, period words in a label/subline, and unsigned deltas.
//
// Every exception lives in ALLOWLIST below with file, line, the matched text and the reason, so it
// is reviewed. An entry that no longer matches fails the test too, so the list cannot go stale.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");

type Rule = {
  id: string;
  pattern: RegExp;
  /** Limit the rule to these path prefixes (relative to src/, forward slashes). */
  only?: string[];
  /** Skip these files entirely (documented exceptions that cover a whole file). */
  skipFiles?: Record<string, string>;
};

type Allow = { rule: string; file: string; line: number; match: string; reason: string };

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black";

const RULES: Rule[] = [
  { id: "hex", pattern: /#[0-9a-fA-F]{3,8}\b/g },
  {
    id: "palette-class",
    pattern: new RegExp(`\\b(?:text|bg|border|ring|fill|stroke|from|to)-(?:${PALETTE})\\b`, "g"),
  },
  { id: "arbitrary-text-size", pattern: /text-\[\d/g },
  { id: "inline-style", pattern: /style=\{\{/g },
  { id: "theme-switch", pattern: /azure-theme|KEEP_HOME|VITE_SCRUM44/g },
  { id: "lg-breakpoint", pattern: /(?<![\w-])lg:/g, only: ["routes/", "components/"] },
  {
    id: "oklch-outside-css",
    pattern: /oklch\(/g,
    skipFiles: {
      "lib/error-page.ts":
        "Static error HTML rendered outside React; cannot read CSS tokens (plan §2.8, X3)",
    },
  },
  {
    id: "period-word-in-label",
    pattern:
      /\b(?:label|subline)=\{?\s*["'`][^"'`]*(?:\bFYTD\b|\bFY\b|\bCurrent\b|this month|last month|\(today\)|\(last 24h\))/gi,
  },
  {
    id: "unsigned-delta",
    pattern: /Math\.abs\([^)]*[Dd]elta|>= 0 \? "\+" : ""/g,
    skipFiles: { "lib/kpi-period.ts": "The one place that formats signed deltas (N15)" },
  },
];

// Reviewed exceptions. `line` is 1-based in the current file; update it with the code if it moves.
const TICKET =
  "Support ticket number in synthetic example text, not a colour (plan §7.2: all-digit ticket numbers)";
const ALLOWLIST: Allow[] = [
  {
    rule: "hex",
    file: "components/summaries/ai-command-center-data.ts",
    line: 36,
    match: "#5142",
    reason: TICKET,
  },
  {
    rule: "hex",
    file: "components/summaries/ai-command-center-data.ts",
    line: 63,
    match: "#5139",
    reason: TICKET,
  },
  {
    rule: "hex",
    file: "components/summaries/dashboard-data.ts",
    line: 370,
    match: "#5142",
    reason: TICKET,
  },
  {
    rule: "hex",
    file: "routes/_authenticated/ai-command-center.audit.tsx",
    line: 74,
    match: "#5142",
    reason: TICKET,
  },
  {
    rule: "hex",
    file: "routes/_authenticated/ai-command-center.inbox.tsx",
    line: 394,
    match: "#5142",
    reason: TICKET,
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(SRC, full).split(sep).join("/");
    if (statSync(full).isDirectory()) {
      if (rel === "components/ui" || rel === "integrations" || name === "__tests__") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && rel !== "routeTree.gen.ts") {
      out.push(rel);
    }
  }
  return out;
}

/** Blank out comments (keeping line breaks) so prose such as "issue #123" is not code. */
function stripComments(text: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += n ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && n === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

type Hit = { rule: string; file: string; line: number; match: string };

const FILES = walk(SRC).sort();
const SOURCES = new Map(FILES.map((f) => [f, readFileSync(join(SRC, f), "utf8")]));

function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const [file, raw] of SOURCES) {
    const code = stripComments(raw);
    const lines = code.split("\n");
    for (const rule of RULES) {
      if (rule.only && !rule.only.some((p) => file.startsWith(p))) continue;
      if (rule.skipFiles && file in rule.skipFiles) continue;
      lines.forEach((text, idx) => {
        for (const m of text.matchAll(rule.pattern)) {
          hits.push({ rule: rule.id, file, line: idx + 1, match: m[0] });
        }
      });
    }
    // Every <SummaryKpi …> element passes a period (N14–N18; TS requires it too).
    for (const m of code.matchAll(/<SummaryKpi\b([\s\S]*?)\/?>/g)) {
      const attrs = m[1];
      if (!/\bperiod=/.test(attrs) && !/\{\.\.\./.test(attrs)) {
        const line = code.slice(0, m.index).split("\n").length;
        hits.push({ rule: "kpi-period", file, line, match: "<SummaryKpi" });
      }
    }
  }
  return hits;
}

const isAllowed = (h: Hit) =>
  ALLOWLIST.some(
    (a) => a.rule === h.rule && a.file === h.file && a.line === h.line && a.match === h.match,
  );

describe("UI standard guard (plan §7.2)", () => {
  const hits = scan();

  it("scans the app source", () => {
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES).toContain("components/app-shell.tsx");
    expect(FILES.some((f) => f.startsWith("components/ui/"))).toBe(false);
  });

  it("finds no violations outside the reviewed allowlist", () => {
    const bad = hits
      .filter((h) => !isAllowed(h))
      .map((h) => `${h.rule}: src/${h.file}:${h.line} ${JSON.stringify(h.match)}`);
    expect(bad).toEqual([]);
  });

  it("has no stale allowlist entries", () => {
    const stale = ALLOWLIST.filter(
      (a) =>
        !hits.some(
          (h) => h.rule === a.rule && h.file === a.file && h.line === a.line && h.match === a.match,
        ),
    ).map((a) => `${a.rule}: src/${a.file}:${a.line} ${a.match}`);
    expect(stale).toEqual([]);
  });

  it("every allowlist entry gives a reason", () => {
    for (const a of ALLOWLIST) expect(a.reason.length).toBeGreaterThan(10);
  });

  it("catches each rule on a known-bad sample", () => {
    const sample = [
      'const c = "#ff0000";',
      '<div className="text-teal-600 bg-white" />',
      '<p className="text-[10px]" />',
      "<div style={{ color: 'red' }} />",
      'document.body.classList.add("azure-theme");',
      '<div className="lg:grid-cols-2" />',
      'const v = "oklch(0.5 0.1 200)";',
      '<SummaryKpi label="Revenue FY" period={p} value={1} />',
      'const s = delta >= 0 ? "+" : "";',
    ].join("\n");
    const found = new Set<string>();
    for (const rule of RULES) {
      if ([...sample.matchAll(rule.pattern)].length > 0) found.add(rule.id);
    }
    expect([...found].sort()).toEqual(RULES.map((r) => r.id).sort());
    expect(stripComments('// issue #123\nconst a = "#123"; /* #456 */')).toBe(
      '\nconst a = "#123"; ',
    );
  });
});
