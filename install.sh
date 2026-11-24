#!/bin/sh
# Copies the Orchestra Lite mod into Herdr. Herdr docks it on the right the first time it sees it.
set -eu
SRC="$(cd "$(dirname "$0")" && pwd)/mods/orchestra-lite"
DEST="$HOME/.config/herdr-app/mods/orchestra-lite"
[ -d "$HOME/.config/herdr-app" ] || { echo "Herdr not found: ~/.config/herdr-app is missing. Install and open Herdr first." >&2; exit 1; }
mkdir -p "$DEST"
cp "$SRC"/* "$DEST"/
herdr-app check "$DEST"
echo "Installed. The Orchestra Lite panel is on the right of the Herdr window."
