import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveSession } from "@/lib/accounts";
import { getAccountCharacters } from "@/lib/armory";
import { decodeSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Who the launcher is signed in as, and what is on the account.
 *
 * The bearer token is the same signed payload the website's cookie carries, so
 * changing a password invalidates a launcher session exactly as it invalidates
 * a browser one — `resolveSession` re-checks the verifier fingerprint against
 * the database on every call.
 */
export async function GET(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";

  const payload = decodeSession(token);
  if (!payload) {
    return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  }

  const account = await resolveSession(payload.aid, payload.fp);
  if (!account) {
    return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  }

  const characters = await getAccountCharacters(account.id);

  return NextResponse.json(
    {
      username: account.username,
      characters: characters.length,
      online: account.online,
      locked: account.locked,
      names: characters.map((character) => character.name),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
