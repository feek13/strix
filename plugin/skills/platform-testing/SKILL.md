---
name: platform-testing
description: |
  Test platform and framework-specific vulnerabilities for GraphQL, FastAPI,
  Next.js, Supabase, Firebase, and common cloud services. Use when testing
  applications built on these specific technologies. Requires strix-sandbox MCP server.
---

# Platform & Framework Testing

## Overview

This skill covers security testing specific to popular frameworks and platforms. Each has unique attack surfaces and common misconfigurations.

## Required Setup

Ensure `strix-sandbox` MCP server is running:

```bash
docker run -d --name strix-sandbox -p 9999:9999 strix/sandbox-mcp
claude mcp add strix-sandbox --url http://localhost:9999
```

## MCP Tools Used

- `browser_*` - Interact with platform-specific UIs
- `proxy_list_requests` - Capture platform API traffic
- `proxy_send_request` - Test platform-specific endpoints
- `python_execute` - Query introspection, test RLS policies
- `finding_create` - Record platform vulnerabilities

## Platform Detection

Identify the technology stack first:

| Indicator | Platform |
|-----------|----------|
| `/graphql` endpoint | GraphQL API |
| `/rest/v1/` + `apikey` header | Supabase |
| `__NEXT_DATA__` in HTML | Next.js |
| `firebaseio.com` requests | Firebase |
| `/docs` + uvicorn server | FastAPI |

## Testing by Platform

### GraphQL

Key areas:
- Introspection exposure
- Field-level authorization
- Batching/alias abuse
- Federation trust boundaries
- Subscription authorization

### Supabase

Key areas:
- Row Level Security (RLS) policies
- PostgREST filter bypasses
- Storage bucket permissions
- RPC function authorization
- Realtime channel security

### Firebase/Firestore

Key areas:
- Security rules coverage
- Collection group queries
- Cloud Function authorization
- Storage rules
- App Check limitations

### Next.js

Key areas:
- Middleware bypass vectors
- Server Actions authorization
- RSC/ISR cache boundaries
- Image optimizer SSRF
- NextAuth configuration

### FastAPI

Key areas:
- Dependency injection security
- OpenAPI exposure in production
- CORS configuration
- Pydantic validation gaps
- WebSocket authorization

## Vulnerability Guides

Detailed platform-specific testing:
- [GraphQL Security](./GRAPHQL.md)
- [FastAPI Testing](./FASTAPI.md)
- [Next.js Testing](./NEXTJS.md)
- [Supabase Security](./SUPABASE.md)
- [Firebase/Firestore Security](./FIREBASE.md)
- [SSRF Attacks](./SSRF.md)

## Quick Reference

### GraphQL Introspection

```graphql
query { __schema { types { name fields { name } } } }
```

### Supabase RLS Test

```bash
# Compare results for two different users
curl 'https://PROJECT.supabase.co/rest/v1/TABLE?select=*' \
  -H 'apikey: ANON_KEY' \
  -H 'Authorization: Bearer USER_A_JWT'

curl 'https://PROJECT.supabase.co/rest/v1/TABLE?select=*' \
  -H 'apikey: ANON_KEY' \
  -H 'Authorization: Bearer USER_B_JWT'
```

### Firebase Rules Check

```bash
# Test unauthenticated access
curl 'https://PROJECT.firebaseio.com/.json'

# Test with auth token
curl 'https://PROJECT.firebaseio.com/.json?auth=ID_TOKEN'
```

## Pro Tips

1. Always compare SDK behavior with raw REST/HTTP requests
2. Test authorization at resolver/function level, not just endpoint
3. Check cache boundaries for identity-specific data leaks
4. Verify token audience and issuer validation
5. Look for authorization drift between different API transports
6. Document platform version - vulnerabilities are version-specific
