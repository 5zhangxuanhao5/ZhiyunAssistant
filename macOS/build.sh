#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")"
if command -v node >/dev/null 2>&1; then node generate-models.cjs; fi
app="$PWD/build/智云助手.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
swiftc -O -target arm64-apple-macosx13.0 -framework Cocoa -framework WebKit -framework Network -framework Security -framework CryptoKit -framework Vision Sources/App.swift -o build/zhiyun-arm64
swiftc -O -target x86_64-apple-macosx13.0 -framework Cocoa -framework WebKit -framework Network -framework Security -framework CryptoKit -framework Vision Sources/App.swift -o build/zhiyun-x86_64
lipo -create build/zhiyun-arm64 build/zhiyun-x86_64 -output "$app/Contents/MacOS/Zhiyun"
cp -R web "$app/Contents/Resources/"
icons="$PWD/build/AppIcon.iconset"
mkdir -p "$icons"
for size in 16 32 128 256 512; do
 sips -z "$size" "$size" web/icon.png --out "$icons/icon_${size}x${size}.png" >/dev/null
 double=$((size*2))
 sips -z "$double" "$double" web/icon.png --out "$icons/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$icons" -o "$app/Contents/Resources/AppIcon.icns"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleName</key><string>智云助手</string><key>CFBundleDisplayName</key><string>智云助手</string><key>CFBundleIdentifier</key><string>cn.suike.slides.mac</string><key>CFBundleExecutable</key><string>Zhiyun</string><key>CFBundleIconFile</key><string>AppIcon</string><key>CFBundleShortVersionString</key><string>1.0.0</string><key>CFBundleVersion</key><string>1</string><key>CFBundlePackageType</key><string>APPL</string><key>LSMinimumSystemVersion</key><string>13.0</string><key>NSHighResolutionCapable</key><true/><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict><key>NSHumanReadableCopyright</key><string>智云助手独立学习工具</string>
</dict></plist>
PLIST
codesign --force --deep --sign - --identifier cn.suike.slides.mac "$app"
mkdir -p build/dmg
cp -R "$app" build/dmg/
ln -sfn /Applications build/dmg/Applications
hdiutil create -volname "智云助手" -srcfolder build/dmg -ov -format UDZO "build/智云助手-Mac-1.0.0.dmg" >/dev/null
cd build
ditto -c -k --sequesterRsrc --keepParent 智云助手.app 智云助手-Mac-1.0.0.zip
shasum -a 256 智云助手-Mac-1.0.0.dmg 智云助手-Mac-1.0.0.zip > SHA256SUMS.txt
printf 'Built native universal macOS app and installers\n'
