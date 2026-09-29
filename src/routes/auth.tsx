import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getSupabaseConfigError, supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — MakeMyLabs Transaction Platform" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" ? s.next : "",
  }),
  component: AuthPage,
});

function AuthPage() {
  const { next } = useSearch({ from: "/auth" });
  // Only follow same-origin relative paths — never a scheme/host.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "";
  const redirectTo = (): string => safeNext || "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const configError = getSupabaseConfigError();

  useEffect(() => {
    if (configError) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.href = redirectTo();
    });
  }, [safeNext, configError]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (configError) {
      toast.error(`${configError} Configure Supabase and refresh this page.`);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Signed in");
    window.location.href = redirectTo();
  }


  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-background to-secondary p-4">
      <Toaster richColors position="top-right" />
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader>
          <div className="flex items-center gap-2 mb-2">
            <div className="h-9 w-9 rounded-md bg-primary text-primary-foreground grid place-items-center font-bold">M</div>
            <div>
              <CardTitle className="text-lg">MakeMyLabs</CardTitle>
              <CardDescription>Internal Transaction Platform</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {configError && (
            <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              {configError} Configure the runtime values and refresh. The sign-in form is shown for
              configuration checks only.
            </div>
          )}
          <form onSubmit={signIn} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={loading || !!configError}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Accounts are created by an administrator. Contact your admin for access.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}