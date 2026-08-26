/**
 * Configuration for the Tomorrow's Ash website.
 *
 * Every setting comes from the environment; nothing sensitive is ever written
 * into the repository. `web/.env.example` documents the full set.
 *
 * This module must never be imported from a Client Component - it reads
 * secrets. `assertServer()` turns a mistake into a loud crash instead of a
 * quiet credential leak in a browser bundle.
 */

function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "src/lib/env.ts was imported into client code. Configuration and " +
        "database credentials must stay on the server.",
    );
  }
}

assertServer();

const str = (key: string, fallback = ""): string => process.env[key]?.trim() || fallback;

const int = (key: string, fallback: number): number => {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (key: string, fallback: boolean): boolean => {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};

/**
 * Database and table names are interpolated into SQL - they cannot be bound as
 * parameters. Anything that reaches that path is validated here, at boot, so a
 * malformed schema name fails on startup rather than becoming an injection
 * vector at query time.
 */
export function safeIdentifier(value: string, what: string): string {
  if (!/^[A-Za-z0-9_$]{1,64}$/.test(value)) {
    throw new Error(
      `${what} must be a plain SQL identifier (letters, digits, _ or $, max 64 chars); got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const IS_BUILD = process.env.NEXT_PHASE === "phase-production-build";

const dbHost = str("DB_HOST");

export type DataSource = "live" | "demo";

/**
 * `auto` (the default) picks `live` when a database host is configured and
 * `demo` when it is not, so `npm run dev` works on a laptop with no realm
 * anywhere near it.
 */
function resolveDataSource(): DataSource {
  const requested = str("DATA_SOURCE", "auto").toLowerCase();
  if (requested === "live") return "live";
  if (requested === "demo") return "demo";
  return dbHost ? "live" : "demo";
}

export type MailTransport = "console" | "smtp" | "disabled";

function resolveMailTransport(): MailTransport {
  const raw = str("MAIL_TRANSPORT", "").toLowerCase();
  if (raw === "smtp") return "smtp";
  if (raw === "disabled") return "disabled";
  if (raw === "console") return "console";
  return str("SMTP_HOST") ? "smtp" : "console";
}

/**
 * Sessions are signed with HMAC-SHA256. In production an explicit secret is
 * mandatory: a generated per-process fallback would silently log everyone out
 * on every restart and differ between instances behind a load balancer.
 */
function resolveSessionSecret(): string {
  const secret = str("SESSION_SECRET");
  if (secret) {
    if (secret.length < 32) {
      throw new Error("SESSION_SECRET must be at least 32 characters. Run `npm run gen-secret`.");
    }
    return secret;
  }
  if (IS_PRODUCTION && !IS_BUILD) {
    throw new Error(
      "SESSION_SECRET is required in production. Generate one with `npm run gen-secret` " +
        "and put it in web/.env.local (or the service environment).",
    );
  }
  return "development-only-insecure-session-secret-do-not-ship";
}

const siteUrl = str("SITE_URL", "http://localhost:3000").replace(/\/+$/, "");

export const env = {
  isProduction: IS_PRODUCTION,
  siteUrl,
  /** Cookies get the Secure attribute (and __Host- prefix) only over HTTPS. */
  secureCookies: siteUrl.startsWith("https://"),
  dataSource: resolveDataSource(),

  realm: {
    id: int("REALM_ID", 1),
    name: str("REALM_NAME", "Ashmorrow"),
    /** What players type into realmlist.wtf. */
    address: str("REALM_ADDRESS", "127.0.0.1"),
    authHost: str("REALM_AUTH_HOST", str("REALM_ADDRESS", "127.0.0.1")),
    authPort: int("REALM_AUTH_PORT", 3724),
    worldHost: str("REALM_WORLD_HOST", str("REALM_ADDRESS", "127.0.0.1")),
    worldPort: int("REALM_WORLD_PORT", 8085),
    /** Cache TTL for status probes, in seconds. Keeps the realm unbothered. */
    statusCacheSeconds: int("REALM_STATUS_CACHE_SECONDS", 30),
  },

  db: {
    host: dbHost,
    port: int("DB_PORT", 3306),
    user: str("DB_USER", "ash_web"),
    password: process.env.DB_PASSWORD ?? "",
    connectionLimit: int("DB_CONNECTION_LIMIT", 8),
    connectTimeout: int("DB_CONNECT_TIMEOUT_MS", 8000),
    auth: safeIdentifier(str("DB_AUTH", "acore_auth"), "DB_AUTH"),
    characters: safeIdentifier(str("DB_CHARACTERS", "acore_characters"), "DB_CHARACTERS"),
    world: safeIdentifier(str("DB_WORLD", "acore_world"), "DB_WORLD"),
    /** Our own schema. Never mixed into AzerothCore's tables. */
    web: safeIdentifier(str("DB_WEB", "ashmorrow_web"), "DB_WEB"),
  },

  accounts: {
    registrationEnabled: bool("REGISTRATION_ENABLED", true),
    /** account.expansion: 0 classic, 1 TBC, 2 WotLK. */
    expansion: int("REGISTRATION_EXPANSION", 2),
    /** "sql" writes SRP6 directly; "soap" delegates to the worldserver console. */
    writeMode: str("ACCOUNT_WRITE_MODE", "sql").toLowerCase() === "soap" ? "soap" : "sql",
    /** One account per email address, so password reset can never be ambiguous. */
    uniqueEmail: bool("ACCOUNT_UNIQUE_EMAIL", true),
    resetTokenMinutes: int("PASSWORD_RESET_MINUTES", 30),
  },

  soap: {
    enabled: bool("SOAP_ENABLED", false),
    host: str("SOAP_HOST", str("REALM_WORLD_HOST", "127.0.0.1")),
    port: int("SOAP_PORT", 7878),
    user: str("SOAP_USER"),
    password: process.env.SOAP_PASSWORD ?? "",
    timeoutMs: int("SOAP_TIMEOUT_MS", 5000),
  },

  mail: {
    transport: resolveMailTransport(),
    from: str("MAIL_FROM", "Ashmorrow <no-reply@localhost>"),
    smtp: {
      host: str("SMTP_HOST"),
      port: int("SMTP_PORT", 587),
      secure: bool("SMTP_SECURE", false),
      user: str("SMTP_USER"),
      password: process.env.SMTP_PASSWORD ?? "",
    },
  },

  security: {
    sessionSecret: resolveSessionSecret(),
    sessionDays: int("SESSION_DAYS", 14),
    /**
     * Only enable behind a reverse proxy you control. When off, the socket
     * address is used and a forged X-Forwarded-For cannot dodge rate limits.
     */
    trustProxy: bool("TRUST_PROXY", false),
    rateLimitDriver: str("RATE_LIMIT_DRIVER", "memory").toLowerCase() === "mysql" ? "mysql" : "memory",
  },

  armory: {
    /**
     * Characters belonging to accounts with account_access.gmlevel >= this are
     * hidden from search, profiles and leaderboards. 1 hides all staff.
     */
    hideGmLevel: int("ARMORY_HIDE_GM_LEVEL", 1),
    minLevelForLeaderboards: int("LEADERBOARD_MIN_LEVEL", 10),
    cacheSeconds: int("ARMORY_CACHE_SECONDS", 60),
  },
} as const;

export const isDemo = env.dataSource === "demo";
