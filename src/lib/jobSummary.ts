/**
 * Research jobs print their headline numbers as one machine-readable line each,
 * `@@SUMMARY <name> <json>`, beside the human-readable report, so
 * research:weekly can summarise exactly what the full logs say.
 */
const PREFIX = "@@SUMMARY ";

export function emitSummary(name: string, data: unknown): void {
  console.log(`${PREFIX}${name} ${JSON.stringify(data)}`);
}

/** Every summary line in a job's output, by name; a later line of the same name wins. */
export function parseSummaries(output: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const line of output.split("\n")) {
    if (!line.startsWith(PREFIX)) continue;
    const rest = line.slice(PREFIX.length);
    const space = rest.indexOf(" ");
    if (space <= 0) continue;
    try {
      out.set(rest.slice(0, space), JSON.parse(rest.slice(space + 1)));
    } catch {
      // a malformed line is skipped, never fatal
    }
  }
  return out;
}
