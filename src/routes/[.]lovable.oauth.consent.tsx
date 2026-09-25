import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type OAuthClient = { readonly name?: string; readonly redirect_uri?: string };
type AuthorizationDetails = {
  readonly client?: OAuthClient;
  readonly scope?: string;
  readonly redirect_url?: string;
  readonly redirect_to?: string;
};
type OAuthNamespace = {
  getAuthorizationDetails: (id: string) => Promise<{
    data: AuthorizationDetails | null;
    error: { message: string } | null;
  }>;
  approveAuthorization: (id: string) => Promise<{
    data: AuthorizationDetails | null;
    error: { message: string } | null;
  }>;
  denyAuthorization: (id: string) => Promise<{
    data: AuthorizationDetails | null;
    error: { message: string } | null;
  }>;
};
function oauth(): OAuthNamespace {
  return (supabase.auth as unknown as { oauth: OAuthNamespace }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauth().getAuthorizationDetails(authorizationId);
    if (error) throw error;
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="min-h-screen grid place-items-center p-6">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Authorization request could not be loaded</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{String((error as Error)?.message ?? error)}</p>
        </CardContent>
      </Card>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorization_id)
      : await oauth().denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? "an app";
  const redirectUri = details?.client?.redirect_uri;
  const scope = details?.scope;

  return (
    <main className="min-h-screen grid place-items-center bg-gradient-to-br from-background to-secondary p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader>
          <CardTitle>Connect {clientName} to MakeMyLabs</CardTitle>
          <CardDescription>
            This lets {clientName} use the MakeMyLabs transaction platform as you. It does not bypass this app's roles or backend policies.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm space-y-1">
            <div className="text-muted-foreground">Requested access</div>
            <ul className="list-disc pl-5">
              <li>Share your basic profile and email</li>
              <li>Read data you can already see in this app</li>
              {scope && <li className="text-xs text-muted-foreground">Scopes: {scope}</li>}
            </ul>
          </div>
          {redirectUri && (
            <div className="text-xs text-muted-foreground break-all">
              Redirects back to: {redirectUri}
            </div>
          )}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" disabled={busy} onClick={() => decide(false)}>
              Cancel connection
            </Button>
            <Button disabled={busy} onClick={() => decide(true)}>
              {busy ? "Working…" : "Approve"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
