// SCRUM-129: the six providers grouped Private cloud / Public cloud, for any shadcn Select.
import { SelectGroup, SelectItem, SelectLabel } from "@/components/ui/select";
import { PROVIDER_GROUPS, type CloudType } from "@/lib/cloud-provider";

export function ProviderSelectItems({ only }: { only?: CloudType | null }) {
  const groups = only ? PROVIDER_GROUPS.filter((g) => g.cloudType === only) : PROVIDER_GROUPS;
  return (
    <>
      {groups.map((g) => (
        <SelectGroup key={g.cloudType}>
          <SelectLabel className="text-xs text-muted-foreground">{g.label}</SelectLabel>
          {g.providers.map((p) => (
            <SelectItem key={p} value={p}>
              {p}
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
    </>
  );
}
