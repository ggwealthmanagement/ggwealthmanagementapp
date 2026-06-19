#!/bin/bash
# GG App - Share via Public URL
# Double-click this file in Finder to run

cd "$(dirname "$0")"

echo ""
echo "======================================"
echo "  GG Wealth App - Public URL Sharing"
echo "======================================"
echo ""

# Check if node server is already running on port 3000
if lsof -i :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "✅ Server already running on port 3000"
else
  echo "🚀 Starting GG app server..."
  node server.js &
  SERVER_PID=$!
  sleep 2
  echo "✅ Server started (PID $SERVER_PID)"
fi

echo ""
echo "🌐 Creating public tunnel (this may take 10–15 seconds)..."
echo "   (You'll see a URL like: https://xxxx.loca.lt)"
echo ""
echo "📋 Copy that URL and send it to your tester."
echo "   They can open it on any phone, anywhere."
echo ""
echo "⚠️  NOTE: The tunnel URL only works while this window is open."
echo "   Close this window to shut down the public URL."
echo ""
echo "--------------------------------------"
echo ""

npx localtunnel --port 3000
