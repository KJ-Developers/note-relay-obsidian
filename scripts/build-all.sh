#!/bin/bash
set -e

echo "🏗️  Building Note Relay Monorepo..."
echo ""

# Build UI
echo "📦 Building UI bundle..."
cd ui
npm install
npm run build
cd ..

echo ""
echo "✅ UI built: ui/dist/ui-bundle.js ($(du -h ui/dist/ui-bundle.js | cut -f1))"
echo ""

# Build Plugin
echo "🔌 Building Obsidian plugin..."
cd plugin
npm install
npm run build
cd ..

echo ""
echo "✅ Plugin built: plugin/main.js"
echo ""
echo "🎉 Build complete!"
echo ""
echo "Next steps:"
echo "  1. Test in Obsidian (plugin auto-copied to vault)"
echo "  2. Visit http://localhost:5474 after starting server"
echo "  3. Commit and push to GitHub"
