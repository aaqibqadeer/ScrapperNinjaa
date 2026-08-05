"use client";

import { useState, type FormEvent } from "react";

import { features } from "@/config/features";
import { DEFAULT_AUTHED_PATH } from "@/lib/auth/constants";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { AuthDivider } from "./AuthDivider";
import { MagicLinkForm } from "./MagicLinkForm";
import { OAuthButtons } from "./OAuthButtons";

interface LoginFormProps {
  /** Path to return to after sign-in (from the middleware `next` param). */
  next?: string;
}

/**
 * Sign-in card. Renders only the auth methods enabled in `config/features.ts`;
 * if none are enabled it says so rather than showing an empty form.
 */
export function LoginForm({ next }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const oauthEnabled = features.auth.oauth.google || features.auth.oauth.github;
  const anyMethod =
    features.auth.emailPassword || features.auth.magicLink || oauthEnabled;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { error?: string; redirect?: string };
      if (!res.ok) {
        setError(data.error ?? "Sign in failed");
        return;
      }
      window.location.assign(next ?? data.redirect ?? DEFAULT_AUTHED_PATH);
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Welcome back.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!anyMethod && (
          <p className="text-muted-foreground text-sm">
            No sign-in methods are enabled.
          </p>
        )}

        {features.auth.emailPassword && (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <a
                  href="/reset-password"
                  className="text-sm underline underline-offset-4"
                >
                  Forgot?
                </a>
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        )}

        {features.auth.magicLink && (
          <>
            {features.auth.emailPassword && <AuthDivider />}
            <MagicLinkForm />
          </>
        )}

        {oauthEnabled && (
          <>
            {(features.auth.emailPassword || features.auth.magicLink) && (
              <AuthDivider />
            )}
            <OAuthButtons next={next} />
          </>
        )}

        {features.auth.emailPassword && (
          <p className="text-muted-foreground text-center text-sm">
            No account?{" "}
            <a href="/signup" className="underline underline-offset-4">
              Sign up
            </a>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
