import { SettingsForm } from "@/components/SettingsForm";
import { getSettings } from "@/lib/settings";
import { getProviderStatuses } from "@/lib/providers/config";
import { getAvoidList } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, avoidList] = await Promise.all([getSettings(), getAvoidList()]);
  const providers = getProviderStatuses();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure stakes, sports, data sources and your avoid list. Not financial advice.
        </p>
      </div>
      <SettingsForm settings={settings} providers={providers} avoidList={avoidList} />
    </div>
  );
}
