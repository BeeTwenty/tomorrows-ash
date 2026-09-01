import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { env } from "./env";

/**
 * Sealed storage for the TOTP secrets.
 *
 * A second factor stored in plaintext is not a second factor against anyone who
 * can read the database - and "can read the database" covers a backup on a
 * laptop, a misconfigured replica, and an SQL injection that never touched the
 * filesystem. Sealing with a key that lives only in the panel's environment
 * means a dump on its own does not let anyone mint codes.
 *
 * AES-256-GCM, random 12-byte IV per secret, stored as `v1:iv:tag:ciphertext`
 * in base64url. GCM rather than CBC because a tampered ciphertext must fail
 * loudly rather than decrypt to something.
 *
 * The key comes from ADMIN_TOTP_KEY. In development it is derived from the
 * session secret so there is one less thing to set up; `configurationProblems()`
 * refuses that fallback in production, because rotating a session secret is
 * routine hygiene and it must not silently lock every administrator out of the
 * panel.
 */

const VERSION = "v1";
const IV_BYTES = 12;

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (!cachedKey) {
    const material = env.security.totpKey;
    cachedKey = Buffer.from(
      hkdfSync("sha256", Buffer.from(material, "utf8"), Buffer.from("ashmorrow-admin"), Buffer.from("totp-seal-v1"), 32),
    );
  }
  return cachedKey;
}

export function seal(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(":");
}

export function unseal(sealed: string): string | null {
  const [version, ivPart, tagPart, bodyPart] = sealed.split(":");
  if (version !== VERSION || !ivPart || !tagPart || !bodyPart) return null;

  try {
    const iv = Buffer.from(ivPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    const body = Buffer.from(bodyPart, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== 16) return null;

    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    // A wrong key or a tampered ciphertext both land here. Neither is
    // recoverable and neither should be distinguishable to a caller.
    return null;
  }
}
