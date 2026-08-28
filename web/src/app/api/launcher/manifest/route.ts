import { NextResponse } from "next/server";
import { getLauncherManifest } from "@/lib/launcher";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * What the launcher needs to know about this realm.
 *
 * Public and unauthenticated: it is the realm address, a client build number,
 * and a list of file hashes. Hashes are facts about files the player already
 * has, and there is nothing here anyone could use to obtain a client.
 */
export async function GET() {
  const manifest = await getLauncherManifest();

  return NextResponse.json(manifest, {
    headers: {
      "Cache-Control": `public, max-age=${env.realm.statusCacheSeconds}, stale-while-revalidate=300`,
    },
  });
}
