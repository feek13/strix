# Strix Security Testing Framework - One-click installer for Windows
# Usage: irm https://raw.githubusercontent.com/usestrix/strix/main/scripts/install.ps1 | iex

$ErrorActionPreference = "Stop"

function Write-ColorOutput {
    param([string]$Message, [string]$Color = "White")
    Write-Host $Message -ForegroundColor $Color
}

Write-Host ""
Write-ColorOutput "  ____  _        _      " -Color Blue
Write-ColorOutput " / ___|| |_ _ __(_)_  __" -Color Blue
Write-ColorOutput " \___ \| __| '__| \ \/ /" -Color Blue
Write-ColorOutput "  ___) | |_| |  | |>  < " -Color Blue
Write-ColorOutput " |____/ \__|_|  |_/_/\_\" -Color Blue
Write-Host ""
Write-Host "AI-Powered Security Testing Framework"
Write-Host "========================================"
Write-Host ""

# Check prerequisites
function Test-Prerequisites {
    Write-ColorOutput "Checking prerequisites..." -Color Yellow

    # Check Python
    try {
        $pythonVersion = python --version 2>&1
        if ($pythonVersion -match "Python (\d+\.\d+)") {
            Write-Host "  [OK] Python $($Matches[1])" -ForegroundColor Green
        }
    }
    catch {
        Write-ColorOutput "  [X] Python 3.11+ is required" -Color Red
        Write-Host "    Install Python from https://python.org"
        exit 1
    }

    # Check pip
    try {
        python -m pip --version | Out-Null
        Write-Host "  [OK] pip is available" -ForegroundColor Green
    }
    catch {
        Write-ColorOutput "  [X] pip is required" -Color Red
        exit 1
    }

    # Check Docker
    $global:DockerAvailable = $false
    try {
        docker info 2>&1 | Out-Null
        Write-Host "  [OK] Docker is running" -ForegroundColor Green
        $global:DockerAvailable = $true
    }
    catch {
        Write-ColorOutput "  [!] Docker not found (optional)" -Color Yellow
    }

    # Check Claude Code CLI
    try {
        Get-Command claude -ErrorAction Stop | Out-Null
        Write-Host "  [OK] Claude Code CLI found" -ForegroundColor Green
    }
    catch {
        Write-ColorOutput "  [!] Claude Code CLI not found" -Color Yellow
        Write-Host "    Install from: https://claude.ai/claude-code"
    }

    Write-Host ""
}

# Install MCP server
function Install-MCP {
    Write-ColorOutput "Installing Strix MCP Server..." -Color Yellow

    try {
        python -m pip install strix-sandbox --quiet
        Write-Host "  [OK] strix-sandbox installed from PyPI" -ForegroundColor Green
    }
    catch {
        Write-ColorOutput "  [!] PyPI install failed, trying from source..." -Color Yellow
        python -m pip install "git+https://github.com/usestrix/strix.git#subdirectory=mcp-server"
    }

    Write-Host ""
}

# Pull Docker image
function Setup-Docker {
    if ($global:DockerAvailable) {
        Write-ColorOutput "Pulling Strix Sandbox Docker image..." -Color Yellow

        try {
            docker pull strix/sandbox:latest 2>&1 | Out-Null
            Write-Host "  [OK] Docker image pulled" -ForegroundColor Green
        }
        catch {
            Write-ColorOutput "  [!] Docker image not available yet" -Color Yellow
        }

        Write-Host ""
    }
}

# Install Skills plugin
function Install-Plugin {
    Write-ColorOutput "Installing Strix Security Skills plugin..." -Color Yellow

    $pluginDir = Join-Path $env:USERPROFILE ".claude\plugins\strix-security"
    $pluginsRoot = Join-Path $env:USERPROFILE ".claude\plugins"

    # Create plugins directory
    if (-not (Test-Path $pluginsRoot)) {
        New-Item -ItemType Directory -Path $pluginsRoot -Force | Out-Null
    }

    # Remove existing plugin
    if (Test-Path $pluginDir) {
        Write-ColorOutput "  [!] Updating existing plugin..." -Color Yellow
        Remove-Item -Recurse -Force $pluginDir
    }

    # Clone plugin
    $tempDir = Join-Path $env:TEMP "strix-install-$(Get-Random)"
    try {
        git clone --depth 1 https://github.com/usestrix/strix.git $tempDir 2>&1 | Out-Null
        Move-Item (Join-Path $tempDir "plugin") $pluginDir
        Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
        Write-Host "  [OK] Plugin installed to $pluginDir" -ForegroundColor Green
    }
    catch {
        Write-ColorOutput "  [X] Failed to download plugin" -Color Red
        Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
    }

    Write-Host ""
}

# Configure Claude Code MCP
function Configure-MCP {
    Write-ColorOutput "Configuring Claude Code MCP..." -Color Yellow

    $claudeDir = Join-Path $env:USERPROFILE ".claude"
    if (-not (Test-Path $claudeDir)) {
        New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
    }

    try {
        claude mcp add strix-sandbox --command "strix-sandbox" 2>&1 | Out-Null
        Write-Host "  [OK] MCP configured via Claude Code CLI" -ForegroundColor Green
    }
    catch {
        Write-ColorOutput "  [!] Please run: claude mcp add strix-sandbox --command 'strix-sandbox'" -Color Yellow
    }

    Write-Host ""
}

# Print success
function Show-Success {
    Write-Host ""
    Write-ColorOutput "========================================" -Color Green
    Write-ColorOutput "Installation Complete!" -Color Green
    Write-ColorOutput "========================================" -Color Green
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "  1. Start Claude Code: claude"
    Write-Host "  2. Use security skills:"
    Write-Host "     - /security-test <target>"
    Write-Host "     - /security-scan <url>"
    Write-Host ""
    Write-Host "Available Skills:"
    Write-Host "  - security-recon     - Reconnaissance & mapping"
    Write-Host "  - injection-testing  - SQL/Command injection"
    Write-Host "  - auth-testing       - Authentication testing"
    Write-Host "  - logic-testing      - Business logic flaws"
    Write-Host "  - platform-testing   - Platform/API security"
    Write-Host "  - web-security       - Web vulnerability testing"
    Write-Host ""
    Write-Host "Documentation: https://github.com/usestrix/strix"
    Write-Host ""
}

# Main
Test-Prerequisites
Install-MCP
Setup-Docker
Install-Plugin
Configure-MCP
Show-Success
