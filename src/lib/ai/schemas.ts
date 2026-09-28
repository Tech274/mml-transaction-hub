import { z } from "zod";

export const TRIAGE_PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
export const TRIAGE_TAGS = ["lab-access", "lab-performance", "cloud-labs", "billing", "other"] as const;

export const triageOutputSchema = z.object({
  category: z.string().min(1).max(80),
  priority: z.enum(TRIAGE_PRIORITIES),
  tag: z.enum(TRIAGE_TAGS),
  next_step: z.string().min(1).max(500),
  reasoning: z.string().min(1).max(2000),
  email_subject: z.string().min(1).max(200),
  email_body: z.string().min(1).max(4000),
});

export const qaOutputSchema = z.object({
  answer: z.string().min(1).max(4000),
  cited_tools: z.array(z.string().min(1).max(80)).min(1).max(12),
  filters: z.string().max(500),
});

export type TriageOutput = z.infer<typeof triageOutputSchema>;
export type QaOutput = z.infer<typeof qaOutputSchema>;

export function parseModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return JSON");
  return JSON.parse(trimmed.slice(start, end + 1));
}
