/**
 * Boot-time refusals.
 *
 * Next calls this once per server process, before it serves anything. It is
 * where the panel gets to say "no" loudly instead of starting in a state where
 * a control the operator believes in is switched off.
 *
 * The check runs again inside the request guard, so a hot reload or a partial
 * restart cannot leave a process running with problems this pass reported.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configurationProblems, env } = await import("./lib/env");
  const problems = configurationProblems();

  if (problems.length > 0) {
    const message = [
      "",
      "  The Ashmorrow admin panel is misconfigured and will refuse every request:",
      "",
      ...problems.map((problem) => `    - ${problem}`),
      "",
      "  See web-admin/README.md. Nothing is served until these are fixed.",
      "",
    ].join("\n");

    // In production this is fatal. Starting a panel with a broken access
    // control and logging a warning about it is how an open admin panel ends
    // up on the internet for a week.
    if (env.isProduction) throw new Error(message);
    console.warn(message);
    return;
  }

  const scope = env.isPublic
    ? `public, ${env.access.allowlist.length} allowlist rule(s)`
    : "private (ADMIN_PUBLIC is not set)";
  console.info(`[admin] Ashmorrow panel ready - realm ${env.realm.name}, ${scope}.`);
}
