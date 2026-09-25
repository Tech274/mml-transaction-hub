import { Fragment, type ReactNode } from "react";

export function tokenize(query: string): string[] {
  return Array.from(
    new Set(
      query
        .trim()
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    ),
  );
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function highlight(text: string | number | null | undefined, tokens: string[]): ReactNode {
  const s = text == null ? "" : String(text);
  if (!s || tokens.length === 0) return s;
  const pattern = tokens.map(escapeRegExp).join("|");
  const splitter = new RegExp(`(${pattern})`, "gi");
  const matcher = new RegExp(`^(?:${pattern})$`, "i");
  const parts = s.split(splitter);
  return (
    <>
      {parts.map((p, i) =>
        matcher.test(p) ? (
          <mark key={i} className="bg-primary/20 text-foreground rounded px-0.5">{p}</mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}
