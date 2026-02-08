#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HOOK_DIR="$PROJECT_DIR/backend/dist/hooks"
SETTINGS_FILE="$HOME/.claude/settings.json"

echo "Strix WebUI - Hook Installer"
echo "============================"
echo ""

# Check if hooks are built
if [ ! -f "$HOOK_DIR/pre-tool-use.js" ]; then
  echo "Building backend first..."
  cd "$PROJECT_DIR/backend" && npm run build
fi

echo "Hook directory: $HOOK_DIR"
echo "Settings file: $SETTINGS_FILE"
echo ""

# Create settings dir if needed
mkdir -p "$(dirname "$SETTINGS_FILE")"

# Read existing settings or create empty
if [ -f "$SETTINGS_FILE" ]; then
  SETTINGS=$(cat "$SETTINGS_FILE")
else
  SETTINGS='{}'
fi

# Use node to merge hooks into settings
node -e "
const fs = require('fs');
const settings = JSON.parse(process.argv[1]);
const hookDir = process.argv[2];

if (!settings.hooks) settings.hooks = {};

settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];
settings.hooks.PostToolUse = settings.hooks.PostToolUse || [];
settings.hooks.SubagentStop = settings.hooks.SubagentStop || [];
settings.hooks.PreCompact = settings.hooks.PreCompact || [];

// Remove any existing strix-webui hooks
const filterStrix = (arr) => arr.filter(h =>
  !h.hooks?.some(cmd => cmd.includes('strix-webui'))
);

settings.hooks.PreToolUse = filterStrix(settings.hooks.PreToolUse);
settings.hooks.PostToolUse = filterStrix(settings.hooks.PostToolUse);
settings.hooks.SubagentStop = filterStrix(settings.hooks.SubagentStop);
settings.hooks.PreCompact = filterStrix(settings.hooks.PreCompact);

// Add new hooks
settings.hooks.PreToolUse.push({
  matcher: '',
  hooks: ['node ' + hookDir + '/pre-tool-use.js']
});

settings.hooks.PostToolUse.push({
  matcher: '',
  hooks: ['node ' + hookDir + '/post-tool-use.js']
});

settings.hooks.SubagentStop.push({
  matcher: '',
  hooks: ['node ' + hookDir + '/subagent-stop.js']
});

settings.hooks.PreCompact.push({
  matcher: '',
  hooks: ['node ' + hookDir + '/pre-compact.js']
});

fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(settings, null, 2));
console.log('Hooks installed successfully!');
" "$SETTINGS" "$HOOK_DIR"

echo ""
echo "Done! Hooks registered in $SETTINGS_FILE"
echo ""
echo "To start the WebUI:"
echo "  cd $PROJECT_DIR && npm run dev"
