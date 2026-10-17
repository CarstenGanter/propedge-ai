import { CSVUpload } from "@/components/CSVUpload";
import { ManualPropForm } from "@/components/ManualPropForm";
import { ResearchLab } from "@/components/ResearchLab";
import { OddsFetch } from "@/components/OddsFetch";
import { getProps } from "@/lib/queries";
import { hasKey } from "@/lib/providers/config";
import { PageHeader } from "@/components/common";

export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const props = await getProps();

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Props & data"
        title="Research Lab"
        description={
          <>
            Fetch real market props, import your own, and preview the model&apos;s analysis before
            generating picks.
          </>
        }
      />

      <OddsFetch configured={hasKey("ODDS_API_KEY")} />

      <div className="grid gap-4 lg:grid-cols-2">
        <CSVUpload />
        <ManualPropForm />
      </div>

      <ResearchLab props={props} />
    </div>
  );
}
