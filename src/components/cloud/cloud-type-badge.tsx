// SCRUM-129: one badge for the stored cloud type (spec §129.4). The badge follows the
// STORED type; the provider is shown separately. Theme tokens only (S11).
import { Badge } from "@/components/ui/badge";
import { cloudTypeLabel, isCloudType } from "@/lib/cloud-provider";
import { cn } from "@/lib/utils";

export function CloudTypeBadge({
  value,
  className,
}: {
  value: string | null | undefined;
  className?: string;
}) {
  const known = isCloudType(value);
  return (
    <Badge
      variant={value === "private_cloud" ? "secondary" : "outline"}
      className={cn("whitespace-nowrap", !known && "text-muted-foreground", className)}
    >
      {cloudTypeLabel(value)}
    </Badge>
  );
}

/** Provider shown next to (not inside) the cloud type badge. Blank shows "No provider". */
export function ProviderBadge({
  value,
  className,
}: {
  value: string | null | undefined;
  className?: string;
}) {
  const text = value?.trim();
  return (
    <Badge
      variant="outline"
      className={cn("whitespace-nowrap", !text && "text-muted-foreground", className)}
    >
      {text || "No provider"}
    </Badge>
  );
}
