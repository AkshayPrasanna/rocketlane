import { Header } from "@/components/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { config } from "@/lib/config";

export default function DealsPage() {
  return (
    <>
      <Header description={`${config.appName} deal pipeline`} title="Deals" />
      <div className="flex-1 space-y-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">No deals yet</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Deals appear here once the intake workflow is wired up.
          </CardContent>
        </Card>
      </div>
    </>
  );
}
