#!/bin/bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/zhiyun-webkit-smoke.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
sed '/^let application=NSApplication.shared/,$d' "$project_dir/Sources/App.swift" > "$test_dir/Bridge.swift"
xcrun swiftc -D NATIVE_CONTRACT_TESTS -parse-as-library \
  -target "$(uname -m)-apple-macos13.0" \
  "$test_dir/Bridge.swift" "$project_dir/tests/WebKitAppSmoke.swift" \
  -o "$test_dir/webkit-smoke"
ditto "$project_dir/web" "$test_dir/web"
"$test_dir/webkit-smoke" "$test_dir/web" "$test_dir"
