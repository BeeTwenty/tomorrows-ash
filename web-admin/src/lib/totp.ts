import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238) over HMAC-SHA1, which is what every authenticator app
 * implements. About forty lines of arithmetic, so it needs no dependency - and
 * a dependency is exactly what you least want in the authentication path of the
 * highest-privilege surface in the project.
 *
 * The second factor exists because the first one is a *game* password: capped
 * at sixteen characters, case-insensitive, and typed into a game client on
 * whatever machine the operator happens to be at. That is a reasonable
 * credential for a player and an insufficient one for an account that can ban
 * people and rewrite the realm's configuration.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;

/** How many steps either side of now are accepted, for clock drift. */
const DRIFT_STEPS = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export function base32Encode(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer | null {
  const cleaned = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  if (!cleaned || /[^A-Z2-7]/.test(cleaned)) return null;

  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of cleaned) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function currentStep(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / STEP_SECONDS);
}

/** The six-digit code for one time step. */
export function codeForStep(secret: string, step: number): string | null {
  const key = base32Decode(secret);
  if (!key || key.length === 0) return null;

  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));

  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

export interface VerifyResult {
  ok: boolean;
  /** The step the code belonged to, so the caller can refuse to accept it twice. */
  step: number | null;
  reason?: string;
}

/**
 * Check a code, and say which time step it came from.
 *
 * The caller must persist that step and reject anything at or below it for the
 * same account. Without that, a code shouted over someone's shoulder stays
 * usable for its whole window - and the window is deliberately wider than one
 * step to tolerate clock drift.
 */
export function verifyCode(
  secret: string,
  code: string,
  options: { atMs?: number; lastUsedStep?: number | null } = {},
): VerifyResult {
  const cleaned = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return { ok: false, step: null, reason: "malformed code" };

  const now = currentStep(options.atMs ?? Date.now());

  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift += 1) {
    const step = now + drift;
    const expected = codeForStep(secret, step);
    if (!expected) return { ok: false, step: null, reason: "unusable secret" };

    // Constant-time: never let response timing say how much of a code matched.
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(cleaned))) {
      if (options.lastUsedStep !== null && options.lastUsedStep !== undefined && step <= options.lastUsedStep) {
        return { ok: false, step, reason: "code already used" };
      }
      return { ok: true, step };
    }
  }

  return { ok: false, step: null, reason: "incorrect code" };
}

/** The otpauth:// URI an authenticator app scans. */
export function enrolmentUri(secret: string, account: string, issuer = "Ashmorrow Admin"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

/* ------------------------------------------------------------------ *
 * Recovery codes
 *
 * Losing the authenticator must not lock the owner out of their own realm.
 * Only the hash is stored, and each code works once.
 * ------------------------------------------------------------------ */

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString("hex").toUpperCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
  });
}

export function normaliseRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}
