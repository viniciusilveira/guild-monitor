#!/usr/bin/env bash
# Tests of scripts/verify: the order of its steps and where it stops. Usage: verify.test.sh <case>
set -uo pipefail

cd "$(dirname "$0")/.."
log="$(mktemp)"
trap 'rm -f "$log"' EXIT

run() {
  : >"$log"
  env -u VERIFY_SKIP_TYPES VERIFY_TYPES_CMD="${1}" VERIFY_TEST_CMD="${2}" VERIFY_VALIDATE_CMD="${3}" scripts/verify >/dev/null 2>&1
}

types_ok="echo types >>$log"
types_bad="echo types >>$log; exit 1"
test_ok="echo tests >>$log"
test_bad="echo tests >>$log; exit 1"
validate_ok="echo validate >>$log"

# Color literals in production modules of the directory $1 (the schemes' file and the class colors excepted).
stray_colors() {
  local file
  for file in "$1"/*.ts "$1"/*.tsx; do
    case "$file" in
      *.test.ts | */sprites.generated.ts | */schemes.ts) continue ;;
    esac
    grep -nE "#[0-9A-Fa-f]{3,8}\b|rgba?\(|[cC]olor=\"|[cC]olor=\{[^}]*['\"]|[cC]olor: *['\"]" "$file" | grep -v 'export const COLORS' | sed "s|^|$file:|"
  done
}

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
  colors)
    found="$(stray_colors hooks)"
    [ -z "$found" ] || { echo "fail: literal colors outside hooks/schemes.ts:"; echo "$found"; exit 1; }
    ;;
  colors-catches)
    dir="$(mktemp -d)"
    trap 'rm -rf "$dir"' EXIT
    printf '%s\n' 'export const A = "#123abc"' >"$dir/hex.ts"
    printf '%s\n' 'const t = <Text color="red">x</Text>' >"$dir/prop.tsx"
    printf '%s\n' "const t = <Text color={'red'}>x</Text>" >"$dir/braces.tsx"
    printf '%s\n' "const t = { color: 'blue' }" >"$dir/object.ts"
    printf '%s\n' "const t = <Text color={ok ? '#fff' : 'red'}>x</Text>" >"$dir/ternary.tsx"
    printf '%s\n' "const c = '#fff'" >"$dir/short.ts"
    printf '%s\n' "const c = rgb(1, 2, 3)" >"$dir/rgb.ts"
    printf '%s\n' "const t = <Text color={ok ? colors.a : 'blue'}>x</Text>" >"$dir/named.tsx"
    found="$(stray_colors "$dir")"
    for each in hex.ts prop.tsx braces.tsx object.ts ternary.tsx short.ts rgb.ts named.tsx; do
      echo "$found" | grep -q "$each" || { echo "fail: the scan missed $each"; exit 1; }
    done
    ;;
  meters-option)
    node -e '
      const { userConfig } = JSON.parse(require("fs").readFileSync(".claude-plugin/plugin.json", "utf8"))
      const m = userConfig.meters
      const ok = m && m.type === "string" && m.default === "padrao" && JSON.stringify(m.options) === JSON.stringify(["padrao", "contraste", "daltonico"])
      if (!ok) { console.error("fail: userConfig.meters is", JSON.stringify(m)); process.exit(1) }
    ' || exit 1
    ;;
  demo-options)
    node -e '
      const { userConfig } = JSON.parse(require("fs").readFileSync(".claude-plugin/plugin.json", "utf8"))
      const missing = ["esquema-padrao", "esquema-contraste", "esquema-daltonico"].filter(scene => !userConfig.demo.options.includes(scene))
      if (missing.length > 0) { console.error("fail: the demo option lacks", missing.join(", ")); process.exit(1) }
    ' || exit 1
    ;;
  readmes)
    for file in README.md README.pt-BR.md; do
      for needle in '`meters`' '/guild meters' 'esquema-padrao' 'esquema-contraste' 'esquema-daltonico' 'Okabe-Ito'; do
        grep -qF -- "$needle" "$file" || { echo "fail: $file does not mention $needle"; exit 1; }
      done
    done
    grep -qi 'color-blind' README.md || { echo "fail: README.md has no accessibility note"; exit 1; }
    grep -qi 'daltonismo' README.pt-BR.md || { echo "fail: README.pt-BR.md has no accessibility note"; exit 1; }
    ;;
  all)
    for each in order fail-test fail-types colors colors-catches meters-option demo-options readmes; do
      "$0" "$each" || exit 1
    done
    exit 0
    ;;
  *)
    echo "usage: verify.test.sh order|fail-test|fail-types|colors|colors-catches|meters-option|demo-options|readmes|all" >&2
    exit 2
    ;;
esac
echo "ok: $1"
