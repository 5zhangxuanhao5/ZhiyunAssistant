#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ "$(uname -s)" != "Darwin" ]]; then
  printf '%s\n' 'Native macOS builds need macOS and Apple Command Line Tools.' >&2
  exit 1
fi
for tool in node xcrun lipo sips iconutil codesign hdiutil ditto shasum; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Missing build tool: %s\n' "$tool" >&2
    exit 1
  fi
done
node --experimental-vm-modules generate-models.cjs
version="$(node -p 'require("./package.json").version')"
build_number=4
build_root="$PWD/build"
mkdir -p "$build_root"
staging="$(mktemp -d "$build_root/staging.XXXXXX")"
trap 'rm -rf "$staging"' EXIT
app="$staging/智云助手.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
for architecture in arm64 x86_64; do
  xcrun swiftc -O -target "${architecture}-apple-macosx13.0" \
    -framework Cocoa -framework WebKit -framework Network -framework Security \
    -framework CryptoKit -framework Vision Sources/App.swift \
    -o "$build_root/zhiyun-$architecture"
done
lipo -create "$build_root/zhiyun-arm64" "$build_root/zhiyun-x86_64" -output "$app/Contents/MacOS/Zhiyun"
node bundle-web.cjs "$app/Contents/Resources/web"
icons="$staging/AppIcon.iconset"
mkdir -p "$icons"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" web/icon.png --out "$icons/icon_${size}x${size}.png" >/dev/null
  double=$((size*2))
  sips -z "$double" "$double" web/icon.png --out "$icons/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$icons" -o "$app/Contents/Resources/AppIcon.icns"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>智云助手</string>
<key>CFBundleDisplayName</key><string>智云助手</string>
<key>CFBundleIdentifier</key><string>cn.suike.slides.mac</string>
<key>CFBundleExecutable</key><string>Zhiyun</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundleShortVersionString</key><string>$version</string>
<key>CFBundleVersion</key><string>$build_number</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
<key>NSHumanReadableCopyright</key><string>智云助手独立学习工具</string>
</dict></plist>
PLIST
# Ad-hoc signing is for local builds. Developer ID signing/notarization remains a
# separate release step and never requires embedding certificates or secrets.
codesign --force --deep --sign - --identifier cn.suike.slides.mac "$app"
codesign --verify --deep --strict "$app"
rm -rf "$build_root/智云助手.app"
ditto "$app" "$build_root/智云助手.app"
dmg_stage="$staging/dmg"
mkdir -p "$dmg_stage"
ditto "$app" "$dmg_stage/智云助手.app"
ln -s /Applications "$dmg_stage/Applications"
hdiutil create -volname "智云助手" -srcfolder "$dmg_stage" -ov -format UDZO "$build_root/智云助手-Mac-$version.dmg" >/dev/null
ditto -c -k --norsrc --keepParent "$app" "$build_root/智云助手-Mac-$version.zip"
(cd "$build_root" && shasum -a 256 "智云助手-Mac-$version.dmg" "智云助手-Mac-$version.zip" > SHA256SUMS.txt)
printf 'Built universal macOS app %s (%s), DMG and ZIP.\n' "$version" "$build_number"
