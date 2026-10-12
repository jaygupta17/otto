#!/bin/sh
# Install the latest Otto on macOS:
#
#   curl -fsSL https://jaygupta.dev/otto/install.sh | sh
#
# Otto isn't notarized yet. A browser download gets Apple's quarantine flag,
# which makes macOS block the first launch. curl doesn't set that flag, so an
# app installed this way opens straight away.
#
# The site serves a copy of this file from public/otto/install.sh. Keep them in sync.
set -eu

REPO="jaygupta17/otto"
DEST="${OTTO_DEST:-/Applications}"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "this installer is for macOS. Other platforms: https://jaygupta.dev/otto"

case "$(uname -m)" in
  arm64) arch="aarch64" ;;
  x86_64) arch="x64" ;;
  *) die "unsupported CPU: $(uname -m)" ;;
esac

# /releases/latest redirects to /releases/tag/vX.Y.Z. Reading the tag from the
# redirect avoids the GitHub API and its rate limit.
say "Finding the latest Otto…"
latest=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")
tag=${latest##*/}
case "$tag" in v[0-9]*) ;; *) die "couldn't find the latest release" ;; esac
version=${tag#v}
dmg="Otto_${version}_${arch}.dmg"
url="https://github.com/$REPO/releases/download/$tag/$dmg"

tmp=$(mktemp -d)
mnt="$tmp/mnt"
cleanup() {
  hdiutil detach "$mnt" -quiet 2>/dev/null || true
  rm -rf "$tmp"
}
trap cleanup EXIT INT TERM

say "Downloading Otto $version ($arch)…"
curl -fL --progress-bar "$url" -o "$tmp/$dmg" || die "download failed: $url"

hdiutil attach "$tmp/$dmg" -nobrowse -readonly -mountpoint "$mnt" -quiet
[ -d "$mnt/Otto.app" ] || die "Otto.app isn't in the disk image"

if pgrep -xq Otto; then
  say "Quitting Otto…"
  osascript -e 'quit app "Otto"' 2>/dev/null || true
  sleep 2
fi

say "Installing to $DEST…"
if [ -w "$DEST" ]; then sudo=""; else sudo="sudo"; fi
$sudo rm -rf "$DEST/Otto.app"
$sudo ditto "$mnt/Otto.app" "$DEST/Otto.app"
# Belt and braces: nothing above sets the flag, but clear it in case the
# disk image picked it up some other way.
$sudo xattr -dr com.apple.quarantine "$DEST/Otto.app" 2>/dev/null || true

say "Otto $version is installed. Opening it…"
open "$DEST/Otto.app"
