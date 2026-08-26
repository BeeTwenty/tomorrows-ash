import { NextResponse } from "next/server";
import { getRealmStatus } from "@/lib/realm";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Public realm status as JSON.
 *
 * The header's heartbeat uses it, and so can a Discord bot or an uptime
 * monitor. It exposes only what the status page already shows - no account
 * data, no addresses beyond the realm's own advertised one.
 */
export async function GET() {
  const status = await getRealmStatus();

  return NextResponse.json(
    {
      realm: status.name,
      online: status.online,
      authOnline: status.authOnline,
      worldOnline: status.worldOnline,
      playersOnline: status.playersOnline,
      alliance: status.alliance,
      horde: status.horde,
      peakPlayers: status.peakPlayers,
      uptimeSeconds: status.uptimeSeconds,
      startedAt: status.startedAt?.toISOString() ?? null,
      charactersTotal: status.charactersTotal,
      accountsTotal: status.accountsTotal,
      address: status.address,
      checkedAt: status.checkedAt.toISOString(),
      degraded: status.degraded,
    },
    {
      headers: {
        "Cache-Control": `public, max-age=${env.realm.statusCacheSeconds}, stale-while-revalidate=60`,
      },
    },
  );
}
