#!/usr/bin/env bash
# Put Lemma in the applications menu as its own window.
#
# The app is a PWA, so the browser's own "install" button does the same job.
# This exists because that button is easy to miss, and because a desktop entry
# survives the browser being reinstalled.
#
#   ./scripts/install-desktop.sh              # the deployed app
#   ./scripts/install-desktop.sh --dev        # the local dev server instead
set -euo pipefail

URL="https://boroda496.github.io/lemma/"
NAME="Lemma"
ID="lemma"

if [[ "${1:-}" == "--dev" ]]; then
  URL="http://localhost:5173/lemma/"
  NAME="Lemma (dev)"
  ID="lemma-dev"
fi

BROWSER=""
for candidate in google-chrome google-chrome-stable chromium chromium-browser brave-browser microsoft-edge; do
  if command -v "$candidate" >/dev/null 2>&1; then BROWSER="$candidate"; break; fi
done

if [[ -z "$BROWSER" ]]; then
  echo "No Chromium-based browser found. Firefox cannot open a site as its own window," >&2
  echo "so open $URL in your browser and use its own install option instead." >&2
  exit 1
fi

APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor/512x512/apps"
mkdir -p "$APPS" "$ICONS"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT/public/icon-512.png" ]]; then
  cp "$ROOT/public/icon-512.png" "$ICONS/$ID.png"
fi

cat > "$APPS/$ID.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=$NAME
Comment=Verified mathematics practice
Exec=$BROWSER --app=$URL --class=$ID
Icon=$ID
Terminal=false
Categories=Education;Science;Math;
StartupWMClass=$ID
DESKTOP

chmod +x "$APPS/$ID.desktop"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

echo "Installed \"$NAME\" using $BROWSER."
echo "It points at $URL and should appear in your applications menu now."
