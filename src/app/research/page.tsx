import { CSVUpload } from "@/components/CSVUpload";
import { ManualPropForm } from "@/components/ManualPropForm";
import { ResearchLab } from "@/components/ResearchLab";
import { OddsFetch } from "@/components/OddsFetch";
import { getProps } from "@/lib/queries";
import { hasKey } from "@/lib/providers/config";

export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const props = await getProps();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Research Lab</h1>
        <p className="text-sm text-muted-foreground">
          Fetch real market props, import your own, and preview the model's analysis before
          generating picks.
        </p>
      </div>

      <OddsFetch configured={hasKey("ODDS_API_KEY")} />

      <div className="grid gap-4 lg:grid-cols-2">
        <CSVUpload />
        <ManualPropForm />
      </div>

      <ResearchLab props={props} />
    </div>
  );
}
