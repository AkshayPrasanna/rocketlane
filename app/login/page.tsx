import { LockKeyhole } from "lucide-react";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { config } from "@/lib/config";

const ERRORS: Record<string, string> = {
  invalid: "Incorrect password.",
  unconfigured: "ADMIN_PASSWORD is not set on the server.",
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{config.appName}</CardTitle>
          <CardDescription>
            Sign in to see deals, the audit log and the escalation queue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action="/api/login" className="space-y-3" method="post">
            <label className="block space-y-1.5 text-sm" htmlFor="password">
              <span className="font-medium">Admin password</span>
              <Input
                autoComplete="current-password"
                autoFocus
                id="password"
                name="password"
                required
                type="password"
              />
            </label>
            <Suspense>
              <LoginError searchParams={searchParams} />
            </Suspense>
            <Button className="w-full" type="submit">
              <LockKeyhole className="h-4 w-4" />
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

async function LoginError({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = error ? ERRORS[error] : undefined;
  return message ? (
    <p className="text-destructive text-sm" role="alert">
      {message}
    </p>
  ) : null;
}
