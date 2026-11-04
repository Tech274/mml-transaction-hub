// Plan §4.8 (John 06:11): status badges with one API.
// IncompleteBadge is AMBER (Badge `warning`): the row is valid and counted but needs
// correcting. Red stays for blocking row errors. HealerFixBadge (Badge `info`) marks a value the
// Healer changed, e.g. "OCI → Oracle"; never red or amber, because a fix is not an error.
// SCRUM-128 C4: switched from interim classes to the Badge variants added in C4.
import { Wand } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { IncompleteReason } from "@/lib/transaction-completeness";
import { cn } from "@/lib/utils";

const INCOMPLETE_REASON_TEXT: Record<IncompleteReason, string> = {
  price_missing_or_zero: "a price is missing or 0",
  required_blank: "a required field is blank",
};

/** Hover text: the row's own reasons (from incompleteReasons(row)) when given, else the rule. */
function incompleteBadgeTitle(reasons?: readonly IncompleteReason[]): string {
  const list = reasons && reasons.length > 0 ? reasons : undefined;
  if (!list) return "Incomplete: a price is missing or 0, or a required field is blank";
  return `Incomplete: ${list.map((r) => INCOMPLETE_REASON_TEXT[r]).join(", and ")}`;
}

export function IncompleteBadge({
  title,
  reasons,
  className,
}: {
  title?: string;
  /** incompleteReasons(row) from lib/transaction-completeness.ts, for a row-specific hover text. */
  reasons?: readonly IncompleteReason[];
  className?: string;
}) {
  return (
    <Badge
      variant="warning"
      className={className}
      title={title ?? incompleteBadgeTitle(reasons)}
      data-testid="incomplete-badge"
    >
      Incomplete
    </Badge>
  );
}

export function HealerFixBadge({
  from,
  to,
  rule = "Provider alias, rule provider.alias",
  className,
}: {
  from: string;
  to: string;
  rule?: string;
  className?: string;
}) {
  const text = `${from.trim() || "(blank)"} → ${to}`;
  return (
    <Badge
      variant="info"
      className={cn("max-w-64 gap-1", className)}
      title={`${text} (${rule})`}
      data-testid="healer-fix-badge"
    >
      <Wand className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{text}</span>
    </Badge>
  );
}
