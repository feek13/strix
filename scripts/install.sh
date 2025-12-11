#!/bin/bash
# Strix Security Testing Framework - One-click installer for Linux/macOS
# Usage: curl -fsSL https://raw.githubusercontent.com/usestrix/strix/main/scripts/install.sh | bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "  ____  _        _      "
echo " / ___|| |_ _ __(_)_  __"
echo " \___ \| __| '__| \ \/ /"
echo "  ___) | |_| |  | |>  < "
echo " |____/ \__|_|  |_/_/\_\\"
echo ""
echo -e "${NC}AI-Powered Security Testing Framework"
echo "========================================"
echo ""

# Check prerequisites
check_prerequisites() {
    echo -e "${YELLOW}Checking prerequisites...${NC}"

    # Check Python
    if command -v python3 &> /dev/null; then
        PYTHON_VERSION=$(python3 --version 2>&1 | cut -d' ' -f2)
        echo -e "  ${GREEN}✓${NC} Python $PYTHON_VERSION"
    else
        echo -e "  ${RED}✗${NC} Python 3.11+ is required"
        echo "    Install Python from https://python.org"
        exit 1
    fi

    # Check pip
    if command -v pip3 &> /dev/null || python3 -m pip --version &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} pip is available"
    else
        echo -e "  ${RED}✗${NC} pip is required"
        exit 1
    fi

    # Check Docker (optional but recommended)
    if command -v docker &> /dev/null; then
        if docker info &> /dev/null; then
            echo -e "  ${GREEN}✓${NC} Docker is running"
            DOCKER_AVAILABLE=true
        else
            echo -e "  ${YELLOW}!${NC} Docker is installed but not running"
            DOCKER_AVAILABLE=false
        fi
    else
        echo -e "  ${YELLOW}!${NC} Docker not found (optional, recommended for full sandbox)"
        DOCKER_AVAILABLE=false
    fi

    # Check Claude Code CLI
    if command -v claude &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} Claude Code CLI found"
    else
        echo -e "  ${YELLOW}!${NC} Claude Code CLI not found"
        echo "    Install from: https://claude.ai/claude-code"
    fi

    echo ""
}

# Install MCP server
install_mcp() {
    echo -e "${YELLOW}Installing Strix MCP Server...${NC}"

    if pip3 install strix-sandbox 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} strix-sandbox installed from PyPI"
    else
        echo -e "  ${YELLOW}!${NC} PyPI install failed, trying from source..."
        pip3 install "git+https://github.com/usestrix/strix.git#subdirectory=mcp-server"
    fi

    echo ""
}

# Pull Docker image
setup_docker() {
    if [ "$DOCKER_AVAILABLE" = true ]; then
        echo -e "${YELLOW}Pulling Strix Sandbox Docker image...${NC}"

        if docker pull strix/sandbox:latest 2>/dev/null; then
            echo -e "  ${GREEN}✓${NC} Docker image pulled"
        else
            echo -e "  ${YELLOW}!${NC} Docker image not available yet, will use local sandbox"
        fi

        echo ""
    fi
}

# Install Skills plugin
install_plugin() {
    echo -e "${YELLOW}Installing Strix Security Skills plugin...${NC}"

    PLUGIN_DIR="$HOME/.claude/plugins/strix-security"

    # Create plugins directory if not exists
    mkdir -p "$HOME/.claude/plugins"

    # Download plugin
    if [ -d "$PLUGIN_DIR" ]; then
        echo -e "  ${YELLOW}!${NC} Updating existing plugin..."
        rm -rf "$PLUGIN_DIR"
    fi

    # Clone plugin directory
    TEMP_DIR=$(mktemp -d)
    git clone --depth 1 https://github.com/usestrix/strix.git "$TEMP_DIR" 2>/dev/null || {
        echo -e "  ${RED}✗${NC} Failed to download plugin"
        rm -rf "$TEMP_DIR"
        return 1
    }

    mv "$TEMP_DIR/plugin" "$PLUGIN_DIR"
    rm -rf "$TEMP_DIR"

    echo -e "  ${GREEN}✓${NC} Plugin installed to $PLUGIN_DIR"
    echo ""
}

# Configure Claude Code MCP
configure_mcp() {
    echo -e "${YELLOW}Configuring Claude Code MCP...${NC}"

    SETTINGS_FILE="$HOME/.claude/settings.json"

    # Create settings directory
    mkdir -p "$HOME/.claude"

    # Check if settings file exists
    if [ -f "$SETTINGS_FILE" ]; then
        # Check if strix-sandbox is already configured
        if grep -q "strix-sandbox" "$SETTINGS_FILE" 2>/dev/null; then
            echo -e "  ${GREEN}✓${NC} MCP already configured"
            return 0
        fi
    fi

    # Add MCP configuration using Claude Code CLI if available
    if command -v claude &> /dev/null; then
        claude mcp add strix-sandbox --command "strix-sandbox" 2>/dev/null || true
        echo -e "  ${GREEN}✓${NC} MCP configured via Claude Code CLI"
    else
        echo -e "  ${YELLOW}!${NC} Please run: claude mcp add strix-sandbox --command 'strix-sandbox'"
    fi

    echo ""
}

# Print success message
print_success() {
    echo -e "${GREEN}========================================"
    echo "Installation Complete!"
    echo "========================================${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Start Claude Code: claude"
    echo "  2. Use security skills:"
    echo "     - /security-test <target>"
    echo "     - /security-scan <url>"
    echo ""
    echo "Available Skills:"
    echo "  - security-recon     - Reconnaissance & mapping"
    echo "  - injection-testing  - SQL/Command injection"
    echo "  - auth-testing       - Authentication testing"
    echo "  - logic-testing      - Business logic flaws"
    echo "  - platform-testing   - Platform/API security"
    echo "  - web-security       - Web vulnerability testing"
    echo ""
    echo "Documentation: https://github.com/usestrix/strix"
    echo ""
}

# Main installation flow
main() {
    check_prerequisites
    install_mcp
    setup_docker
    install_plugin
    configure_mcp
    print_success
}

main
