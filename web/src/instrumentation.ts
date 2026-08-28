/**
 * Startup checks.
 *
 * Next.js calls `register()` once when the server boots. Validating the
 * configuration here turns a misconfigured deployment into one clear message
 * at startup instead of an unexplained 500 on every page - and refuses to
 * serve at all rather than serving insecurely.
 */
export async function register(): Promise<void> {
  // `next build` imports this file too; there is nothing to check at build time.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const problems: string[] = [];
  const isProduction = process.env.NODE_ENV === "production";
  const secret = process.env.SESSION_SECRET?.trim() ?? "";

  if (isProduction && !secret) {
    problems.push("SESSION_SECRET is not set. Generate one with `npm run gen-secret`.");
  } else if (secret && secret.length < 32) {
    problems.push("SESSION_SECRET is shorter than 32 characters.");
  }

  const host = process.env.DB_HOST?.trim() ?? "";
  const source = (process.env.DATA_SOURCE?.trim() || "auto").toLowerCase();
  if (source === "live" && !host) {
    problems.push("DATA_SOURCE=live but DB_HOST is empty - there is no realm database to read.");
  }
  if (isProduction && !host && source !== "demo") {
    problems.push(
      "No DB_HOST is configured, so the site would run on demo data in production. " +
        "Set DB_HOST, or set DATA_SOURCE=demo to say you meant it.",
    );
  }

  const siteUrl = process.env.SITE_URL?.trim() ?? "";
  if (isProduction && !siteUrl) {
    problems.push("SITE_URL is not set. Password reset links need the site's public address.");
  }

  if (problems.length > 0) {
    console.error("\nTomorrow's Ash website: configuration is not usable.\n");
    for (const problem of problems) console.error(`  · ${problem}`);
    console.error("\nSee web/.env.example and SETUP.md section 9.\n");
    if (isProduction) process.exit(1);
    console.error("Continuing anyway because this is a development server.\n");
    return;
  }

  const mode = host ? `live (${host})` : "demo";
  console.info(`Tomorrow's Ash website ready · data source: ${mode}`);
}
