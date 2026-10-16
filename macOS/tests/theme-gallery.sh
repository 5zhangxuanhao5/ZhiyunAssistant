#!/bin/bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/zhiyun-theme-gallery.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
sed '/^let application=NSApplication.shared/,$d' "$project_dir/Sources/App.swift" > "$test_dir/Bridge.swift"
sed 's/^@main struct WebKitAppSmoke/struct WebKitAppSmoke/' "$project_dir/tests/WebKitAppSmoke.swift" > "$test_dir/SmokeSupport.swift"
xcrun swiftc -D NATIVE_CONTRACT_TESTS -parse-as-library -target "$(uname -m)-apple-macos13.0" "$test_dir/Bridge.swift" "$test_dir/SmokeSupport.swift" "$project_dir/tests/ThemeGallerySmoke.swift" -o "$test_dir/theme-gallery"
"$test_dir/theme-gallery" "$project_dir/web" "$test_dir" "${1:-$project_dir/web/theme-previews}"
mkdir -p "$project_dir/build"
cp "$test_dir/theme-validation.json" "$project_dir/build/theme-validation.json"
cp "$test_dir/theme-picker-validated.png" "$project_dir/build/theme-picker-validated.png"

mkdir -p "$project_dir/build/theme-calendars"
cp "$test_dir/theme-calendars/"*.png "$project_dir/build/theme-calendars/"
