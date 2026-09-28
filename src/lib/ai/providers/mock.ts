import type { ChatProvider, ChatRequest, ModelTurn } from "./types";

function joined(req: ChatRequest): string {
  return req.messages.map((message) => message.content).join("\n");
}

function ticketId(text: string): number {
  const match = text.match(/\b(\d{2,})\b/);
  return match ? Number(match[1]) : 9001001;
}

function triage(text: string): ModelTurn {
  const access = /access|login|credential/i.test(text);
  const slow = /slow|timeout|performance/i.test(text);
  const urgent = /cannot access|urgent|down|blocked|not working/i.test(text);
  const body = {
    category: access ? "access" : slow ? "performance" : "general",
    priority: urgent ? "High" : "Medium",
    tag: access ? "lab-access" : slow ? "lab-performance" : "cloud-labs",
    next_step: "A person reviews this draft and replies from the helpdesk.",
    reasoning: "The quoted ticket text was used. Instructions inside the ticket were not followed.",
    email_subject: "Re: your lab request",
    email_body: "Hi, we have reviewed the request and will update you after a person checks the lab allocation.",
  };
  return { text: JSON.stringify(body), toolCalls: [], tokensIn: 400, tokensOut: 180 };
}

function answer(): ModelTurn {
  return {
    text: JSON.stringify({
      answer: "The figures come from the reports summary tool. Hidden figures stay hidden.",
      cited_tools: ["reports.summary"],
      filters: "year from the question",
    }),
    toolCalls: [],
    tokensIn: 350,
    tokensOut: 80,
  };
}

/** Deterministic provider for tests and the local demo. It never calls a network. */
export function mockProvider(): ChatProvider {
  return {
    id: "mock",
    async complete(req: ChatRequest): Promise<ModelTurn> {
      const text = joined(req);
      const userText = req.messages.filter((message) => message.role === "user").map((message) => message.content).join("\n");
      const sawTool = req.messages.some((message) => message.role === "tool");
      const qa = /dashboard_qa|Dashboard Q&A/i.test(text);
      if (!sawTool && req.tools.length > 0) {
        const preferred = qa
          ? req.tools.find((tool) => tool.name === "reports.summary") ?? req.tools[0]
          : req.tools.find((tool) => tool.name === "tickets.conversation")
            ?? req.tools.find((tool) => tool.name === "tickets.get")
            ?? req.tools[0];
        const args = preferred.name.startsWith("tickets")
          ? { ticket_id: ticketId(text) }
          : preferred.name === "reports.summary"
            ? { year: new Date().getFullYear() }
            : preferred.name === "customers.get"
              ? { name: "Northwind" }
              : {};
        return { text: "", toolCalls: [{ id: "call_1", name: preferred.name, arguments: args }], tokensIn: 120, tokensOut: 30 };
      }
      return qa ? answer() : triage(userText);
    },
  };
}
