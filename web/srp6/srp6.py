"""
AzerothCore SRP6 credential generation - Python reference implementation.

AzerothCore does NOT store a password hash. The `account` table holds an SRP6
`salt` (32 bytes) and `verifier` (32 bytes). A website that registers accounts
or changes passwords must produce these itself.

    v = g ^ H(s || H(UPPER(u) || ':' || UPPER(p))) mod N

The two details that break most implementations:
  * the inner SHA1 digest is interpreted as a LITTLE-ENDIAN integer
  * the verifier is stored LITTLE-ENDIAN, zero-padded to 32 bytes

Verified byte-for-byte against AzerothCore's own Acore::Crypto::SRP6 at commit
e2f5e48b4375, in both directions - see docs/WEBSITE-DB.md.

Usage:
    from srp6 import make_registration_data, verify_password
    salt, verifier = make_registration_data("myuser", "mypass")
"""

import hashlib
import os

# AzerothCore's SRP6 group parameters (src/common/Cryptography/Authentication/SRP6.cpp)
N = int("894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7", 16)
G = 7

SALT_LENGTH = 32
VERIFIER_LENGTH = 32


def calculate_verifier(username: str, password: str, salt: bytes) -> bytes:
    """Compute the SRP6 verifier for a known salt. Returns 32 little-endian bytes."""
    if len(salt) != SALT_LENGTH:
        raise ValueError(f"salt must be exactly {SALT_LENGTH} bytes, got {len(salt)}")

    # AzerothCore uppercases both before hashing (Utf8ToUpperOnlyLatin).
    u = username.upper().encode("utf-8")
    p = password.upper().encode("utf-8")

    inner = hashlib.sha1(u + b":" + p).digest()
    x_bytes = hashlib.sha1(salt + inner).digest()

    # little-endian is not a stylistic choice here; big-endian silently produces
    # a verifier the server will reject at login with no useful error.
    x = int.from_bytes(x_bytes, "little")

    return pow(G, x, N).to_bytes(VERIFIER_LENGTH, "little")


def make_registration_data(username: str, password: str):
    """Generate a fresh (salt, verifier) pair for a new account or password change."""
    salt = os.urandom(SALT_LENGTH)
    return salt, calculate_verifier(username, password, salt)


def verify_password(username: str, password: str, salt: bytes, verifier: bytes) -> bool:
    """Check a password against a stored salt/verifier. Constant-time comparison."""
    import hmac
    return hmac.compare_digest(calculate_verifier(username, password, salt), verifier)


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 3:
        print("usage: python3 srp6.py <username> <password>", file=sys.stderr)
        sys.exit(2)
    s, v = make_registration_data(sys.argv[1], sys.argv[2])
    print(f"salt={s.hex().upper()}")
    print(f"verifier={v.hex().upper()}")
