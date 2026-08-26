import { schema, type SqlParam } from "./db";
import { env } from "./env";

/**
 * Who the public side of the site is allowed to show.
 *
 * Staff characters are hidden everywhere - search, profiles, leaderboards and
 * the population count - so the rule is easy to state and impossible to work
 * around by looking at a different page. `ARMORY_HIDE_GM_LEVEL=0` turns it off
 * for a realm that would rather be fully transparent.
 *
 * account_access.RealmID is -1 for "every realm", so both cases are checked.
 */
export interface SqlFragment {
  sql: string;
  params: SqlParam[];
}

export function visibleCharacter(alias: string): SqlFragment {
  const clauses = [`${alias}.\`deleteDate\` IS NULL`];
  const params: SqlParam[] = [];

  if (env.armory.hideGmLevel > 0) {
    clauses.push(
      `NOT EXISTS (
         SELECT 1 FROM ${schema.auth}.\`account_access\` aa
          WHERE aa.id = ${alias}.\`account\`
            AND aa.gmlevel >= ?
            AND (aa.RealmID = -1 OR aa.RealmID = ?)
       )`,
    );
    params.push(env.armory.hideGmLevel, env.realm.id);
  }

  return { sql: clauses.join(" AND "), params };
}
