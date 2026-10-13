#!/usr/bin/env bash
# Copy Otto's icons into the generated mobile projects.
#
# `tauri android init` / `tauri ios init` write fresh projects with Tauri's
# placeholder icons and never read src-tauri/icons/{android,ios}, so run this
# after every init (CI inits on each release build). Safe to run twice.
set -euo pipefail
cd "$(dirname "$0")/.."
ICONS=src-tauri/icons

RES=src-tauri/gen/android/app/src/main/res
if [ -d "$RES" ]; then
  # The template's vector placeholders; ours are PNG mipmaps plus a colour.
  rm -f "$RES/drawable/ic_launcher_background.xml" "$RES/drawable-v24/ic_launcher_foreground.xml"
  # Our colour is named ic_launcher_background too; drop any template copy so it isn't defined twice.
  [ -f "$RES/values/colors.xml" ] && sed -i.bak '/name="ic_launcher_background"/d' "$RES/values/colors.xml" && rm -f "$RES/values/colors.xml.bak"
  cp -R "$ICONS/android/." "$RES/"
  echo "android icons → $RES"
fi

SET=$(find src-tauri/gen/apple -type d -name AppIcon.appiconset 2>/dev/null | head -1 || true)
if [ -n "$SET" ]; then
  cp "$ICONS"/ios/AppIcon-*.png "$SET/"
  echo "ios icons → $SET"
fi
