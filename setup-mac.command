#!/bin/bash
#
# kesef — one-time setup for macOS. 💰
#
# To run it:
#   • Double-click this file.  (If macOS says it's blocked: right-click → Open → Open.)
#   • Or, in Terminal:   cd into this folder, then:   bash setup-mac.command
#
# What it does: installs Node.js if needed (no admin password), installs kesef's
# dependencies, optionally pulls your bank data, and opens kesef in your browser.
#

cd "$(dirname "$0")" || { echo "Couldn't find the kesef folder."; exit 1; }

echo ""
echo "💰  Setting up kesef…"
echo "    Folder: $(pwd)"
echo ""

# ── 1. Make sure Node.js (v20+) is installed ────────────────────────────────
node_major() { command -v node >/dev/null 2>&1 && node -v | sed 's/v\([0-9]*\).*/\1/' || echo 0; }

if [ "$(node_major)" -lt 20 ]; then
  echo "→  Installing Node.js 24 (no admin password needed)…"
  export NVM_DIR="$HOME/.nvm"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install 24 && nvm use 24
else
  echo "→  Node.js $(node -v) is already installed. 👍"
fi

# Make sure node/npm are on PATH for the rest of this script (nvm may be fresh)
if ! command -v npm >/dev/null 2>&1; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" 2>/dev/null || true
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "✗  Node/npm still not found. Close this window, open a brand-new Terminal, and run this script again."
  exit 1
fi

# ── 2. Install dependencies (downloads a private browser for the bank logins) ─
echo ""
echo "→  Installing dependencies — the first time takes a few minutes (~150 MB)…"
if ! npm install; then
  echo "✗  Install failed. Check your internet connection and run this script again."
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
