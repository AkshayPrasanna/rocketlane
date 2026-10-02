"use client";

import { AlertCircle, ArrowLeft, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ConversationError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error("Conversation error:", error);
  }, [error]);

  return (
    <div className="p-4">
      <Button asChild className="mb-3" size="sm" variant="ghost">
        <Link href="/activity">
          <ArrowLeft className="mr-1 h-3 w-3" /> Activity
        </Link>
      </Button>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive/50" />
          <h2 className="mt-3 font-medium text-base">
            Failed to load conversation
          </h2>
          <p className="mt-1 max-w-sm text-muted-foreground text-sm">
            {error.message ||
              "Something went wrong while loading this conversation."}
          </p>
          <Button className="mt-4" onClick={reset} size="sm" variant="outline">
            <RotateCcw className="mr-1.5 h-3 w-3" />
            Try again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
