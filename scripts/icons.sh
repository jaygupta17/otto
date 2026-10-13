#!/usr/bin/env bash
# Regenerate every app icon from the SVGs in assets/.
#
#   assets/icon.svg              desktop + README (rounded tile with margin)
#   assets/icons/ios.svg         iOS (full bleed, opaque; iOS rounds it)
#   assets/icons/android-*.svg   Android adaptive layers, legacy round icon, notification icon
#
# `tauri icon` handles desktop; its mobile output puts the whole tile inside
# the adaptive layer (the launcher mask then clips the dot), so the mobile
# sets are rendered here instead. Needs rsvg-convert and ImageMagick.
set -euo pipefail
cd "$(dirname "$0")/.."
for t in rsvg-convert magick; do command -v $t >/dev/null || { echo "missing $t (brew install librsvg imagemagick)" >&2; exit 1; }; done

ICONS=src-tauri/icons
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

render() { rsvg-convert -w "$2" -h "$2" "$1" -o "$3"; }

# Desktop (and Windows Store tiles). Keep our mobile sets out of its way.
rsvg-convert -w 1024 -h 1024 assets/icon.svg -o "$TMP/icon.png"
bunx tauri icon "$TMP/icon.png" -o "$TMP/out" >/dev/null 2>&1
find "$TMP/out" -maxdepth 1 -type f -exec cp {} "$ICONS/" \;

# Android: adaptive (foreground + background colour + monochrome) for 8.0+,
# square and round PNGs for older launchers.
A=$ICONS/android
rm -rf "$A"; mkdir -p "$A/mipmap-anydpi-v26" "$A/values"
for d in mdpi:1 hdpi:1.5 xhdpi:2 xxhdpi:3 xxxhdpi:4; do
  name=${d%%:*}; s=${d##*:}; dir="$A/mipmap-$name"; mkdir -p "$dir"
  fg=$(awk "BEGIN{print int(108*$s)}"); ic=$(awk "BEGIN{print int(48*$s)}")
  render assets/icons/android-foreground.svg "$fg" "$dir/ic_launcher_foreground.png"
  render assets/icons/android-monochrome.svg "$fg" "$dir/ic_launcher_monochrome.png"
  render assets/icon.svg "$ic" "$dir/ic_launcher.png"
  render assets/icons/android-round.svg "$ic" "$dir/ic_launcher_round.png"
  # Status-bar icon for notifications (24dp, alpha only).
  mkdir -p "$A/drawable-$name"
  render assets/icons/android-notification.svg "$(awk "BEGIN{print int(24*$s)}")" "$A/drawable-$name/ic_stat_otto.png"
done
for n in ic_launcher ic_launcher_round; do
  cat > "$A/mipmap-anydpi-v26/$n.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/ic_launcher_background"/>
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
  <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
XML
done
cat > "$A/values/ic_launcher_background.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">#161616</color>
</resources>
XML

# iOS: same file names Xcode's asset catalog expects; no alpha channel.
I=$ICONS/ios
rm -rf "$I"; mkdir -p "$I"
render assets/icons/ios.svg 1024 "$TMP/ios.png"
for spec in 20x20@1x:20 20x20@2x:40 20x20@2x-1:40 20x20@3x:60 29x29@1x:29 29x29@2x:58 29x29@2x-1:58 29x29@3x:87 \
            40x40@1x:40 40x40@2x:80 40x40@2x-1:80 40x40@3x:120 60x60@2x:120 60x60@3x:180 76x76@1x:76 76x76@2x:152 \
            83.5x83.5@2x:167 512@2x:1024; do
  magick "$TMP/ios.png" -resize "${spec##*:}x${spec##*:}" -background "#161616" -alpha remove -alpha off "$I/AppIcon-${spec%%:*}.png"
done

echo "icons updated in $ICONS"
