#!/usr/bin/env bash
# Check every SRP6 implementation in this directory against the server-derived
# test vector. Runs only the languages actually installed.
#
#   ./selftest.sh
#
# A PASS means: accounts created with that implementation will authenticate
# against AzerothCore. A FAIL means they will silently fail at login.

set -u
cd "$(dirname "$0")"

USER=$(python3 -c 'import json;print(json.load(open("testvector.json"))["username"])' 2>/dev/null \
       || node -p 'require("./testvector.json").username')
PASS=$(python3 -c 'import json;print(json.load(open("testvector.json"))["password"])' 2>/dev/null \
       || node -p 'require("./testvector.json").password')
SALT=$(python3 -c 'import json;print(json.load(open("testvector.json"))["salt_hex"])' 2>/dev/null \
       || node -p 'require("./testvector.json").salt_hex')
WANT=$(python3 -c 'import json;print(json.load(open("testvector.json"))["verifier_hex"])' 2>/dev/null \
       || node -p 'require("./testvector.json").verifier_hex')

rc=0
report() { # name got
  if [ "$2" = "$WANT" ]; then
    printf '  \033[32mPASS\033[0m  %s\n' "$1"
  else
    printf '  \033[31mFAIL\033[0m  %s\n        expected %s\n        got      %s\n' "$1" "$WANT" "$2"
    rc=1
  fi
}

echo "SRP6 self-test against server-derived vector"
echo

if command -v python3 >/dev/null 2>&1; then
  got=$(python3 -c "
import sys; sys.path.insert(0,'.')
from srp6 import calculate_verifier
print(calculate_verifier('$USER','$PASS',bytes.fromhex('$SALT')).hex().upper())")
  report "python3  (srp6.py)" "$got"
else
  echo "  SKIP  python3 not installed"
fi

if command -v node >/dev/null 2>&1; then
  got=$(node -e "
const {calculateVerifier}=require('./srp6.js');
console.log(calculateVerifier('$USER','$PASS',Buffer.from('$SALT','hex')).toString('hex').toUpperCase());")
  report "node     (srp6.js)" "$got"
else
  echo "  SKIP  node not installed"
fi

if command -v php >/dev/null 2>&1; then
  if php -m 2>/dev/null | grep -qi '^gmp$'; then
    got=$(php -r "
require 'srp6.php';
echo strtoupper(bin2hex(\TomorrowsAsh\Srp6\calculateVerifier('$USER','$PASS',hex2bin('$SALT'))));")
    report "php      (srp6.php)" "$got"
  else
    echo "  SKIP  php present but ext-gmp missing (sudo apt install php-gmp)"
  fi
else
  echo "  SKIP  php not installed"
fi

echo
[ $rc -eq 0 ] && echo "All available implementations match the server." \
              || echo "At least one implementation does NOT match - do not use it."
exit $rc
