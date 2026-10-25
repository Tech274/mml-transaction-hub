import { delimitUntrusted, stripInstructionText } from "../guards";
import { MONEY_HIDDEN, maskMoney } from "../money-visibility";
import { toolByKey } from "../tool-catalog";
import type { ReadFilter, ToolContext, ToolOutcome } from "./types";

const TICKET_COLUMNS =
  "id, subject, status, priority, company_name, agent_name, group_name, tags, due_by, is_escalated, ticket_created_at, ticket_updated_at";

function denied(message: string): ToolOutcome {
  return { access: "no_access", rowCount: 0, forModel: null, company: null, recipient: null, ticketId: null, message, untrusted: false };
}

function empty(message: string): ToolOutcome {
  return {
    access: "no_rows",
    rowCount: 0,
    forModel: null,
    company: null,
    recipient: null,
    ticketId: null,
    message: `${message} An empty result is not proof that nothing happened.`,
    untrusted: false,
  };
}

function ticketIdOf(args: Record<string, unknown>): number | null {
  const raw = args.ticket_id ?? args.id;
  const id = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function presentMoney(data: unknown, visible: boolean): unknown {
  return visible ? data : maskMoney(data);
}

export async function executeTool(key: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const tool = toolByKey(key);
  if (!tool || tool.phase !== 1) return denied("That tool is not in the Phase 1 allow-list.");
  if (!tool.requiredRoles.some((role) => ctx.roles.includes(role))) {
    return denied("You do not have access to this data.");
  }

  if (key === "tickets.search" || key === "tickets.get" || key === "tickets.conversation") {
    const companyArg = typeof args.company_name === "string" ? args.company_name.trim() : "";
    if (ctx.pinnedCompany && companyArg && companyArg.toLowerCase() !== ctx.pinnedCompany.toLowerCase()) {
      return {
        access: "pinned",
        rowCount: 0,
        forModel: null,
        company: ctx.pinnedCompany,
        recipient: null,
        ticketId: null,
        message: `Search stays on ${ctx.pinnedCompany} after untrusted ticket text was read.`,
        untrusted: true,
      };
    }
    const filters = [];
    if (key === "tickets.get" || key === "tickets.conversation") {
      const id = ticketIdOf(args);
      if (!id) return { ...denied("A ticket number is required."), access: "invalid" as const };
      filters.push({ column: "id", op: "eq" as const, value: id });
    }
    const company = ctx.pinnedCompany || companyArg;
    if (company) filters.push({ column: "company_name", op: "ilike" as const, value: company });
    if (key === "tickets.search" && typeof args.status === "string" && args.status.trim()) {
      filters.push({ column: "status", op: "eq" as const, value: args.status.trim() });
    }
    const read = await ctx.access.read({
      table: "freshdesk_tickets",
      columns: key === "tickets.conversation" ? `${TICKET_COLUMNS}, description_text, requester_email` : TICKET_COLUMNS,
      filters,
      limit: key === "tickets.search" ? 25 : 1,
      order: { column: "ticket_updated_at", ascending: false },
    });
    if (read.error) return { ...empty("The ticket read failed."), access: "error", message: "The ticket read failed." };
    if (read.rows.length === 0) return empty("No ticket rows.");
    const row = read.rows[0];
    const companyName = typeof row.company_name === "string" ? row.company_name : null;
    const recipient = typeof row.requester_email === "string" ? row.requester_email : null;
    const id = Number(row.id);
    if (key !== "tickets.conversation") {
      const safe = read.rows.map((item) => ({
        ...item,
        subject: typeof item.subject === "string" ? stripInstructionText(item.subject) : item.subject,
      }));
      return {
        access: "rows",
        rowCount: safe.length,
        forModel: delimitUntrusted("ticket", JSON.stringify(safe)),
        company: companyName,
        recipient: null,
        ticketId: Number.isFinite(id) ? id : null,
        message: `${safe.length} ticket row(s).`,
        untrusted: true,
      };
    }
    let conversation = "";
    if (ctx.fetchConversations) {
      try {
        const messages = (await ctx.fetchConversations(id)).slice(-10);
        conversation = messages.map((message) => message.body_text ?? "").join("\n");
      } catch {
        conversation = "";
      }
    }
    const description = typeof row.description_text === "string" ? row.description_text : "";
    const quoted = [String(row.subject ?? ""), description, conversation].filter(Boolean).join("\n").slice(0, 6000);
    return {
      access: "rows",
      rowCount: 1,
      forModel: delimitUntrusted("ticket conversation", quoted || "No conversation text is available."),
      company: companyName,
      recipient,
      ticketId: Number.isFinite(id) ? id : null,
      message: conversation ? "Conversation fetched." : "Live conversation was empty or unavailable. Subject text was used.",
      untrusted: true,
    };
  }

  if (key === "customers.get") {
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (!name) return { ...denied("A customer name is required."), access: "invalid" };
    const read = await ctx.access.read({
      table: "customers",
      columns: "customer_name, account_manager_name, industry, is_active",
      filters: [{ column: "customer_name", op: "ilike", value: `%${name}%` }],
      limit: 5,
    });
    if (read.error) return { ...empty("The customer read failed."), access: "error", message: "The customer read failed." };
    if (read.rows.length === 0) return empty("No customer rows.");
    return {
      access: "rows",
      rowCount: read.rows.length,
      forModel: read.rows,
      company: typeof read.rows[0].customer_name === "string" ? read.rows[0].customer_name : null,
      recipient: null,
      ticketId: null,
      message: `${read.rows.length} customer row(s).`,
      untrusted: false,
    };
  }

  if (key === "reports.summary") {
    const year = Number(args.year);
    if (!Number.isInteger(year)) return { ...denied("A year is required."), access: "invalid" };
    const read = await ctx.access.read({
      table: "transactions",
      columns: "selling_cost, input_cost, total_users, start_date, is_deleted",
      filters: [
        { column: "is_deleted", op: "eq", value: false },
        { column: "start_date", op: "gte", value: `${year}-01-01` },
        { column: "start_date", op: "lte", value: `${year}-12-31` },
      ],
      limit: 2000,
    });
    if (read.error) return { ...empty("The summary read failed."), access: "error", message: "The summary read failed." };
    if (read.rows.length === 0) return empty(`No transactions for ${year}.`);
    const revenue = read.rows.reduce((sum, row) => sum + Number(row.selling_cost ?? 0), 0);
    const cost = read.rows.reduce((sum, row) => sum + Number(row.input_cost ?? 0), 0);
    const users = read.rows.reduce((sum, row) => sum + Number(row.total_users ?? 0), 0);
    const summary = {
      year,
      transactions: read.rows.length,
      users,
      revenue,
      input_cost: cost,
      profit: revenue - cost,
      margin_pct: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 10000) / 100 : 0,
    };
    return {
      access: "rows",
      rowCount: read.rows.length,
      forModel: presentMoney(summary, ctx.moneyVisible),
      company: null,
      recipient: null,
      ticketId: null,
      message: ctx.moneyVisible ? "Summary includes money figures." : `Money figures are ${MONEY_HIDDEN}.`,
      untrusted: false,
    };
  }

  if (key === "transactions.query") {
    const filters: ReadFilter[] = [{ column: "is_deleted", op: "eq", value: false }];
    if (typeof args.year === "number") {
      filters.push({ column: "start_date", op: "gte", value: `${args.year}-01-01` });
      filters.push({ column: "start_date", op: "lte", value: `${args.year}-12-31` });
    }
    if (typeof args.customer_name === "string" && args.customer_name.trim()) {
      filters.push({ column: "customer_name", op: "ilike", value: `%${args.customer_name.trim()}%` });
    }
    const read = await ctx.access.read({
      table: "transactions",
      columns: "potential_id, customer_name, lab_name, lab_type, cloud_provider, line_of_business, total_users, selling_cost, input_cost, start_date",
      filters,
      limit: 200,
    });
    if (read.error) return { ...empty("The transaction read failed."), access: "error", message: "The transaction read failed." };
    if (read.rows.length === 0) return empty("No transaction rows.");
    const rows = read.rows.map((row) => ({
      ...row,
      lab_name: typeof row.lab_name === "string" ? stripInstructionText(row.lab_name) : row.lab_name,
    }));
    return {
      access: "rows",
      rowCount: rows.length,
      forModel: delimitUntrusted("transactions", JSON.stringify(presentMoney(rows, ctx.moneyVisible))),
      company: null,
      recipient: null,
      ticketId: null,
      message: `${rows.length} transaction row(s).`,
      untrusted: true,
    };
  }

  if (key === "sync.health") {
    const read = await ctx.access.read({
      table: "sync_runs",
      columns: "kind, status, started_at, finished_at, error_message",
      filters: [],
      limit: 5,
      order: { column: "started_at", ascending: false },
    });
    if (read.error) return { ...empty("The sync read failed."), access: "error", message: "The sync read failed." };
    if (read.rows.length === 0) return empty("No sync rows.");
    return {
      access: "rows",
      rowCount: read.rows.length,
      forModel: read.rows,
      company: null,
      recipient: null,
      ticketId: null,
      message: `${read.rows.length} sync row(s).`,
      untrusted: false,
    };
  }

  return denied("That tool is not in the Phase 1 allow-list.");
}
