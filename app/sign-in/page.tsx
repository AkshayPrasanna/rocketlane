import { ArrowRight, ExternalLink, Info } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { config } from "@/lib/config";
import { SignInButton } from "./sign-in-button";

const PROTOCOL_RE = /^https?:\/\//;

export default function SignInPage() {
  if (config.adminDemoMode) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">
              {config.communityName} Demo
            </CardTitle>
            <CardDescription>
              Browse the template with mock activity before connecting Slack.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/">
                View demo dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">
            {config.communityName} Admin
          </CardTitle>
          <CardDescription>
            Sign in with your Slack account to access the admin panel.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {config.slackWorkspaceUrl && (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/50">
              <div className="flex gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-blue-900 dark:text-blue-200">
                    Sign into your Slack workspace first
                  </p>
                  <p className="text-blue-700 dark:text-blue-300">
                    Open{" "}
                    <a
                      className="inline-flex items-center gap-0.5 font-medium underline underline-offset-2"
                      href={config.slackWorkspaceUrl}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {config.slackWorkspaceUrl.replace(PROTOCOL_RE, "")}
                      <ExternalLink className="h-3 w-3" />
                    </a>{" "}
                    and make sure you&apos;re logged in, then come back here.
                  </p>
                </div>
              </div>
            </div>
          )}
          <Suspense>
            <SignInButton />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
