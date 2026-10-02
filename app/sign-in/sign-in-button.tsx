"use client";

import { MessageCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

const oauthErrorMessages: Record<string, string> = {
  access_denied:
    "Sign-in was denied. You may not have access to this workspace.",
  invalid_team_for_non_distributed_app:
    "You must be signed into the correct Slack workspace first.",
  invalid_request: "The sign-in request was invalid. Please try again.",
  server_error: "Slack encountered an error. Please try again later.",
  temporarily_unavailable:
    "Slack is temporarily unavailable. Please try again later.",
};

function getInitialError(oauthError: string | null): string | null {
  if (!oauthError) {
    return null;
  }
  return oauthErrorMessages[oauthError] ?? "Sign-in failed. Please try again.";
}

export function SignInButton() {
  const searchParams = useSearchParams();
  const isDev = process.env.NODE_ENV !== "production";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    getInitialError(searchParams.get("error"))
  );

  async function handleDevSignIn() {
    setLoading(true);
    setError(null);
    const email = "dev@example.com";
    const password = "dev-password";

    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        const signUp = await authClient.signUp.email({
          email,
          password,
          name: "Dev User",
        });
        if (signUp.error) {
          setError("Failed to create dev account.");
          setLoading(false);
          return;
        }
        const retry = await authClient.signIn.email({ email, password });
        if (retry.error) {
          setError("Failed to sign in after creating account.");
          setLoading(false);
          return;
        }
      }
      window.location.href = "/";
    } catch {
      setError("An unexpected error occurred.");
      setLoading(false);
    }
  }

  async function handleSlackSignIn() {
    setLoading(true);
    setError(null);
    try {
      const result = await authClient.signIn.social({
        provider: "slack",
        callbackURL: "/",
      });
      if (result.error) {
        setError(
          result.error.message ||
            "Failed to sign in with Slack. Check that Slack is configured correctly."
        );
        setLoading(false);
      }
    } catch {
      setError("Failed to start Slack sign-in.");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
      <Button className="w-full" disabled={loading} onClick={handleSlackSignIn}>
        {loading ? (
          <>
            <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-background/30 border-t-background" />
            Redirecting…
          </>
        ) : (
          <>
            <MessageCircle className="mr-2 h-4 w-4" />
            Sign in with Slack
          </>
        )}
      </Button>
      {isDev && (
        <Button
          className="w-full"
          disabled={loading}
          onClick={handleDevSignIn}
          variant="outline"
        >
          {loading ? "Signing in..." : "Dev Sign In (local only)"}
        </Button>
      )}
    </div>
  );
}
