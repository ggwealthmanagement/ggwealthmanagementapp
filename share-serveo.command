#!/bin/bash
# GG App - Share via Public URL (using serveo.net - no install needed)
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
  sleep 2
  echo "✅ Server started"
fi

echo ""
echo "🌐 Creating public tunnel via serveo.net..."
echo "   Look for a line like:  Forwarding HTTP traffic from https://xxxxx.serveo.net"
echo ""
echo "📋 Copy that URL and send it to your tester."
echo "   They can open it on any phone, anywhere."
echo ""
echo "⚠️  Keep this window open while testing."
echo "   Press Ctrl+C to stop."
echo ""
echo "--------------------------------------"
echo ""

ssh -o StrictHostKeyChecking=no -R 80:localhost:3000 serveo.net
