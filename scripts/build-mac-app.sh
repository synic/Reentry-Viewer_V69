#!/usr/bin/env bash
set -euo pipefail

DIST="dist/reentry-viewer"
APP="$DIST/Reentry Viewer.app"
CONTENTS="$APP/Contents"

echo "Creating macOS .app bundle..."

# Create .app directory structure
mkdir -p "$CONTENTS/MacOS"
mkdir -p "$CONTENTS/Resources"

# Write Info.plist
cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Reentry Viewer</string>
  <key>CFBundleDisplayName</key>
  <string>Reentry Viewer V69</string>
  <key>CFBundleIdentifier</key>
  <string>com.reentryviewer.v69</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleExecutable</key>
  <string>reentry-viewer</string>
  <key>CFBundleIconFile</key>
  <string>appIcon</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

# Copy binary (as the real binary name)
cp "$DIST/reentry-viewer-mac_arm64" "$CONTENTS/MacOS/reentry-viewer-bin"
chmod +x "$CONTENTS/MacOS/reentry-viewer-bin"

# Copy resources bundle next to binary
cp "$DIST/resources.neu" "$CONTENTS/MacOS/resources.neu"

# Create launcher script that cd's to its own directory so
# Neutralinojs can find resources.neu next to the binary
cat > "$CONTENTS/MacOS/reentry-viewer" <<'LAUNCHER'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
exec "$DIR/reentry-viewer-bin" "$@"
LAUNCHER
chmod +x "$CONTENTS/MacOS/reentry-viewer"

# Copy app icon
cp resources/icons/appIcon.png "$CONTENTS/Resources/appIcon.png"

# Remove loose mac binaries
rm -f "$DIST/reentry-viewer-mac_arm64" \
      "$DIST/reentry-viewer-mac_x64" \
      "$DIST/reentry-viewer-mac_universal"

echo "macOS .app bundle created at: $APP"
