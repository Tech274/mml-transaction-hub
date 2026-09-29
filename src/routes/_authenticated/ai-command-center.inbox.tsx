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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmailDraftCard } from "@/components/ai-command-center/email-draft-card";
import { useAuth } from "@/lib/auth-context";
import { EXTERNAL_WRITE_ROLE_MESSAGE, EXTERNAL_WRITE_ROLES, writesExternally } from "@/lib/ai-cc-policy";
import {
  listInbox, confirmInboxItem, rejectInboxItem, AGENTS, type AgentKey, type InboxItem,
} from "@/lib/ai-command-center.functions";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";

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
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(getSuperadminCaptureModeEnvForClient());
  const search = Route.useSearch();
  const qc = useQueryClient();
  const [agentFilter, setAgentFilter] = useState<string>(search.agent ?? "all");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [open, setOpen] = useState<InboxItem | null>(null);
  const [note, setNote] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [askExternal, setAskExternal] = useState(false);
  const { hasAnyRole } = useAuth();
  const canWriteExternally = hasAnyRole([...EXTERNAL_WRITE_ROLES]);

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
    enabled: !isExampleCaptureMode,
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
          // SCRUM-76: only sent after the user accepted the "update the real ticket?" dialog.
          ...(writesExternally(item.item_type) ? { confirm_external_write: true } : {}),
        },
      }),
    onSuccess: (r) => {
      const w = r.write_result as { performed?: boolean };
      if (w?.performed) toast.success("Confirmed — helpdesk updated and logged");
      else toast.success("Confirmed and logged");
      qc.invalidateQueries({ queryKey: ["ai-cc"] });
      setOpen(null);
    },
    // A failed helpdesk write leaves the proposal pending; refresh so the recorded attempt shows.
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Could not confirm");
      qc.invalidateQueries({ queryKey: ["ai-cc"] });
    },
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

  const items = isExampleCaptureMode ? EXAMPLE_INBOX_ITEMS : (q.data ?? []);
  const openPayload = (open?.payload ?? {}) as Record<string, unknown>;

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
                      <Button
                        onClick={() => (writesExternally(open.item_type) ? setAskExternal(true) : confirm.mutate(open))}
                        disabled={
                          confirm.isPending || reject.isPending || (writesExternally(open.item_type) && !canWriteExternally)
                        }
                        title={writesExternally(open.item_type) && !canWriteExternally ? EXTERNAL_WRITE_ROLE_MESSAGE : undefined}
                      >
                        {confirm.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                        Confirm
                      </Button>
                    </div>
                    {writesExternally(open.item_type) && !canWriteExternally && (
                      <p className="text-xs text-muted-foreground text-right">{EXTERNAL_WRITE_ROLE_MESSAGE}.</p>
                    )}
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

      <AlertDialog open={askExternal} onOpenChange={setAskExternal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update the real helpdesk ticket?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  This writes to Freshdesk ticket #{String(openPayload.ticket_id ?? "?")} now:
                </p>
                <ul className="list-disc pl-5">
                  {openPayload.resolution_note ? <li>adds a private note</li> : null}
                  {openPayload.suggested_status ? <li>sets the status to {String(openPayload.suggested_status)}</li> : null}
                </ul>
                <p>The customer does not receive an email from this step.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setAskExternal(false);
                if (open) confirm.mutate(open);
              }}
            >
              Update helpdesk
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

const EXAMPLE_INBOX_ITEMS: InboxItem[] = [
  {
    id: "inb-55",
    run_id: "run-901",
    agent_key: "support",
    item_type: "ticket_proposal",
    title: "Ticket #5142 — VM launch failure response and assignment",
    summary: "Proposes urgent priority, assignment to Ritu Sharma, and a guided response with next checks.",
    payload: {
      ticket_id: 5142,
      priority: "Urgent",
      status: "Open",
      assignee: "Ritu Sharma",
      body: "We have restarted the lab orchestrator and validated quota. Please retry launch in 5 minutes.",
    },
    status: "pending",
    decision_note: null,
    decided_by_email: null,
    decided_at: null,
    created_at: "2026-09-29T05:31:14Z",
  },
  {
    id: "inb-58",
    run_id: "run-902",
    agent_key: "generalist",
    item_type: "solution_guide",
    title: "Lab solution guide — Cognizant BPMN cohort",
    summary: "OSS-first recommendation, cost ranges, delivery model and caveats.",
    payload: {
      customer: "Cognizant",
      topic: "Kogito BPMN Automation",
      key_points: ["Open-source preferred", "3-week cohort window", "Cost model attached"],
    },
    status: "pending",
    decision_note: null,
    decided_by_email: null,
    decided_at: null,
    created_at: "2026-09-29T05:35:05Z",
  },
  {
    id: "inb-49",
    run_id: "run-884",
    agent_key: "cost_adr",
    item_type: "adr_field_map",
    title: "ADR draft mapping — TCS AKS Platform Engineering",
    summary: "Mapped requisition to customer, lab batch, users, and estimated input/selling costs.",
    payload: {
      request_code: "LR-2026-093",
      mapped_fields: { users: 38, estimated_input_cost: 142000, estimated_selling_cost: 209000 },
    },
    status: "confirmed",
    decision_note: "Approved after finance review",
    decided_by_email: "admin.demo@mml.local",
    decided_at: "2026-09-29T04:02:19Z",
    created_at: "2026-09-29T03:56:09Z",
  },
];

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
          {p['last_write_attempt'] && item.status === "pending" ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Last helpdesk update failed</AlertTitle>
              <AlertDescription className="text-xs">
                {String(p['last_write_attempt'].by ?? "someone")} · ref {String(p['last_write_attempt'].ref ?? "—")} · already done:{" "}
                {Array.isArray(p['last_write_attempt'].done) && p['last_write_attempt'].done.length > 0
                  ? p['last_write_attempt'].done.join(", ")
                  : "nothing"}
              </AlertDescription>
            </Alert>
          ) : null}
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
