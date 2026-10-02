import { ArrowLeft, Search } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function NotFound() {
  return (
    <div className="p-4">
      <Button asChild className="mb-3" size="sm" variant="ghost">
        <Link href="/activity">
          <ArrowLeft className="mr-1 h-3 w-3" /> Back to activity
        </Link>
      </Button>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <Search className="h-8 w-8 text-muted-foreground/50" />
          <h2 className="mt-3 font-medium text-base">Action not found</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            This action may have expired or been deleted.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
