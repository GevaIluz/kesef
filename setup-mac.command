#!/bin/bash
#
# kesef — one-time setup for macOS. 💰
#
# To run it:
#   • Double-click this file.  (If macOS blocks it: right-click → Open → Open,
#     or System Settings → Privacy & Security → "Open Anyway".)
#   • Or, in Terminal:   cd into this folder, then:   bash setup-mac.command
#
# What it does: installs Node.js if needed (Apple's official installer — one
# password prompt), installs kesef's dependencies, optionally pulls your bank
# data, and opens kesef in your browser. Works on a brand-new Mac.
#

cd "$(dirname "$0")" || { echo "Couldn't find the kesef folder."; exit 1; }

echo ""
echo "💰  Setting up kesef…"
echo "    Folder: $(pwd)"
echo ""

# ── 1. Make sure Node.js (v20+) is installed ────────────────────────────────
node_major() { command -v node >/dev/null 2>&1 && node -v | sed 's/v\([0-9]*\).*/\1/' || echo 0; }

if [ "$(node_major)" -lt 20 ]; then
  echo "→  Node.js isn't installed yet. Getting it from nodejs.org…"
  echo "    You'll be asked for your Mac password once — that's normal (it installs Node)."
  base="https://nodejs.org/dist/latest-v24.x"
  pkg="$(curl -fsSL "$base/SHASUMS256.txt" | grep -o 'node-v[0-9][0-9.]*\.pkg' | head -1)"
  if [ -z "$pkg" ]; then
    echo "✗  Couldn't reach nodejs.org. Check your internet connection and run this again."
    exit 1
  fi
  echo "    Downloading $pkg …"
  if ! curl -fSL --progress-bar -o /tmp/kesef-node.pkg "$base/$pkg"; then
    echo "✗  Download failed. Check your internet connection and run this again."
    exit 1
  fi
  echo "    Installing Node.js (enter your Mac password if asked) …"
  if ! sudo installer -pkg /tmp/kesef-node.pkg -target /; then
    echo "✗  Node install failed."; rm -f /tmp/kesef-node.pkg; exit 1
  fi
  rm -f /tmp/kesef-node.pkg
  hash -r
  export PATH="/usr/local/bin:$PATH"
else
  echo "→  Node.js $(node -v) is already installed. 👍"
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "✗  Node was installed but isn't on PATH yet. Close this window, open a brand-new Terminal, and run this script again."
  exit 1
fi
echo "    Using Node $(node -v)."

# ── 2. Install dependencies (downloads a private browser for the bank logins) ─
echo ""
echo "→  Installing dependencies — the first time takes a few minutes (~150 MB)…"
if ! npm install; then
  echo ""
  echo "✗  Dependency install failed."
  if ! xcode-select -p >/dev/null 2>&1; then
    echo "   Apple's Command Line Tools seem to be missing. A popup should appear now —"
    echo "   click \"Install\", let it finish (a few minutes), then run this script again."
    xcode-select --install >/dev/null 2>&1 || true
  else
    echo "   Check your internet connection and run this script again."
  fi
  exit 1
fi

# ── 3. (optional) pull your bank data now ────────────────────────────────────
echo ""
read -r -p "Pull your bank data now? A browser opens for each account — you log in there. [y/N] " ans
case "$ans" in
  [Yy]*) npm run sync || echo "  (the sync hiccuped — you can retry anytime with:  npm run sync )" ;;
  *)     echo "  Skipped. When you're ready, run:  npm run sync" ;;
esac

# ── 4. Open kesef ─────────────────────────────────────────────────────────────
echo ""
echo "✅  All set! Opening kesef → http://localhost:8750"
echo "    • Keep this window open — it's running the app. (Press Ctrl-C to stop.)"
echo "    • To open kesef again later: run  npm run app  in this folder."
echo ""
( sleep 4; open "http://localhost:8750" >/dev/null 2>&1 ) &
exec npm run app
