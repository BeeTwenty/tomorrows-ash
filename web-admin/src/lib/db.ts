import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { env, safeIdentifier } from "./env";

/**
 * The admin pool.
 *
 * It connects as `ash_admin`, a user with grants the public site's `ash_web`
 * does not have and must never be given - writes to `account_access`,
 * `account_banned`, `characters` and the classless tables. That separation is
 * the actual security boundary between the two services; running two Next.js
 * apps would buy little on its own.
 *
 * One grant is deliberately absent even here: the audit table is INSERT-only.
 * `ash_admin` cannot UPDATE or DELETE it, so a fully compromised panel can add
 * to the record but cannot edit it.
 */

let pool: Pool | null = null;

export function getPool(): Pool {
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
      supportBigNumbers: true,
      multipleStatements: false,
      // Every write here is a staff action against live player data. A
      // transaction that a caller forgot to commit must not leak through.
      dateStrings: false,
    });
  }
  return pool;
}

export function ident(name: string): string {
  return "`" + safeIdentifier(name, "identifier") + "`";
}

export const schema = {
  auth: ident(env.db.auth),
  chars: ident(env.db.characters),
  world: ident(env.db.world),
  admin: ident(env.db.admin),
} as const;

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
 * Run several statements as one unit.
 *
 * Staff actions frequently touch two rows that must agree - a ban row and the
 * account's online flag, a gmlevel change and the audit entry that explains it.
 * Anything that would leave the record disagreeing with reality goes in here.
 */
export async function transaction<T>(work: (run: {
  query: <R extends RowDataPacket>(sql: string, params?: SqlParam[]) => Promise<R[]>;
  execute: (sql: string, params?: SqlParam[]) => Promise<ResultSetHeader>;
}) => Promise<T>): Promise<T> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await work({
      query: async <R extends RowDataPacket>(sql: string, params: SqlParam[] = []) => {
        const [rows] = await connection.execute<R[]>(sql, params);
        return rows;
      },
      execute: async (sql: string, params: SqlParam[] = []) => {
        const [header] = await connection.execute<ResultSetHeader>(sql, params);
        return header;
      },
    });
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function pingDatabase(): Promise<{ ok: boolean; error?: string }> {
  try {
    const connection = await getPool().getConnection();
    try {
      await connection.ping();
      return { ok: true };
    } finally {
      connection.release();
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const tableCache = new Map<string, { value: boolean; at: number }>();
const TABLE_CACHE_MS = 60_000;

export async function tableExists(schemaName: string, tableName: string): Promise<boolean> {
  const key = `${schemaName}.${tableName}`;
  const cached = tableCache.get(key);
  const now = Date.now();
  if (cached && now - cached.at < TABLE_CACHE_MS) return cached.value;

  try {
    const rows = await query<RowDataPacket & { n: number }>(
      `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`,
      [schemaName, tableName],
    );
    const value = (rows[0]?.n ?? 0) > 0;
    tableCache.set(key, { value, at: now });
    return value;
  } catch {
    return false;
  }
}
