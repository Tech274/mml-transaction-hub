import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MailWarning } from "lucide-react";

/**
 * Shared email-draft editor used by the Generalist and Support desk agents only.
 * Nothing here ever sends an email — a human copies or sends it themselves.
 */
export function EmailDraftCard({
  subject,
  body,
  to,
  onSubjectChange,
  onBodyChange,
  readOnly,
}: {
  subject: string;
  body: string;
  to?: string;
  onSubjectChange?: (v: string) => void;
  onBodyChange?: (v: string) => void;
  readOnly?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Email draft</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert>
          <MailWarning className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Human sends — never auto-send. Confirming only marks this draft as approved for a person to send.
          </AlertDescription>
        </Alert>
        {to ? (
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">To</Label>
            <Input value={to} readOnly />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Subject</Label>
          <Input
            value={subject}
            readOnly={readOnly}
            onChange={(e) => onSubjectChange?.(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Body</Label>
          <Textarea
            value={body}
            readOnly={readOnly}
            rows={14}
            className="font-mono text-xs"
            onChange={(e) => onBodyChange?.(e.target.value)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
