// SCRUM-128 plan §4.6 (C4): the one filter / toolbar bar (pattern customers.tsx:282-327).
// Below md every control is full width and stacked; from md they sit in one row and wrap, so a
// toolbar never scrolls sideways. Status choices are Tabs above or beside the bar (§4.11).
import { useId, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function FilterBar({ children, summary }: { children: ReactNode; summary?: ReactNode }) {
  return (
    <Card className="p-4" data-testid="filter-bar">
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">{children}</div>
      {summary}
    </Card>
  );
}

export function FilterSearch({
  value,
  onChange,
  placeholder,
  label = "Search",
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Accessible name (the placeholder is not a label). */
  label?: string;
  /** Optional data-testid on the input (R8 hooks kept from older filter rows). */
  testId?: string;
}) {
  return (
    <div className="relative w-full md:min-w-64 md:flex-1">
      <Search
        className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        className="pl-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
      />
    </div>
  );
}

export type FilterOption = { value: string; label: string };
export type FilterOptionGroup = { label: string; options: readonly FilterOption[] };

function isGroup(o: FilterOption | FilterOptionGroup): o is FilterOptionGroup {
  return "options" in o;
}

/**
 * A select with its label as a muted prefix inside the trigger ("Year: 2026") and a real
 * sr-only <Label> tied to the trigger, so screen readers and the e2e locator
 * `label:has-text("Year") → .. → [role=combobox]` keep working. The first option is "All {things}".
 * Pass `options` (flat or grouped with SelectGroup + SelectLabel) or your own `children` items
 * (e.g. ProviderSelectItems).
 */
export function FilterSelect({
  label,
  value,
  onValueChange,
  allLabel,
  allValue = "all",
  options,
  children,
  width = "sm",
  id,
  placeholder,
  testId,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  /** "All providers". Omit when the select has no "all" choice (e.g. Sort). */
  allLabel?: string;
  allValue?: string;
  options?: readonly (FilterOption | FilterOptionGroup)[];
  children?: ReactNode;
  /** sm = md:w-40 (default); md = md:w-64 for long names (customers, account managers). */
  width?: "sm" | "md";
  id?: string;
  /** Shown when `value` matches no option (e.g. "Select your agent name"). */
  placeholder?: string;
  /** Optional data-testid on the trigger (R8 hooks kept from older filter rows). */
  testId?: string;
}) {
  const autoId = useId();
  const triggerId = id ?? `filter-${autoId}`;
  return (
    <div className={cn("w-full", width === "md" ? "md:w-64" : "md:w-40")}>
      <Label className="sr-only" htmlFor={triggerId}>
        {label}
      </Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={triggerId} data-testid={testId}>
          <span className="flex min-w-0 items-center gap-1">
            <span className="shrink-0 text-muted-foreground" aria-hidden>
              {label}:
            </span>
            <span className="truncate">
              <SelectValue placeholder={placeholder} />
            </span>
          </span>
        </SelectTrigger>
        <SelectContent>
          {allLabel && <SelectItem value={allValue}>{allLabel}</SelectItem>}
          {options?.map((o) =>
            isGroup(o) ? (
              <SelectGroup key={`group:${o.label}`}>
                <SelectLabel>{o.label}</SelectLabel>
                {o.options.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ) : (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ),
          )}
          {children}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Reset (ghost sm), Export (sm + Download), Add (sm + Plus): right-aligned from md, wrapping. */
export function FilterActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2 md:ml-auto">{children}</div>;
}

export type FilterSummaryItem = { label: string; value: string; testId?: string };

/** Optional second row: "Showing 1,234 · Revenue ₹… ·" with values in strong tabular-nums. */
export function FilterSummary({ items }: { items: readonly FilterSummaryItem[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-sm text-muted-foreground">
      {items.map((item) => (
        <span key={item.label}>
          {item.label}{" "}
          <strong className="tabular-nums text-foreground" data-testid={item.testId}>
            {item.value}
          </strong>
        </span>
      ))}
    </div>
  );
}
