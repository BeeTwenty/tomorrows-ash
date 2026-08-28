<?php
/**
 * AzerothCore SRP6 credential generation - PHP reference implementation.
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
 * Requires ext-gmp (Debian/Ubuntu: `sudo apt install php-gmp`).
 */

declare(strict_types=1);

namespace TomorrowsAsh\Srp6;

const SRP6_N_HEX = '894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7';
const SRP6_G = 7;
const SALT_LENGTH = 32;
const VERIFIER_LENGTH = 32;

/** Compute the SRP6 verifier for a known salt. Returns 32 little-endian raw bytes. */
function calculateVerifier(string $username, string $password, string $salt): string
{
    if (strlen($salt) !== SALT_LENGTH) {
        throw new \InvalidArgumentException('salt must be exactly ' . SALT_LENGTH . ' bytes');
    }

    // AzerothCore uppercases both before hashing (Utf8ToUpperOnlyLatin).
    $u = strtoupper($username);
    $p = strtoupper($password);

    $inner  = sha1($u . ':' . $p, true);
    $xBytes = sha1($salt . $inner, true);

    // little-endian is not a stylistic choice: big-endian silently produces a
    // verifier the server rejects at login with no useful error.
    $x = \gmp_import($xBytes, 1, GMP_LSW_FIRST | GMP_LITTLE_ENDIAN);

    $v = \gmp_powm(\gmp_init(SRP6_G), $x, \gmp_init(SRP6_N_HEX, 16));

    $raw = \gmp_export($v, 1, GMP_LSW_FIRST | GMP_LITTLE_ENDIAN);
    return str_pad($raw, VERIFIER_LENGTH, "\0", STR_PAD_RIGHT); // pad on the high end
}

/** Generate a fresh [salt, verifier] pair for a new account or password change. */
function makeRegistrationData(string $username, string $password): array
{
    $salt = random_bytes(SALT_LENGTH);
    return [$salt, calculateVerifier($username, $password, $salt)];
}

/** Check a password against a stored salt/verifier, in constant time. */
function verifyPassword(string $username, string $password, string $salt, string $verifier): bool
{
    return hash_equals(calculateVerifier($username, $password, $salt), $verifier);
}

// CLI usage: php srp6.php <username> <password>
if (PHP_SAPI === 'cli' && isset($argv) && realpath($argv[0]) === realpath(__FILE__)) {
    if ($argc !== 3) {
        fwrite(STDERR, "usage: php srp6.php <username> <password>\n");
        exit(2);
    }
    [$salt, $verifier] = makeRegistrationData($argv[1], $argv[2]);
    echo 'salt=' . strtoupper(bin2hex($salt)) . "\n";
    echo 'verifier=' . strtoupper(bin2hex($verifier)) . "\n";
}
