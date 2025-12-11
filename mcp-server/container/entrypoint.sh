#!/bin/bash
set -e

echo "Starting Strix Sandbox..."

# Create data directories
mkdir -p /data/requests /data/findings

# Start mitmproxy if enabled
if [ "${WITH_PROXY:-true}" = "true" ]; then
    echo "Starting mitmproxy on port 8080..."
    mitmdump \
        --mode regular \
        --listen-port 8080 \
        -s /app/proxy_addon.py \
        --set block_global=false \
        --set connection_strategy=lazy \
        --quiet &

    # Wait for mitmproxy to start
    sleep 2
    echo "mitmproxy started"
fi

# Start tool execution server
echo "Starting tool server on port 9999..."
exec python /app/tool_server.py \
    --port "${TOOL_SERVER_PORT:-9999}" \
    --token "${TOOL_SERVER_TOKEN:-default-token}"
