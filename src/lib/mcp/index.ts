import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listCustomersTool from "./tools/list-customers";
import listTransactionsTool from "./tools/list-transactions";
import reportsSummaryTool from "./tools/reports-summary";

// The OAuth issuer MUST be the direct Supabase host. Read the project ref via
// import.meta.env.VITE_SUPABASE_PROJECT_ID so Vite inlines a literal at build time.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "mml-transactions-mcp",
  title: "MakeMyLabs Transactions",
  version: "0.1.0",
  instructions:
    "Read-only access to the MakeMyLabs internal transaction platform for the signed-in user. Use `whoami` to verify identity, `list_customers` and `list_transactions` to browse data (respecting the user's role and RLS), and `reports_summary` for revenue/cost/profit totals for a given year.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoamiTool, listCustomersTool, listTransactionsTool, reportsSummaryTool],
});
