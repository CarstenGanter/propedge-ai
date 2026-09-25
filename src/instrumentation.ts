/**
 * Runs once when the Next.js server starts. Used to schedule the automatic
 * closing-line capture while the app is open — the Node-only work is imported
 * conditionally, as the instrumentation docs require.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
