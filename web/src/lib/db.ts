import mysql, { type Pool, type RowDataPacket, type ResultSetHeader } from "mysql2/promise";
import { env, isDemo, safeIdentifier } from "./env";

/**
 * A single connection pool for the whole site.
 *
 * The pool deliberately has **no default database**. Every query names its
 * schema explicitly (`auth.account`, `chars.characters`), which lets one pool
 * serve the auth, characters, world and web schemas and lets the armory join
 * across them - for example, hiding characters whose account carries a GM
 * level, which lives in a different schema from the character row.
 *
 * That assumes the four schemas live on one MySQL server, which is how every
 * AzerothCore install is laid out. If they are ever split, this is the file
 * that changes.
 */

let pool: Pool | null = null;

export function getPool(): Pool {
  if (isDemo) {
    throw new Error("getPool() called while DATA_SOURCE=demo - no database is configured.");
  }
  if (!pool) {
    pool = mysql.createPool({
      host: env.db.host,
      port: env.db.port,
      user: env.db.user,
      password: env.db.password,
      waitForConnections: true,
      connectionLimit: env.db.connectionLimit,
      connectTimeout: env.db.connectTimeout,
      queueLimit: 0,
      charset: "utf8mb4_unicode_ci",
      // Character names are case-preserving; keep MySQL from coercing types.
      supportBigNumbers: true,
      bigNumberStrings: false,
      dateStrings: false,
      // The site never needs multiple statements in one call, and disallowing
      // them removes a whole class of injection escalation.
      multipleStatements: false,
    });
  }
  return pool;
}

/** Backtick-quote an identifier that has already been validated. */
export function ident(name: string): string {
  return "`" + safeIdentifier(name, "identifier") + "`";
}

/** Schema shorthands used throughout the query modules. */
export const schema = {
  auth: ident(env.db.auth),
  chars: ident(env.db.characters),
  world: ident(env.db.world),
  web: ident(env.db.web),
} as const;

/** Everything the query helpers will bind as a prepared-statement parameter. */
export type SqlParam = string | number | boolean | Buffer | Date | null;

export async function query<T extends RowDataPacket>(sql: string, params: SqlParam[] = []): Promise<T[]> {
  const [rows] = await getPool().execute<T[]>(sql, params);
  return rows;
}

export async function queryOne<T extends RowDataPacket>(sql: string, params: SqlParam[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params: SqlParam[] = []): Promise<ResultSetHeader> {
  const [result] = await getPool().execute<ResultSetHeader>(sql, params);
  return result;
}

/**
 * Run a read that must not take the page down with it.
 *
 * A realm that is mid-restart, a database that has not been created yet, or a
 * schema missing the classless tables are all *expected* states for this site.
 * They render as "unknown", not as a 500.
 */
export async function tryQuery<T extends RowDataPacket>(
  label: string,
  sql: string,
  params: SqlParam[] = [],
): Promise<T[] | null> {
  try {
    return await query<T>(sql, params);
  } catch (error) {
    console.warn(`[db] ${label} failed:`, error instanceof Error ? error.message : error);
    return null;
  }
}

interface CountRow extends RowDataPacket {
  n: number;
}

/**
 * Does a table exist?
 *
 * The classless system arrives in Phase 2, so the armory has to run against a
 * database that does not have `classless_*` yet. Probing once and caching the
 * answer keeps that check off the hot path.
 */
const tableCache = new Map<string, { value: boolean; at: number }>();
const TABLE_CACHE_MS = 60_000;

export async function tableExists(schemaName: string, tableName: string): Promise<boolean> {
  const key = `${schemaName}.${tableName}`;
  const cached = tableCache.get(key);
  const now = Date.now();
  if (cached && now - cached.at < TABLE_CACHE_MS) return cached.value;

  const rows = await tryQuery<CountRow>(
    `probe ${key}`,
    `SELECT COUNT(*) AS n FROM information_schema.tables
      WHERE table_schema = ? AND table_name = ?`,
    [schemaName, tableName],
  );
  const value = (rows?.[0]?.n ?? 0) > 0;
  tableCache.set(key, { value, at: now });
  return value;
}

/** True when every named table is present in the schema. */
export async function tablesExist(schemaName: string, tables: string[]): Promise<boolean> {
  const results = await Promise.all(tables.map((t) => tableExists(schemaName, t)));
  return results.every(Boolean);
}

/** Used by /api/health and `ta.py web doctor`. */
export async function pingDatabase(): Promise<{ ok: boolean; error?: string }> {
  if (isDemo) return { ok: true };
  try {
    const conn = await getPool().getConnection();
    try {
      await conn.ping();
      return { ok: true };
    } finally {
      conn.release();
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Which columns a table actually has.
 *
 * The classless tables are a Phase 2 deliverable and their exact column set is
 * still moving. The armory asks rather than assumes, so adding `name` or
 * `max_rank` to `classless_node` later lights up richer output here with no
 * change to this codebase - and their absence today costs nothing.
 */
const columnCache = new Map<string, { value: Set<string>; at: number }>();

interface ColumnRow extends RowDataPacket {
  COLUMN_NAME: string;
}

export async function columnsOf(schemaName: string, tableName: string): Promise<Set<string>> {
  const key = `${schemaName}.${tableName}`;
  const cached = columnCache.get(key);
  const now = Date.now();
  if (cached && now - cached.at < TABLE_CACHE_MS) return cached.value;

  const rows = await tryQuery<ColumnRow>(
    `columns ${key}`,
    `SELECT COLUMN_NAME FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ?`,
    [schemaName, tableName],
  );
  const value = new Set((rows ?? []).map((r) => r.COLUMN_NAME));
  columnCache.set(key, { value, at: now });
  return value;
}
