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
import { OAuthButtons } from "./OAuthButtons";

/**
 * Sign-up card. Email/password registration when that method is enabled, plus
 * any enabled OAuth providers. Renders only what `config/features.ts` enables.
 */
export function SignupForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const oauthEnabled = features.auth.oauth.google || features.auth.oauth.github;
  const anyMethod = features.auth.emailPassword || oauthEnabled;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = (await res.json()) as { error?: string; redirect?: string };
      if (!res.ok) {
        setError(data.error ?? "Sign up failed");
        return;
      }
      window.location.assign(data.redirect ?? DEFAULT_AUTHED_PATH);
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>Get started in seconds.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!anyMethod && (
          <p className="text-muted-foreground text-sm">
            Sign-up is currently disabled.
          </p>
        )}

        {features.auth.emailPassword && (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
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
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
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
              {loading ? "Creating account…" : "Sign up"}
            </Button>
          </form>
        )}

        {oauthEnabled && (
          <>
            {features.auth.emailPassword && <AuthDivider />}
            <OAuthButtons />
          </>
        )}

        {features.auth.emailPassword && (
          <p className="text-muted-foreground text-center text-sm">
            Already have an account?{" "}
            <a href="/login" className="underline underline-offset-4">
              Sign in
            </a>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
