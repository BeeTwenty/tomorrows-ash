/**
 * AzerothCore SRP6 credential generation - Node.js reference implementation.
 *
 * AzerothCore does NOT store a password hash. The `account` table holds an SRP6
 * `salt` (32 bytes) and `verifier` (32 bytes). A website that registers accounts
 * or changes passwords must produce these itself.
 *
 *     v = g ^ H(s || H(UPPER(u) || ':' || UPPER(p))) mod N
 *
 * The two details that break most implementations:
 *   - the inner SHA1 digest is interpreted as a LITTLE-ENDIAN integer
 *   - the verifier is stored LITTLE-ENDIAN, zero-padded to 32 bytes
 *
 * Verified byte-for-byte against AzerothCore's own Acore::Crypto::SRP6 at
 * commit e2f5e48b4375, in both directions - see docs/WEBSITE-DB.md.
 *
 * No dependencies: uses node:crypto and native BigInt.
 */

'use strict';

const crypto = require('node:crypto');

// AzerothCore's SRP6 group parameters.
const N = BigInt('0x894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7');
const G = 7n;

const SALT_LENGTH = 32;
const VERIFIER_LENGTH = 32;

function sha1(...buffers) {
  const h = crypto.createHash('sha1');
  for (const b of buffers) h.update(b);
  return h.digest();
}

/** Interpret a Buffer as a little-endian unsigned integer. */
function bufferToBigIntLE(buf) {
  let result = 0n;
  for (let i = buf.length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(buf[i]);
  }
  return result;
}

/** Serialise a BigInt as `length` little-endian bytes, zero-padded. */
function bigIntToBufferLE(value, length) {
  const out = Buffer.alloc(length);
  let v = value;
  for (let i = 0; i < length; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw new RangeError(`value does not fit in ${length} bytes`);
  return out;
}

/** Modular exponentiation. BigInt has no built-in modpow. */
function modPow(base, exponent, modulus) {
  if (modulus === 1n) return 0n;
  let result = 1n;
  base %= modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * base) % modulus;
    e >>= 1n;
    base = (base * base) % modulus;
  }
  return result;
}

/** Compute the SRP6 verifier for a known salt. Returns a 32-byte LE Buffer. */
function calculateVerifier(username, password, salt) {
  if (!Buffer.isBuffer(salt) || salt.length !== SALT_LENGTH) {
    throw new TypeError(`salt must be a ${SALT_LENGTH}-byte Buffer`);
  }
  // AzerothCore uppercases both before hashing (Utf8ToUpperOnlyLatin).
  const u = Buffer.from(username.toUpperCase(), 'utf8');
  const p = Buffer.from(password.toUpperCase(), 'utf8');

  const inner = sha1(u, Buffer.from(':'), p);
  const xBytes = sha1(salt, inner);

  // little-endian is not a stylistic choice: big-endian silently produces a
  // verifier the server rejects at login with no useful error.
  const x = bufferToBigIntLE(xBytes);

  return bigIntToBufferLE(modPow(G, x, N), VERIFIER_LENGTH);
}

/** Generate a fresh {salt, verifier} pair for a new account or password change. */
function makeRegistrationData(username, password) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  return { salt, verifier: calculateVerifier(username, password, salt) };
}

/** Check a password against a stored salt/verifier, in constant time. */
function verifyPassword(username, password, salt, verifier) {
  const expected = calculateVerifier(username, password, salt);
  return expected.length === verifier.length &&
         crypto.timingSafeEqual(expected, verifier);
}

module.exports = { calculateVerifier, makeRegistrationData, verifyPassword, N, G,
                   SALT_LENGTH, VERIFIER_LENGTH };

if (require.main === module) {
  const [, , username, password] = process.argv;
  if (!username || !password) {
    console.error('usage: node srp6.js <username> <password>');
    process.exit(2);
  }
  const { salt, verifier } = makeRegistrationData(username, password);
  console.log(`salt=${salt.toString('hex').toUpperCase()}`);
  console.log(`verifier=${verifier.toString('hex').toUpperCase()}`);
}
