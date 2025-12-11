# Strix Sandbox Container
# Provides isolated environment for security testing with Playwright, mitmproxy, and tmux

FROM python:3.12-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Browser dependencies
    chromium \
    chromium-driver \
    # Terminal
    tmux \
    # Search tools
    ripgrep \
    # Network tools
    curl \
    wget \
    netcat-openbsd \
    dnsutils \
    # Git
    git \
    # Misc
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN useradd -m -s /bin/bash -u 1000 pentester && \
    mkdir -p /data /workspace /app && \
    chown -R pentester:pentester /data /workspace /app

# Install Python packages
RUN pip install --no-cache-dir \
    # Browser automation
    playwright==1.49.0 \
    # HTTP proxy
    mitmproxy==11.0.0 \
    # Python execution
    ipython==8.29.0 \
    # Web framework for tool server
    fastapi==0.115.6 \
    uvicorn==0.32.1 \
    # HTTP client
    httpx==0.28.1 \
    # Terminal management
    libtmux==0.37.0 \
    # Data validation
    pydantic==2.10.3

# Install Playwright browser dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-unifont \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

# Install Playwright browsers as pentester user
USER pentester
ENV PLAYWRIGHT_BROWSERS_PATH=/home/pentester/.cache/ms-playwright
RUN playwright install chromium
USER root

# Copy application code
COPY --chown=pentester:pentester tool_server.py /app/tool_server.py
COPY --chown=pentester:pentester proxy_addon.py /app/proxy_addon.py
COPY --chown=pentester:pentester browser_instance.py /app/browser_instance.py
COPY --chown=pentester:pentester terminal_session.py /app/terminal_session.py
COPY --chown=pentester:pentester python_instance.py /app/python_instance.py
COPY --chown=pentester:pentester entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

# Set working directory
WORKDIR /workspace

# Expose ports
# 9999: Tool execution server
# 8080: mitmproxy
EXPOSE 9999 8080

# Switch to non-root user
USER pentester

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:9999/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
