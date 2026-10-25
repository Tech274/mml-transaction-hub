import { createHash } from "node:crypto";
import { SAFETY_PREAMBLE, checkDraftText, delimitUntrusted } from "./guards";
import { costUsd } from "./limits";
import { parseModelJson, qaOutputSchema, triageOutputSchema } from "./schemas";
import { toolByKey } from "./tool-catalog";
import { executeTool } from "./tools/execute";
import type { ToolContext, ToolOutcome } from "./tools/types";
import { ProviderHttpError, type ChatMessage, type ChatProvider, type ToolSpec } from "./providers/types";

export interface EngineStep {
  kind: "model_call" | "tool_call" | "guard" | "output";
  name: string;
  inputRedacted: unknown;
  outputRedacted: unknown;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  durationMs: number;
  status: string;
  error: string | null;
}

export interface EngineResult {
  status: "done" | "error" | "cancelled" | "budget_blocked";
  error: string | null;
  steps: EngineStep[];
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  output: Record<string, unknown> | null;
  inbox: { item_type: string; title: string; summary: string; payload: Record<string, unknown>; contains_money: boolean }[];
  tripBreaker: boolean;
  providerSawSecret: boolean;
}

export interface EngineInput {
  provider: ChatProvider;
  agentKey: string;
  purpose: string;
  instructions: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  outputTypes: string[];
  toolKeys: string[];
  userText: string;
  price: { inputPerMtokUsd: number; outputPerMtokUsd: number };
  perRunCapUsd: number;
  maxToolCalls: number;
  maxTurns: number;
  isEnabled: () => boolean | Promise<boolean>;
  toolContext: ToolContext;
  allowMoney: boolean;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function truncate(value: unknown): unknown {
  const text = JSON.stringify(value);
  if (text.length <= 2000) return value;
  return { truncated: true, preview: text.slice(0, 2000), sha256: hash(value) };
}

export async function runModelLoop(input: EngineInput): Promise<EngineResult> {
  const steps: EngineStep[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let spent = 0;
  let toolCalls = 0;
  let pinned = input.toolContext.pinnedCompany;
  let recipient: string | null = null;
  let ticketId: number | null = null;
  let providerSawSecret = false;
  const tools: ToolSpec[] = input.toolKeys
    .map((key) => toolByKey(key))
    .filter((tool): tool is NonNullable<typeof tool> => !!tool)
    .map((tool) => ({ name: tool.key, description: tool.description, parameters: tool.parameters }));

  const userBlock = delimitUntrusted("request", input.userText);
  const secretValues = [
    ...input.userText.matchAll(/\b(?:password|passwd|pwd|api[_-]?key|secret|token)\s*[:=]\s*(\S+)/gi),
  ].map((match) => match[1]);
  providerSawSecret = secretValues.some((value) => value.length > 2 && userBlock.includes(value));
  const messages: ChatMessage[] = [
    { role: "system", content: `${SAFETY_PREAMBLE}\n\nAgent key: ${input.agentKey}\nPurpose: ${input.purpose}\n\n${input.instructions}` },
    { role: "user", content: userBlock },
  ];
  steps.push({
    kind: "guard",
    name: "untrusted-input",
    inputRedacted: {},
    outputRedacted: { prompt: userBlock.slice(0, 2000) },
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    durationMs: 0,
    status: providerSawSecret ? "leak" : "ok",
    error: providerSawSecret ? "secret reached the prompt" : null,
  });

  const stop = (status: EngineResult["status"], error: string, trip = false): EngineResult => ({
    status,
    error,
    steps,
    tokensIn,
    tokensOut,
    costUsd: spent,
    output: null,
    inbox: [],
    tripBreaker: trip,
    providerSawSecret,
  });

  for (let turn = 0; turn < input.maxTurns; turn++) {
    if (!(await input.isEnabled())) return stop("cancelled", "AI agents are switched off by the kill switch.");
    const nextEstimate = costUsd(500, input.maxOutputTokens, input.price);
    if (spent + nextEstimate > input.perRunCapUsd) {
      return stop("budget_blocked", "This run stopped because the next model call would pass the per-run cap.");
    }
    const started = Date.now();
    let turnResult;
    try {
      turnResult = await input.provider.complete({
        model: input.model,
        temperature: input.temperature,
        maxOutputTokens: input.maxOutputTokens,
        messages,
        tools,
      });
    } catch (error) {
      const status = error instanceof ProviderHttpError ? error.status : 0;
      steps.push({
        kind: "model_call",
        name: input.model,
        inputRedacted: { turn },
        outputRedacted: {},
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        durationMs: Date.now() - started,
        status: "error",
        error: error instanceof Error ? error.message : "provider error",
      });
      return stop("error", error instanceof Error ? error.message : "provider error", status === 402);
    }
    const callCost = costUsd(turnResult.tokensIn, turnResult.tokensOut, input.price);
    tokensIn += turnResult.tokensIn;
    tokensOut += turnResult.tokensOut;
    spent += callCost;
    steps.push({
      kind: "model_call",
      name: input.model,
      inputRedacted: { turn, tools: tools.map((tool) => tool.name) },
      outputRedacted: truncate({ text: turnResult.text, toolCalls: turnResult.toolCalls.map((call) => call.name) }),
      tokensIn: turnResult.tokensIn,
      tokensOut: turnResult.tokensOut,
      costUsd: callCost,
      durationMs: Date.now() - started,
      status: "ok",
      error: null,
    });
    if (spent > input.perRunCapUsd) return stop("budget_blocked", "This run stopped because it passed the per-run cap.");

    if (turnResult.toolCalls.length === 0) {
      return finish(input, turnResult.text, steps, tokensIn, tokensOut, spent, recipient, ticketId, providerSawSecret, pinned);
    }
    messages.push({ role: "assistant", content: turnResult.text || "Calling tools." });
    for (const call of turnResult.toolCalls) {
      if (toolCalls >= input.maxToolCalls) return stop("error", "The run reached the tool-call limit.");
      toolCalls += 1;
      const toolStarted = Date.now();
      const outcome = await executeTool(call.name, call.arguments, { ...input.toolContext, pinnedCompany: pinned });
      if (outcome.untrusted && outcome.company) pinned = outcome.company;
      if (outcome.recipient) recipient = outcome.recipient;
      if (outcome.ticketId) ticketId = outcome.ticketId;
      steps.push({
        kind: "tool_call",
        name: call.name,
        inputRedacted: call.arguments,
        outputRedacted: { access: outcome.access, rowCount: outcome.rowCount, sha256: hash(outcome.forModel), preview: truncate(outcome.forModel), message: outcome.message },
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        durationMs: Date.now() - toolStarted,
        status: outcome.access,
        error: outcome.access === "error" ? outcome.message : null,
      });
      messages.push({
        role: "tool",
        toolCallId: call.id,
        content: JSON.stringify({ access: outcome.access, message: outcome.message, data: outcome.forModel }),
      });
    }
  }
  return stop("error", "The run reached the model-turn limit before it produced JSON.");
}

function finish(
  input: EngineInput,
  text: string,
  steps: EngineStep[],
  tokensIn: number,
  tokensOut: number,
  spent: number,
  recipient: string | null,
  ticketId: number | null,
  providerSawSecret: boolean,
  _pinned: string | null,
): EngineResult {
  const base = {
    steps,
    tokensIn,
    tokensOut,
    costUsd: spent,
    tripBreaker: false,
    providerSawSecret,
  };
  try {
    const parsed = parseModelJson(text);
    if (input.agentKey === "dashboard_qa" || input.outputTypes.includes("qa_answer")) {
      const qa = qaOutputSchema.parse(parsed);
      const draft = `${qa.answer}\n${qa.filters}`;
      const guard = checkDraftText(draft, input.userText, input.allowMoney);
      steps.push({ kind: "guard", name: "output", inputRedacted: {}, outputRedacted: guard, tokensIn: 0, tokensOut: 0, costUsd: 0, durationMs: 0, status: guard.ok ? "ok" : "flagged", error: guard.ok ? null : guard.reasons.join("; ") });
      if (!guard.ok) {
        return { ...base, status: "error", error: guard.reasons.join("; "), output: null, inbox: [] };
      }
      const payload = { answer: qa.answer, cited_tools: qa.cited_tools, filters: qa.filters, ai_generated: true };
      return {
        ...base,
        status: "done",
        error: null,
        output: payload,
        inbox: [
          {
            item_type: "qa_answer",
            title: "Dashboard answer",
            summary: qa.answer.slice(0, 180),
            payload,
            contains_money: input.allowMoney,
          },
        ],
      };
    }
    const triage = triageOutputSchema.parse(parsed);
    const guard = checkDraftText(`${triage.reasoning}\n${triage.email_body}`, input.userText, input.allowMoney);
    steps.push({ kind: "guard", name: "output", inputRedacted: {}, outputRedacted: guard, tokensIn: 0, tokensOut: 0, costUsd: 0, durationMs: 0, status: guard.ok ? "ok" : "flagged", error: guard.ok ? null : guard.reasons.join("; ") });
    if (!guard.ok) return { ...base, status: "error", error: guard.reasons.join("; "), output: null, inbox: [] };
    const note = {
      category: triage.category,
      priority: triage.priority,
      tag: triage.tag,
      next_step: triage.next_step,
      reasoning: triage.reasoning,
      ticket_id: ticketId,
      ai_generated: true,
    };
    return {
      ...base,
      status: "done",
      error: null,
      output: note,
      inbox: [
        {
          item_type: "triage_note",
          title: ticketId ? `Triage for ticket #${ticketId}` : "Ticket triage",
          summary: `${triage.priority} · ${triage.tag} · ${triage.next_step}`,
          payload: note,
          contains_money: false,
        },
        {
          item_type: "email_draft",
          title: ticketId ? `Email draft — ticket #${ticketId}` : "Email draft",
          summary: "Reply for a person to send. The agent does not send it.",
          payload: {
            subject: triage.email_subject,
            body: triage.email_body,
            to: recipient ?? "",
            ticket_id: ticketId,
            ai_generated: true,
          },
          contains_money: false,
        },
      ],
    };
  } catch (error) {
    return { ...base, status: "error", error: error instanceof Error ? error.message : "invalid output", output: null, inbox: [] };
  }
}

export type { ToolOutcome };
