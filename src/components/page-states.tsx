// SCRUM-128 plan §4.9 (C4): one loading and one error state for pages and sections (from
// ai-command-center-summary.tsx and tickets.tsx). Tables use TableStateRow (data-table-parts.tsx);
// charts use NoDataYet. No skeletons and no inline spinners on pages.
import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** "Loading {thing}…". Standalone it is a Card; `inCard` when it sits inside a card or sheet. */
export function LoadingState({ thing, inCard = false }: { thing: string; inCard?: boolean }) {
  const text = `Loading ${thing}…`;
  if (inCard) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground" role="status">
        {text}
      </div>
    );
  }
  return (
    <Card>
      <CardContent className="py-8 text-sm text-muted-foreground" role="status">
        {text}
      </CardContent>
    </Card>
  );
}

/** The message to show for an unknown thrown value. */
function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Unknown error";
}

/** "Could not load {thing}" + the message, with Retry where a refetch exists. */
export function ErrorState({
  thing,
  error,
  onRetry,
}: {
  thing: string;
  error?: unknown;
  onRetry?: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Could not load {thing}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>{errorMessage(error)}</span>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw />
            Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** No permission: a plain centred line in a Card (entry.tsx, mcp-audit.tsx pattern). */
export function NoAccessState({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardContent className="py-12 text-center text-sm text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
}
