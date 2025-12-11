---
name: verification-methods
description: |
  Deep verification methodology to avoid false positives in security testing.
  Provides write operation verification, confidence scoring system, and
  vulnerability-specific validation strategies. Use when testing IDOR, SQLi,
  XSS, SSRF, authentication bypass, file upload, or any write operations.
  Essential for eliminating false positives caused by misleading HTTP responses.
---

# Deep Verification Methodology

## Overview

HTTP status code ≠ operation success. This skill provides methodology and tools for verifying actual data changes, avoiding false positives in security assessments.

## Required Setup

No special dependencies. Works with all other skills.

## MCP Tools Used

- `python_execute` - Execute verification scripts
- `proxy_send_request` - Send requests with Prefer headers
- `finding_create` - Record verification results

## Core Principle

```
HTTP 200/204 ≠ Operation Succeeded
Empty array [] = 0 rows affected = Authorization blocked
Must verify actual data change
```

## Verification Strategies

1. **Return Representation** - Use `Prefer: return=representation` header
2. **Before/After Compare** - Compare state before and after operation
3. **Blind Detection** - Count differences, ETag changes, timing analysis

## Technique Guides

- [Deep Verification Methods](./DEEP_VERIFICATION.md) - Core 5-step verification flow
- [Confidence System](./CONFIDENCE_SYSTEM.md) - Vulnerability confidence classification (CONFIRMED/PROBABLE/POSSIBLE/UNLIKELY/SAFE)
- [Vulnerability-Specific Verification](./VULN_SPECIFIC_VERIFICATION.md) - Per-vulnerability methods (SQLi, XSS, SSRF, Auth Bypass, File Upload)

## Quick Reference

| Platform | Success Indicator | Blocked Indicator |
|----------|------------------|-------------------|
| Supabase/PostgREST | Returns `[{data}]` | Returns `[]` |
| Firebase/Firestore | `writeTime` changes | `updateTime` unchanged |
| GraphQL | `affected_rows > 0` | `affected_rows: 0` |
| Standard REST | Response contains updated data | Empty or unchanged response |

## Pro Tips

1. Never judge vulnerabilities by HTTP status code alone
2. Empty array `[]` = 0 rows affected = No vulnerability
3. Must verify actual data changes
4. Use multiple verification: representation + before/after
5. Cross-identity verification: owner vs non-owner behavior
