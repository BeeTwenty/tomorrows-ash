import { getAccountById, resolveSession, type AccountInfo } from "./accounts";
import { readSessionCookie } from "./session";

/**
 * The signed-in account, or null.
 *
 * Server Components cannot write cookies, so a session that no longer resolves
 * is simply treated as absent here; the next action the visitor takes clears
 * the stale cookie properly.
 */
export async function currentAccount(): Promise<AccountInfo | null> {
  const session = await readSessionCookie();
  if (!session) return null;
  return resolveSession(session.aid, session.fp);
}

export { getAccountById };
export type { AccountInfo };
