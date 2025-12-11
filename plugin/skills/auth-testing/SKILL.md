---
name: auth-testing
description: |
  Test authentication and authorization vulnerabilities including JWT attacks,
  IDOR, CSRF, broken access control, and open redirects. Use when assessing
  identity and access management security. Requires strix-sandbox MCP server.
---

# Authentication & Authorization Testing

## Overview

This skill covers testing for vulnerabilities in authentication mechanisms and authorization controls. These flaws enable unauthorized access to data and functionality.

## Required Setup

Ensure `strix-sandbox` MCP server is running:

```bash
docker run -d --name strix-sandbox -p 9999:9999 strix/sandbox-mcp
claude mcp add strix-sandbox --url http://localhost:9999
```

## MCP Tools Used

- `browser_*` - Interact with auth flows and capture tokens
- `proxy_list_requests` - Capture authentication traffic
- `proxy_repeat_request` - Replay requests with modified auth
- `python_execute` - Decode/forge tokens, generate test cases
- `finding_create` - Record auth vulnerabilities

## Testing Workflow

### Phase 1: Authentication Analysis

1. Map all authentication endpoints (login, register, reset, OAuth)
2. Identify token types (JWT, session cookies, API keys)
3. Analyze token structure and claims
4. Test token validation (signature, expiry, issuer, audience)

### Phase 2: Authorization Testing

Build an Actor x Action x Resource matrix:
- Roles: unauthenticated, basic user, premium, admin/staff
- Actions: create, read, update, delete, export
- Resources: own data, other users' data, system resources

Test each combination systematically.

### Phase 3: Access Control Verification

1. Attempt horizontal privilege escalation (access other users' resources)
2. Attempt vertical privilege escalation (access admin functions)
3. Test function-level access controls across all transports
4. Verify authorization on background jobs and async operations

## Vulnerability Guides

Detailed testing methodology:
- [JWT Authentication Attacks](./JWT_AUTH.md)
- [Insecure Direct Object Reference (IDOR)](./IDOR.md)
- [Cross-Site Request Forgery (CSRF)](./CSRF.md)
- [Broken Function Level Authorization](./BROKEN_ACCESS.md)
- [Open Redirect](./OPEN_REDIRECT.md)

## Quick Reference

### JWT Attack Vectors

```
# Algorithm confusion
{"alg": "none"}
{"alg": "HS256"} with RS256 public key as secret

# Claim manipulation
Change "sub" to another user ID
Change "role" to "admin"
Extend "exp" timestamp
```

### IDOR Test Patterns

```
# Numeric IDs
/api/users/123 -> /api/users/124

# UUIDs (try sequential or predictable)
/api/orders/550e8400-e29b-41d4-a716-446655440000

# Encoded references
Base64: decode, modify, re-encode
```

### Authorization Checklist

| Test | Method |
|------|--------|
| Horizontal access | Access User B's resources as User A |
| Vertical access | Access admin endpoints as regular user |
| Function-level | Call admin APIs directly |
| Object-level | Modify ownership fields |

## Pro Tips

1. Always test authorization at the API level, not just UI
2. Compare responses across different roles for the same request
3. Check if JWT signature is actually verified (not just decoded)
4. Test OAuth flows for state/nonce validation
5. Look for authorization drift between REST and GraphQL endpoints
6. Verify that background jobs re-check authorization at execution time
