import { SettingsForm } from "@/components/SettingsForm";
import { getSettings } from "@/lib/settings";
import { getProviderStatuses } from "@/lib/providers/config";
import { getAvoidList } from "@/lib/queries";
import { PageHeader } from "@/components/common";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, avoidList] = await Promise.all([getSettings(), getAvoidList()]);
  const providers = getProviderStatuses();

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Configuration"
        title="Settings"
        description={
          <>
            Configure stakes, sports, data sources and your avoid list. Not financial advice.
          </>
        }
      />
      <SettingsForm settings={settings} providers={providers} avoidList={avoidList} />
    </div>
  );
}
