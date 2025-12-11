---
name: security-recon
description: |
  Reconnaissance and information gathering for security testing. Use when starting
  a new security assessment to identify attack surface, technology stack, and
  potential entry points. Requires strix-sandbox MCP server for browser and proxy tools.
---

# Security Reconnaissance

## Overview

This skill provides methodology and tools for the reconnaissance phase of security testing. It covers target identification, technology fingerprinting, endpoint discovery, and attack surface mapping.

## Required Setup

Ensure `strix-sandbox` MCP server is running:

```bash
docker run -d --name strix-sandbox -p 9999:9999 strix/sandbox-mcp
claude mcp add strix-sandbox --url http://localhost:9999
```

## MCP Tools Used

- `browser_*` - Browser automation for crawling and fingerprinting
- `proxy_list_requests` - View captured HTTP traffic
- `proxy_get_sitemap` - Build site structure from traffic
- `terminal_execute` - Run reconnaissance tools (nmap, subfinder, etc.)

## Testing Workflow

### Phase 1: Target Analysis

1. Identify target type (local directory, GitHub repo, or live URL)
2. For local/GitHub: analyze source code structure and dependencies
3. For live targets: begin passive reconnaissance

### Phase 2: Technology Fingerprinting

Identify the technology stack:
- Frontend frameworks (React, Vue, Angular, Next.js)
- Backend frameworks (FastAPI, Express, Django, Rails)
- Databases (PostgreSQL, MongoDB, Firebase, Supabase)
- Cloud providers (AWS, GCP, Azure)
- Authentication systems (JWT, OAuth, session-based)

### Phase 3: Attack Surface Mapping

1. Enumerate endpoints via crawling and traffic analysis
2. Identify API patterns (REST, GraphQL, gRPC)
3. Map authentication and authorization boundaries
4. Document file upload and export surfaces
5. Note third-party integrations and webhooks

### Phase 4: Information Gathering

Look for information disclosure:
- Debug endpoints and error messages
- API documentation (OpenAPI, GraphQL introspection)
- Source maps and client bundles
- Configuration files and backups

## Vulnerability Guides

Detailed reconnaissance methodology:
- [Information Disclosure](./INFORMATION_DISCLOSURE.md)
- [Subdomain Takeover](./SUBDOMAIN_TAKEOVER.md)

## Quick Reference

### Common Reconnaissance Endpoints

```
/.git/HEAD
/.env
/robots.txt
/sitemap.xml
/openapi.json
/swagger.json
/graphql (introspection)
/.well-known/
/debug/
/actuator/
```

### Technology Fingerprints

| Header/Response | Technology |
|----------------|------------|
| `X-Powered-By: Next.js` | Next.js |
| `Server: uvicorn` | FastAPI/Starlette |
| `X-Supabase-*` | Supabase |
| `__NEXT_DATA__` in HTML | Next.js |
| `/rest/v1/` endpoints | Supabase PostgREST |

## Pro Tips

1. Start passive - analyze client bundles and public APIs before active probing
2. Check multiple content-types and encodings for each endpoint
3. Compare behavior across authenticated vs unauthenticated requests
4. Document everything - IDs, endpoints, and technology versions found
5. Use the sitemap from proxy traffic to ensure complete coverage
