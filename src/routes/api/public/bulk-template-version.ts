import { createFileRoute } from "@tanstack/react-router";
import { TEMPLATE_VERSION, LINE_OF_BUSINESS_OPTIONS } from "@/lib/bulk-template";

// Public endpoint returning the current CSV template version so the client
// (and E2E tests) can validate sync without relying solely on the bundled
// TEMPLATE_VERSION constant. Read-only, no PII.
export const Route = createFileRoute("/api/public/bulk-template-version")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          template_version: TEMPLATE_VERSION,
          line_of_business_allowed: LINE_OF_BUSINESS_OPTIONS,
        }),
    },
  },
});
