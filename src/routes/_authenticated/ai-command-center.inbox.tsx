import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { format } from "date-fns";
import { AlertTriangle, Check, Copy, FileText, Inbox as InboxIcon, Loader2, ShieldAlert, X } from "lucide-react";
import { EmailDraftCard } from "@/components/ai-command-center/email-draft-card";
import {
  listInbox, confirmInboxItem, rejectInboxItem, AGENTS, type AgentKey, type InboxItem,
} from "@/lib/ai-command-center.functions";

const AGENT_KEYS: AgentKey[] = ["generalist", "support", "cost_adr"];

export const Route = createFileRoute("/_authenticated/ai-command-center/inbox")({
  validateSearch: (search: Record<string, unknown>) => ({
    agent: AGENT_KEYS.includes(search.agent as AgentKey) ? (search.agent as AgentKey) : undefined,
  }),
  component: InboxPage,
});

const TYPE_LABEL: Record<string, string> = {
  solution_guide: "Solution guide",
  email_draft: "Email draft",
  ticket_proposal: "Ticket proposal",
  adr_field_map: "ADR field map",
};

function InboxPage() {
  const search = Route.useSearch();
  const qc = useQueryClient();
  const [agentFilter, setAgentFilter] = useState<string>(search.agent ?? "all");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [open, setOpen] = useState<InboxItem | null>(null);
  const [note, setNote] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const listFn = useServerFn(listInbox);
  const confirmFn = useServerFn(confirmInboxItem);
  const rejectFn = useServerFn(rejectInboxItem);

  useEffect(() => {
    setAgentFilter(search.agent ?? "all");
  }, [search.agent]);

  const q = useQuery({
    queryKey: ["ai-cc", "inbox", agentFilter, statusFilter],
    queryFn: () => listFn({ data: { agent_key: agentFilter, status: statusFilter } }) as Promise<InboxItem[]>,
    refetchInterval: 20000,
  });

  function openItem(item: InboxItem) {
    const p = item.payload as Record<string, any>;
    setOpen(item);
    setNote("");
    setSubject(String(p['subject'] ?? ""));
    setBody(String(p['body'] ?? ""));
  }

  const confirm = useMutation({
    mutationFn: (item: InboxItem) =>
      confirmFn({
        data: {
          id: item.id,
          note: note.trim() || undefined,
          ...(item.item_type === "email_draft" ? { edited: { subject, body } } : {}),
        },
      }),
    onSuccess: (r) => {
      const w = r.write_result as { performed?: boolean; stubbed?: boolean; reason?: string };
      if (w?.performed) toast.success("Confirmed — helpdesk updated and logged");
      else if (w?.stubbed) toast.warning(`Confirmed and logged. Helpdesk write not applied: ${w.reason ?? "unavailable"}`);
      else toast.success("Confirmed and logged");
      qc.invalidateQueries({ queryKey: ["ai-cc"] });
      setOpen(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not confirm"),
  });

  const reject = useMutation({
    mutationFn: (item: InboxItem) => rejectFn({ data: { id: item.id, note: note.trim() || undefined } }),
    onSuccess: () => {
      toast.success("Rejected and logged");
      qc.invalidateQueries({ queryKey: ["ai-cc"] });
      setOpen(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not reject"),
  });

  const items = q.data ?? [];

  return (
    <AppShell title="AI Command Center — Inbox">
      <div className="space-y-4">
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Nothing happens without you</AlertTitle>
          <AlertDescription className="text-xs">
            Helpdesk updates are held back until you confirm. Email drafts are only ever marked approved for a person to send.
            Approved ADR field maps are never saved into transactions automatically.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Awaiting review</CardTitle>
              <CardDescription>Findings and drafts produced by the three agents.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Select value={agentFilter} onValueChange={setAgentFilter}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All agents</SelectItem>
                  {AGENTS.map((a) => (
                    <SelectItem key={a.key} value={a.key}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {q.isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            )}
            {q.isError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Could not load the inbox</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>{q.error instanceof Error ? q.error.message : "Unknown error"}</p>
                  <Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>
                </AlertDescription>
              </Alert>
            )}
            {!q.isLoading && items.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <InboxIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Nothing here yet.</p>
                <Button asChild variant="outline" size="sm" className="mt-3">
                  <Link to="/ai-command-center/run-now" search={{ agent: "generalist" as AgentKey }}>Run an agent</Link>
                </Button>
              </div>
            )}
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => openItem(it)}
                className="w-full text-left rounded-lg border p-3 hover:bg-accent transition-colors"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{AGENTS.find((a) => a.key === it.agent_key)?.name ?? it.agent_key}</Badge>
                  <Badge variant="secondary">{TYPE_LABEL[it.item_type] ?? it.item_type}</Badge>
                  <Badge
                    variant={it.status === "pending" ? "destructive" : it.status === "confirmed" ? "default" : "outline"}
                  >
                    {it.status}
                  </Badge>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {format(new Date(it.created_at), "dd MMM yyyy HH:mm")}
                  </span>
                </div>
                <div className="mt-2 text-sm font-medium">{it.title}</div>
                <p className="text-xs text-muted-foreground">{it.summary}</p>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle>{open.title}</SheetTitle>
                <SheetDescription>
                  {TYPE_LABEL[open.item_type]} · {AGENTS.find((a) => a.key === open.agent_key)?.name} ·{" "}
                  {format(new Date(open.created_at), "dd MMM yyyy HH:mm")}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-4">
                <ItemBody
                  item={open}
                  subject={subject}
                  body={body}
                  onSubjectChange={setSubject}
                  onBodyChange={setBody}
                />

                {open.status === "pending" ? (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                        Decision note (optional)
                      </Label>
                      <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => reject.mutate(open)}
                        disabled={reject.isPending || confirm.isPending}
                      >
                        {reject.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <X className="h-4 w-4 mr-1" />}
                        Reject
                      </Button>
                      <Button onClick={() => confirm.mutate(open)} disabled={confirm.isPending || reject.isPending}>
                        {confirm.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                        Confirm
                      </Button>
                    </div>
                  </>
                ) : (
                  <Alert>
                    <Check className="h-4 w-4" />
                    <AlertTitle className="capitalize">{open.status}</AlertTitle>
                    <AlertDescription className="text-xs">
                      {open.decided_by_email ?? "someone"} on{" "}
                      {open.decided_at ? format(new Date(open.decided_at), "dd MMM yyyy HH:mm") : "—"}
                      {open.decision_note ? ` · ${open.decision_note}` : ""}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}

function ItemBody({
  item,
  subject,
  body,
  onSubjectChange,
  onBodyChange,
}: {
  item: InboxItem;
  subject: string;
  body: string;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
}) {
  const p = item.payload as Record<string, any>;

  if (item.item_type === "email_draft") {
    return (
      <EmailDraftCard
        subject={subject}
        body={body}
        to={p['to'] ? String(p['to']) : undefined}
        onSubjectChange={onSubjectChange}
        onBodyChange={onBodyChange}
        readOnly={item.status !== "pending"}
      />
    );
  }

  if (item.item_type === "solution_guide") {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" /> Lab Solution Guide draft
          </CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap text-xs leading-relaxed font-mono">{String(p['markdown'] ?? "")}</pre>
        </CardContent>
      </Card>
    );
  }

  if (item.item_type === "ticket_proposal") {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Proposed helpdesk update</CardTitle>
          <CardDescription className="text-xs">
            The helpdesk is untouched until you confirm. On confirm we apply the status and add the note.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <KeyValues
            rows={[
              ["Ticket", `#${p['ticket_id']} — ${p['ticket_subject'] ?? ""}`],
              ["Company", p['company_name'] ?? "—"],
              ["Current status", p['current_status'] ?? "—"],
              ["Current priority", p['current_priority'] ?? "—"],
              ["Suggested status", p['suggested_status'] ?? "—"],
              ["Suggested priority", p['suggested_priority'] ?? "—"],
              ["Suggested tag", p['suggested_tag'] ?? "—"],
              ["Suggested assignee", p['suggested_assignee'] ?? "—"],
            ]}
          />
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Note added on confirm</Label>
            <p className="text-xs mt-1">{String(p['resolution_note'] ?? "")}</p>
          </div>
          {p['write_result'] ? (
            <Alert>
              <AlertDescription className="text-xs font-mono">{JSON.stringify(p['write_result'])}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  // adr_field_map
  const fm = (p['field_map'] ?? {}) as Record<string, unknown>;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Proposed Master ADR fields</CardTitle>
        <CardDescription className="text-xs">
          Confirming approves the field map only. No transaction is saved — open Master ADR Entry and save it yourself.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <KeyValues rows={Object.entries(fm).map(([k, v]) => [k, v === null || v === "" ? "—" : String(v)])} />
        <div className="text-xs text-muted-foreground">
          Margin: {String(p['margin_pct'] ?? "—")}% · Request {String(p['request_code'] ?? "—")}
        </div>
        {Array.isArray(p['extraction_notes']) && (
          <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1">
            {(p['extraction_notes'] as string[]).map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/entry">Open Master ADR Entry</Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const json = JSON.stringify(fm, null, 2);
              try {
                sessionStorage.setItem("ai_cc_adr_prefill", json);
              } catch {
                /* ignore */
              }
              navigator.clipboard?.writeText(json);
              toast.success("Field map copied as JSON");
            }}
          >
            <Copy className="h-3.5 w-3.5 mr-1" /> Copy JSON
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function KeyValues({ rows }: { rows: [string, unknown][] }) {
  return (
    <Table>
      <TableBody>
        {rows.map(([k, v]) => (
          <TableRow key={k}>
            <TableCell className="text-xs text-muted-foreground w-44 capitalize">{k.replace(/_/g, " ")}</TableCell>
            <TableCell className="text-xs">{String(v)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
