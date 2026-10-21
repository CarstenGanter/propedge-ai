/**
 * Run a scheduler pass's steps one after another, each on its own: one
 * failing step is logged and the rest still run (pure apart from the steps).
 * The launchd pass used to chain capture, settle, injury watch and news
 * fetch on a single promise, so an exception in capture skipped settlement
 * and the rest of that pass.
 */
export interface StepResult {
  name: string;
  ok: boolean;
  line: string;
}

export async function runSteps(steps: [name: string, run: () => Promise<string>][], now: () => Date = () => new Date()): Promise<StepResult[]> {
  const out: StepResult[] = [];
  for (const [name, run] of steps) {
    try {
      out.push({ name, ok: true, line: await run() });
    } catch (e) {
      const detail = e instanceof Error ? e.stack ?? e.message : String(e);
      out.push({ name, ok: false, line: `[${now().toISOString()}] ${name} FAILED: ${detail}` });
    }
  }
  return out;
}
