import { parseAllowlist } from "./ip";

/**
 * Configuration for the admin panel.
 *
 * Two differences from the public site's equivalent, both deliberate:
 *
 *   - **There is no demo mode.** A panel that renders invented accounts is
 *     worse than no panel: every habit it teaches is wrong, and the first real
 *     deployment is the first time anything is exercised.
 *   - **It refuses to start when a control is missing** rather than starting
 *     without it. A public instance with no allowlist, or with no trustworthy
 *     way to determine a client address, is not a degraded panel - it is an
 *     open one.
 */

function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new Error("src/lib/env.ts reached client code. Admin configuration must stay on the server.");
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
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};

export function safeIdentifier(value: string, what: string): string {
  if (!/^[A-Za-z0-9_$]{1,64}$/.test(value)) {
    throw new Error(`${what} must be a plain SQL identifier; got ${JSON.stringify(value)}`);
  }
  return value;
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const IS_BUILD = process.env.NEXT_PHASE === "phase-production-build";

const siteUrl = str("ADMIN_SITE_URL", "http://127.0.0.1:3010").replace(/\/+$/, "");
const allowlist = parseAllowlist(str("ADMIN_IP_ALLOWLIST"));
const trustedProxyHops = int("ADMIN_TRUSTED_PROXY_HOPS", 0);

/**
 * "Public" means reachable from somewhere we do not control. It is declared,
 * not guessed: an operator who binds to 0.0.0.0 behind a router still has to
 * say so, because the checks below are the ones that matter and they should
 * not switch themselves off because a hostname looked local.
 */
const isPublic = bool("ADMIN_PUBLIC", false);

function resolveSessionSecret(): string {
  const secret = str("ADMIN_SESSION_SECRET");
  if (secret) {
    if (secret.length < 32) {
      throw new Error("ADMIN_SESSION_SECRET must be at least 32 characters. Run `npm run gen-secret`.");
    }
    return secret;
  }
  if (IS_PRODUCTION && !IS_BUILD) {
    throw new Error("ADMIN_SESSION_SECRET is required. Run `npm run gen-secret`.");
  }
  return "development-only-admin-secret-never-use-this-anywhere";
}

export const env = {
  isProduction: IS_PRODUCTION,
  siteUrl,
  secureCookies: siteUrl.startsWith("https://"),
  isPublic,

  realm: {
    id: int("REALM_ID", 1),
    name: str("REALM_NAME", "Ashmorrow"),
  },

  db: {
    host: str("DB_HOST", "127.0.0.1"),
    port: int("DB_PORT", 3306),
    user: str("DB_USER", "ash_admin"),
    password: process.env.DB_PASSWORD ?? "",
    connectionLimit: int("DB_CONNECTION_LIMIT", 4),
    connectTimeout: int("DB_CONNECT_TIMEOUT_MS", 8000),
    auth: safeIdentifier(str("DB_AUTH", "acore_auth"), "DB_AUTH"),
    characters: safeIdentifier(str("DB_CHARACTERS", "acore_characters"), "DB_CHARACTERS"),
    world: safeIdentifier(str("DB_WORLD", "acore_world"), "DB_WORLD"),
    /** The panel's own schema. Separate from the public site's ashmorrow_web. */
    admin: safeIdentifier(str("DB_ADMIN", "ashmorrow_admin"), "DB_ADMIN"),
  },

  access: {
    allowlist,
    trustedProxyHops,
    realIpHeader: str("ADMIN_REAL_IP_HEADER").toLowerCase() || null,
    /** Absolute lifetime of a session, however active it is. */
    sessionHours: int("ADMIN_SESSION_HOURS", 8),
    /** Inactivity after which a session stops working. */
    idleMinutes: int("ADMIN_SESSION_IDLE_MINUTES", 30),
    /** Failed sign-ins per address before the address is refused for a while. */
    loginAttempts: int("ADMIN_LOGIN_ATTEMPTS", 5),
    loginWindowMinutes: int("ADMIN_LOGIN_WINDOW_MINUTES", 15),
  },

  soap: {
    enabled: bool("SOAP_ENABLED", false),
    host: str("SOAP_HOST", "127.0.0.1"),
    port: int("SOAP_PORT", 7878),
    user: str("SOAP_USER"),
    password: process.env.SOAP_PASSWORD ?? "",
    timeoutMs: int("SOAP_TIMEOUT_MS", 8000),
  },

  security: {
    sessionSecret: resolveSessionSecret(),
    /**
     * Seals the stored TOTP secrets. Separate from the session secret on
     * purpose: rotating a session secret should sign everyone out, not lock
     * everyone out.
     */
    totpKey: str("ADMIN_TOTP_KEY") || resolveSessionSecret(),
    totpKeyIsDerived: !str("ADMIN_TOTP_KEY"),
  },
} as const;

/**
 * The refusals. Called from instrumentation at startup and re-asserted by the
 * request guard, so a misconfiguration cannot be papered over by a hot reload.
 */
export function configurationProblems(): string[] {
  const problems: string[] = [];

  if (!env.db.host) problems.push("DB_HOST is not set. The admin panel has no demo mode.");
  if (!env.db.password && env.isProduction) {
    problems.push("DB_PASSWORD is empty. The admin database user must have a password.");
  }

  if (env.isPublic) {
    if (env.access.allowlist.length === 0) {
      problems.push(
        "ADMIN_PUBLIC=1 with an empty ADMIN_IP_ALLOWLIST. A publicly reachable admin panel " +
          "must name the addresses allowed to reach it.",
      );
    }
    if (env.access.trustedProxyHops < 1 && !env.access.realIpHeader) {
      problems.push(
        "ADMIN_PUBLIC=1 but no trusted proxy is configured. Set ADMIN_TRUSTED_PROXY_HOPS to the " +
          "number of proxies you operate (usually 1), or ADMIN_REAL_IP_HEADER to a header your " +
          "proxy overwrites. Without one, no client address can be trusted and every request " +
          "will be refused.",
      );
    }
    if (!env.secureCookies) {
      problems.push("ADMIN_PUBLIC=1 but ADMIN_SITE_URL is not https. Session cookies would not be Secure.");
    }
  }

  if (env.isProduction && env.security.totpKeyIsDerived) {
    problems.push(
      "ADMIN_TOTP_KEY is not set, so TOTP secrets would be sealed with the session secret. " +
        "Rotating ADMIN_SESSION_SECRET would then lock every administrator out of the panel. " +
        "Run `npm run gen-secret` and set ADMIN_TOTP_KEY.",
    );
  }

  if (env.access.sessionHours < 1 || env.access.sessionHours > 24) {
    problems.push("ADMIN_SESSION_HOURS should be between 1 and 24.");
  }

  return problems;
}
