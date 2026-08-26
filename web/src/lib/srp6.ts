import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { MAX_PASSWORD_LENGTH, MAX_USERNAME_LENGTH, upperLatin } from "./limits";

/**
 * SRP6 registration data, exactly as AzerothCore computes it.
 *
 * Ported from the pinned upstream commit (see `upstream.json`):
 *   src/common/Cryptography/Authentication/SRP6.cpp
 *   src/server/game/Accounts/AccountMgr.cpp   (CreateAccount)
 *
 * The algorithm is `v = g ^ H(s || H(USERNAME || ':' || PASSWORD)) mod N`, and
 * the two things that are easy to get wrong are both about *byte order*:
 *
 *   - `SRP6::N` is built with `HexStrToByteArray<32>(..., /*reverse=*_/ true)`
 *     and then read back through `BigNumber(std::array, littleEndian = true)`,
 *     so the modulus is the integer the hex string spells out.
 *   - The SHA1 digest is fed to `BigNumber` with the same little-endian
 *     default, and `ToByteArray<32>()` writes little-endian too. So the
 *     exponent is the digest read **little-endian**, and the verifier is
 *     stored **little-endian** in `account.verifier`.
 *
 * Get either backwards and registration silently produces accounts that the
 * game client can never log into. `npm test` covers the round trip, and
 * `ta.py web verify-srp6` checks this implementation against a row the *core
 * itself* wrote, which is the only test that truly settles it.
 */

/** The WoW SRP6 modulus - shared by every 1.12/2.4.3/3.3.5 auth server. */
const N = BigInt("0x894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7");
const G = 7n;

export const SALT_LENGTH = 32;
export const VERIFIER_LENGTH = 32;

/**
 * Re-exported so callers can reach the whole SRP6 contract from one module.
 * They live in ./limits because the browser needs them and cannot load
 * `node:crypto`.
 */
export { MAX_PASSWORD_LENGTH, MAX_USERNAME_LENGTH, upperLatin };

function sha1(...parts: Array<Buffer | string>): Buffer {
  const hash = createHash("sha1");
  for (const part of parts) hash.update(typeof part === "string" ? Buffer.from(part, "utf8") : part);
  return hash.digest();
}

function bytesToBigIntLE(bytes: Buffer): bigint {
  const hex = Buffer.from(bytes).reverse().toString("hex");
  return hex.length ? BigInt("0x" + hex) : 0n;
}

function bigIntToBytesLE(value: bigint, length: number): Buffer {
  let hex = value.toString(16);
  if (hex.length % 2 === 1) hex = "0" + hex;
  const bigEndian = Buffer.from(hex, "hex");
  const out = Buffer.alloc(length);
  for (let i = 0; i < bigEndian.length && i < length; i += 1) {
    out[i] = bigEndian[bigEndian.length - 1 - i]!;
  }
  return out;
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

/**
 * Compute the verifier for a username/password/salt triple.
 *
 * `username` and `password` are uppercased here so callers cannot forget - the
 * core does the same in `AccountMgr::CreateAccount` before ever touching SRP6.
 */
export function calculateVerifier(username: string, password: string, salt: Buffer): Buffer {
  if (salt.length !== SALT_LENGTH) {
    throw new Error(`SRP6 salt must be ${SALT_LENGTH} bytes, got ${salt.length}`);
  }
  const identityHash = sha1(`${upperLatin(username)}:${upperLatin(password)}`);
  const exponent = bytesToBigIntLE(sha1(salt, identityHash));
  return bigIntToBytesLE(modPow(G, exponent, N), VERIFIER_LENGTH);
}

export interface RegistrationData {
  salt: Buffer;
  verifier: Buffer;
}

/** Equivalent of `SRP6::MakeRegistrationData`. */
export function makeRegistrationData(username: string, password: string): RegistrationData {
  const salt = randomBytes(SALT_LENGTH);
  return { salt, verifier: calculateVerifier(username, password, salt) };
}

/** Equivalent of `SRP6::CheckLogin`, in constant time. */
export function verifyPassword(
  username: string,
  password: string,
  salt: Buffer,
  verifier: Buffer,
): boolean {
  if (salt.length !== SALT_LENGTH || verifier.length !== VERIFIER_LENGTH) return false;
  const candidate = calculateVerifier(username, password, salt);
  return timingSafeEqual(candidate, verifier);
}
