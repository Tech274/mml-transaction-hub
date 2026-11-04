// SCRUM-131 (John 06:25; plan §4.11): All · Complete · Incomplete tabs (default All),
// standard shadcn Tabs, counts in the triggers, three equal triggers at 390.
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  COMPLETENESS_TABS,
  COMPLETENESS_TAB_LABEL,
  completenessFilterSummary,
  type CompletenessTab,
} from "@/lib/completeness-tabs";
import { fmtNumber } from "@/lib/format";

export function CompletenessTabs({
  value,
  onChange,
  counts,
}: {
  value: CompletenessTab;
  onChange: (tab: CompletenessTab) => void;
  counts: Record<CompletenessTab, number>;
}) {
  return (
    <div
      className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
      data-testid="completeness-filter-bar"
    >
      <Tabs value={value} onValueChange={(v) => onChange(v as CompletenessTab)}>
        <TabsList
          className="grid w-full grid-cols-3 sm:inline-flex sm:w-auto"
          data-testid="completeness-tabs"
        >
          {COMPLETENESS_TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab} data-testid={`completeness-tab-${tab}`}>
              {COMPLETENESS_TAB_LABEL[tab]} ({fmtNumber(counts[tab])})
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {value !== "all" && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {completenessFilterSummary(value, counts[value])}
        </p>
      )}
    </div>
  );
}
