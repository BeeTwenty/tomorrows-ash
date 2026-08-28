import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticate } from "@/lib/accounts";
import { getAccountCharacters } from "@/lib/armory";
import { consumeAll, RATE_RULES, rateLimitMessage } from "@/lib/rate-limit";
import { clientAddress } from "@/lib/request";
import { encodeSession } from "@/lib/session";
import { validateUsername } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * Sign a player in from the launcher.
 *
 * This is the *website's* account system, which happens to be the same
 * `acore_auth.account` rows the login server reads. It does not and cannot log
 * anyone into the game: the client performs its own SRP6 handshake, and there
 * is no supported way to hand it a password. What the launcher gets from this
 * is the ability to show whose account it is, how many characters are on it,
 * and to pre-fill the *name* on the game's login screen.
 *
 * Rate limited on the same two buckets as the website's own form, because it
 * is the same credential check and an attacker would otherwise simply use
 * whichever door was cheaper.
 */
export async function POST(request: NextRequest) {
  const address = await clientAddress();

  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }

  // Uppercased by the same rule the realm uses, so the rate-limit bucket and
  // the database lookup agree about who is being attacked.
  const name = validateUsername(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  if (!name.ok || !password) {
    return NextResponse.json(
      { error: name.ok ? "Enter your password." : name.error },
      { status: 400 },
    );
  }
  const username = name.value;

  const limit = await consumeAll([
    { key: `launcher-login:${address}`, rule: RATE_RULES.login },
    { key: `launcher-login-id:${username}`, rule: RATE_RULES.loginIdentity },
  ]);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: rateLimitMessage(limit) },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const result = await authenticate({ username, password, address });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }

  // Short-lived by design. The launcher holds it in memory and in the OS
  // keyring, never on disk in its own settings.
  const expires = Math.floor(Date.now() / 1000) + 12 * 3600;
  const token = encodeSession({
    aid: result.value.id,
    u: result.value.username,
    fp: result.value.fingerprint,
    exp: expires,
  });

  const characters = await getAccountCharacters(result.value.id);

  return NextResponse.json(
    { username: result.value.username, characters: characters.length, token },
    { headers: { "Cache-Control": "no-store" } },
  );
}
