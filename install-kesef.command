#!/bin/bash
#
# kesef — install (or update) on macOS, from scratch. 💰
#
# Easiest way to run it (paste this ONE line into Terminal):
#   curl -fsSL https://raw.githubusercontent.com/GevaIluz/kesef/main/install-kesef.command | bash
#
# It installs Node.js and git if they're missing, downloads kesef to ~/kesef
# (or updates it if already there), installs dependencies, and opens the app.
# Re-running the same line later UPDATES kesef to the newest version.
#
# Your money data is never in here — it lives in ~/.kesef and the Keychain, so
# installing/updating never touches it.

set -u
REPO="https://github.com/GevaIluz/kesef.git"
DEST="$HOME/kesef"

echo ""
echo "💰  kesef installer"
echo ""

# ── Node.js (v20+) via Apple's official installer ───────────────────────────
node_major() { command -v node >/dev/null 2>&1 && node -v | sed 's/v\([0-9]*\).*/\1/' || echo 0; }
if [ "$(node_major)" -lt 20 ]; then
  echo "→  Installing Node.js (you'll be asked for your Mac password once)…"
  base="https://nodejs.org/dist/latest-v24.x"
  pkg="$(curl -fsSL "$base/SHASUMS256.txt" | grep -o 'node-v[0-9][0-9.]*\.pkg' | head -1)"
  if [ -z "$pkg" ]; then echo "✗  Couldn't reach nodejs.org. Check internet and retry."; exit 1; fi
  curl -fSL --progress-bar -o /tmp/kesef-node.pkg "$base/$pkg" || { echo "✗  Node download failed."; exit 1; }
  sudo installer -pkg /tmp/kesef-node.pkg -target / || { echo "✗  Node install failed."; exit 1; }
  rm -f /tmp/kesef-node.pkg
  hash -r; export PATH="/usr/local/bin:$PATH"
else
  echo "→  Node.js $(node -v) already installed."
fi

# ── git via Apple Command Line Tools (note: /usr/bin/git is a stub until CLT is in) ──
if ! git --version >/dev/null 2>&1; then
  echo "→  Installing git (Apple Command Line Tools). A popup will appear — click \"Install\"."
  xcode-select --install >/dev/null 2>&1 || true
  printf "   Waiting for it to finish"
  until git --version >/dev/null 2>&1; do printf "."; sleep 5; done
  echo " done."
else
  echo "→  git $(git --version | awk '{print $3}') already installed."
fi

# ── Download (or update) kesef ───────────────────────────────────────────────
if [ -d "$DEST/.git" ]; then
  echo "→  Updating kesef in $DEST …"
  git -C "$DEST" pull --ff-only || { echo "✗  Update failed."; exit 1; }
else
  echo "→  Downloading kesef to $DEST …"
  git clone "$REPO" "$DEST" || { echo "✗  Download failed."; exit 1; }
fi
cd "$DEST" || { echo "✗  Couldn't open $DEST"; exit 1; }

# ── Dependencies ─────────────────────────────────────────────────────────────
echo ""
echo "→  Installing dependencies — first time takes a few minutes (~150 MB)…"
if ! npm install; then
  # Most common failure: a half-finished puppeteer browser download in the
  # per-user cache (~/.cache/puppeteer) that never re-heals on retry. Clear it
  # and try once more before giving up.
  echo "→  First attempt failed — clearing the browser cache and retrying once…"
  rm -rf "$HOME/.cache/puppeteer"
  if ! npm install; then
    echo "✗  Dependency install failed. Check internet/disk space and run the line again."
    exit 1
  fi
fi

# ── Verify browser binaries are intact ────────────────────────────────────────
# A download can succeed at the zip level yet leave a corrupt extraction in the
# puppeteer cache. Detect the two required executables and re-download if either
# is missing.
CHROME_EXE=$(find "$HOME/.cache/puppeteer/chrome" -name "Google Chrome for Testing" -type f 2>/dev/null | head -1)
HEADLESS_EXE=$(find "$HOME/.cache/puppeteer/chrome-headless-shell" -name "chrome-headless-shell" -type f 2>/dev/null | head -1)
if [ -z "$CHROME_EXE" ] || [ -z "$HEADLESS_EXE" ]; then
  echo "→  Browser binaries incomplete — clearing cache and re-downloading…"
  rm -rf "$HOME/.cache/puppeteer"
  node node_modules/puppeteer/install.mjs || { echo "✗  Browser download failed. Check internet/disk space."; exit 1; }
fi

# ── Open kesef ────────────────────────────────────────────────────────────────
echo ""
echo "✅  Done! Opening kesef → http://localhost:8750"
echo "    • First time? Pull your bank data in a new Terminal:  cd ~/kesef && npm run sync"
echo "    • Keep this window open (it runs the app). Ctrl-C stops it."
echo "    • To update later, paste that same curl line again — it pulls the newest version."
echo ""
( sleep 4; open "http://localhost:8750" >/dev/null 2>&1 ) &
exec npm run app
