import { NextResponse } from "next/server";
import { pingDatabase } from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Liveness and readiness for a deployment, not a public dashboard.
 *
 * It reports whether the process is up and whether the database answers -
 * deliberately without the error text, which can name hosts and users.
 */
export async function GET() {
  const database = await pingDatabase();
  const ok = database.ok;

  return NextResponse.json(
    {
      ok,
      dataSource: env.dataSource,
      database: database.ok ? "up" : "down",
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
