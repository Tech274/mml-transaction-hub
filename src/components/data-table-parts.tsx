// SCRUM-128 plan §4.5 (C4): table parts used with components/ui/table.tsx (patterns from
// tickets.tsx and customers.tsx). One state row, one pagination row, one sortable header.
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Loading / error / empty row: "Loading {things}…", the error + Retry, "No {things} yet." */
export function TableStateRow({
  colSpan,
  children,
  onRetry,
}: {
  colSpan: number;
  children: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="py-8 text-center text-sm text-muted-foreground">
        <div className="flex flex-col items-center gap-2">
          <span>{children}</span>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

/** "Page X of Y" with Previous / Next. Pages are 1-based. Hidden when there is one page. */
export function TablePagination({
  page,
  pageCount,
  onPageChange,
  summary,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Optional left-hand text, e.g. "1,234 matching tickets". Replaces "Page X of Y" when given. */
  summary?: ReactNode;
}) {
  if (pageCount <= 1 && !summary) return null;
  const safeCount = Math.max(1, pageCount);
  return (
    <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="text-muted-foreground">
        {summary ?? `Page ${Math.min(page, safeCount)} of ${safeCount}`}
      </span>
      {safeCount > 1 && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= safeCount}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

export type SortDirection = "asc" | "desc";

/** Header cell whose text is a sort button; `aria-sort` on the th. */
export function SortableHead({
  label,
  active,
  direction,
  onSort,
  className,
}: {
  label: string;
  /** This column is the current sort column. */
  active: boolean;
  direction: SortDirection;
  onSort: () => void;
  className?: string;
}) {
  const Icon = !active ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead
      className={className}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={onSort}
      >
        {label}
        <Icon className={cn("size-3.5", !active && "opacity-60")} aria-hidden />
      </button>
    </TableHead>
  );
}
