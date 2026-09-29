import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getAiUiAvailability, runModelAgent } from "@/lib/ai/agent.functions";
import { useAuth } from "@/lib/auth-context";

export function DashboardAskBox() {
  const { hasAnyRole } = useAuth();
  const canAsk = hasAnyRole(["admin", "leadership", "finance", "ops_lead"]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const run = useServerFn(runModelAgent);
  const availabilityFn = useServerFn(getAiUiAvailability);
  const availability = useQuery({
    queryKey: ["ai-ui-availability", "dashboard-ask"],
    queryFn: () => availabilityFn(),
    enabled: canAsk,
  });
  const mut = useMutation({
    mutationFn: () => run({ data: { agentKey: "dashboard_qa", hint: question } }),
    onSuccess: (result) => setAnswer(result.error || String((result.output as { answer?: string } | null)?.answer ?? result.status)),
    onError: (error) => setAnswer(error instanceof Error ? error.message : "Could not ask"),
  });
  if (!canAsk || !availability.data?.dashboardQaEnabled) return null;
  return (
    <Card data-testid="dashboard-ask">
      <CardHeader>
        <CardTitle className="text-base">Ask about these figures</CardTitle>
        <CardDescription>Dashboard Q&A drafts an answer from data you can already see. It does not change anything.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="How many transactions this year?" />
        <div className="flex gap-2">
          <Button size="sm" onClick={() => mut.mutate()} disabled={mut.isPending || question.trim().length < 3}>Ask</Button>
          <Button asChild size="sm" variant="outline"><Link to="/ai-command-center/inbox" search={{ agent: "dashboard_qa" }}>Inbox</Link></Button>
        </div>
        {answer && <p className="text-sm whitespace-pre-wrap">{answer}</p>}
      </CardContent>
    </Card>
  );
}
