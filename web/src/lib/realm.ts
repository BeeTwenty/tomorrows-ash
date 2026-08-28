import net from "node:net";
import type { RowDataPacket } from "mysql2";
import { schema, tryQuery } from "./db";
import { env, isDemo } from "./env";
import { demoRealmStatus } from "./demo";
import { factionOf } from "./wow";
import { visibleCharacter } from "./visibility";
import type { RealmStatus } from "./types";

/**
 * Realm status, assembled from three independent sources so no single failure
 * makes the page useless:
 *
 *   1. TCP probes of the auth and world ports - "is anything listening?"
 *   2. acore_auth.uptime  - start time, current run length, session peak.
 *   3. acore_characters   - who is actually in the world right now.
 *
 * A realm mid-restart shows ports down but still reports its last known
 * population; a database outage shows ports up and says the rest is unknown.
 */

const PROBE_TIMEOUT_MS = 2_000;

function probeTcp(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

interface RaceCountRow extends RowDataPacket {
  race: number;
  n: number;
}

interface UptimeRow extends RowDataPacket {
  starttime: number;
  uptime: number;
  maxplayers: number;
  revision: string;
}

interface TotalRow extends RowDataPacket {
  n: number;
}

let cache: { value: RealmStatus; at: number } | null = null;

async function fetchStatus(): Promise<RealmStatus> {
  const visible = visibleCharacter("c");

  const [authOnline, worldOnline, onlineRows, uptimeRows, characterTotal, accountTotal] =
    await Promise.all([
      probeTcp(env.realm.authHost, env.realm.authPort),
      probeTcp(env.realm.worldHost, env.realm.worldPort),
      tryQuery<RaceCountRow>(
        "online population",
        `SELECT c.race AS race, COUNT(*) AS n
           FROM ${schema.chars}.\`characters\` c
          WHERE c.online = 1 AND ${visible.sql}
          GROUP BY c.race`,
        visible.params,
      ),
      tryQuery<UptimeRow>(
        "realm uptime",
        `SELECT starttime, uptime, maxplayers, revision
           FROM ${schema.auth}.\`uptime\`
          WHERE realmid = ?
          ORDER BY starttime DESC
          LIMIT 1`,
        [env.realm.id],
      ),
      tryQuery<TotalRow>(
        "character total",
        `SELECT COUNT(*) AS n FROM ${schema.chars}.\`characters\` c WHERE ${visible.sql}`,
        visible.params,
      ),
      tryQuery<TotalRow>(
        "account total",
        `SELECT COUNT(*) AS n FROM ${schema.auth}.\`account\``,
      ),
    ]);

  const databaseReachable = onlineRows !== null;

  let alliance = 0;
  let horde = 0;
  for (const row of onlineRows ?? []) {
    const faction = factionOf(row.race);
    if (faction === "alliance") alliance += row.n;
    else if (faction === "horde") horde += row.n;
  }

  const uptime = uptimeRows?.[0] ?? null;

  return {
    name: env.realm.name,
    online: worldOnline,
    authOnline,
    worldOnline,
    playersOnline: alliance + horde,
    alliance,
    horde,
    peakPlayers: uptime?.maxplayers ?? null,
    // The uptime row is only meaningful while that run is still going.
    uptimeSeconds: worldOnline && uptime ? uptime.uptime : null,
    startedAt: uptime ? new Date(uptime.starttime * 1000) : null,
    revision: uptime?.revision ?? null,
    charactersTotal: characterTotal?.[0]?.n ?? null,
    accountsTotal: accountTotal?.[0]?.n ?? null,
    address: env.realm.address,
    authPort: env.realm.authPort,
    worldPort: env.realm.worldPort,
    checkedAt: new Date(),
    degraded: databaseReachable ? null : "The realm database is not answering, so population and uptime are unknown.",
  };
}

/**
 * Cached for `REALM_STATUS_CACHE_SECONDS`. A busy landing page must not open a
 * TCP connection to the realm for every visitor.
 */
export async function getRealmStatus(): Promise<RealmStatus> {
  if (isDemo) return demoRealmStatus();

  const now = Date.now();
  if (cache && now - cache.at < env.realm.statusCacheSeconds * 1000) return cache.value;

  const value = await fetchStatus();
  cache = { value, at: now };
  return value;
}

/** Used by tests and by `ta.py web doctor` to bypass the cache. */
export async function getRealmStatusUncached(): Promise<RealmStatus> {
  return isDemo ? demoRealmStatus() : fetchStatus();
}
