#!/usr/bin/env bash
# Tests of scripts/verify: the order of its steps and where it stops. Usage: verify.test.sh <case>
set -uo pipefail

cd "$(dirname "$0")/.."
log="$(mktemp)"
trap 'rm -f "$log"' EXIT

run() {
  : >"$log"
  env VERIFY_TYPES_CMD="${1}" VERIFY_TEST_CMD="${2}" VERIFY_VALIDATE_CMD="${3}" scripts/verify >/dev/null 2>&1
}

types_ok="echo types >>$log"
types_bad="echo types >>$log; exit 1"
test_ok="echo tests >>$log"
test_bad="echo tests >>$log; exit 1"
validate_ok="echo validate >>$log"

case "${1:-}" in
  order)
    run "$types_ok" "$test_ok" "$validate_ok" || { echo "fail: verify should pass when every step passes"; exit 1; }
    [ "$(tr '\n' ' ' <"$log")" = "types tests validate " ] || { echo "fail: steps ran as: $(tr '\n' ' ' <"$log")"; exit 1; }
    ;;
  fail-test)
    run "$types_ok" "$test_bad" "$validate_ok" && { echo "fail: verify should fail when a test fails"; exit 1; }
    grep -qx validate "$log" && { echo "fail: validate ran after a failing test"; exit 1; }
    ;;
  fail-types)
    run "$types_bad" "$test_ok" "$validate_ok" && { echo "fail: verify should fail on a type error"; exit 1; }
    grep -qx tests "$log" && { echo "fail: tests ran after a type error"; exit 1; }
    ;;
  all)
    for each in order fail-test fail-types; do
      "$0" "$each" || exit 1
    done
    exit 0
    ;;
  *)
    echo "usage: verify.test.sh order|fail-test|fail-types|all" >&2
    exit 2
    ;;
esac
echo "ok: $1"
