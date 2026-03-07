#!/usr/bin/env bash
# ============================================================
# Street Art Agent — Setup Script
# ============================================================
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo "  Street Art Agent — Setup"
echo "  ========================"
echo ""

# Check Node version
REQUIRED_NODE=18
NODE_VERSION=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ -z "$NODE_VERSION" ] || [ "$NODE_VERSION" -lt "$REQUIRED_NODE" ]; then
  echo -e "${RED}Error: Node.js v${REQUIRED_NODE}+ is required.${NC}"
  echo "  Download at: https://nodejs.org"
  exit 1
fi
echo -e "${GREEN}Node.js v$(node -v | sed 's/v//')${NC} detected."

# Create .env from .env.example if it doesn't exist
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo ""
  echo -e "${YELLOW}Created .env from .env.example${NC}"
  echo ""
  echo "  ACTION REQUIRED:"
  echo "  Open .env and replace the placeholder with your Anthropic API key."
  echo "  Get your key at: https://console.anthropic.com/settings/keys"
  echo ""
  read -p "  Press Enter once you've added your API key to .env..."
fi

# Validate key is set
API_KEY=$(grep VITE_ANTHROPIC_API_KEY .env | cut -d= -f2 | tr -d ' ')
if [ -z "$API_KEY" ] || [ "$API_KEY" = "sk-ant-your-key-here" ]; then
  echo ""
  echo -e "${RED}Error: VITE_ANTHROPIC_API_KEY is not set in .env${NC}"
  echo "  Edit .env and add your key, then run setup.sh again."
  exit 1
fi
echo -e "${GREEN}API key detected.${NC}"

# Install dependencies
echo ""
echo "Installing dependencies..."
npm install

echo ""
echo -e "${GREEN}Setup complete!${NC}"
echo ""
echo "  Run the agent:"
echo "    npm run dev"
echo ""
echo "  Then open: http://localhost:5173"
echo ""
