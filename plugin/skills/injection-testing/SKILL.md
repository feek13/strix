---
name: injection-testing
description: |
  Test for injection vulnerabilities including SQL injection, XSS, XXE, command
  injection, and path traversal. Use when testing web applications for input
  validation flaws and code execution risks. Requires strix-sandbox MCP server.
---

# Injection Testing

## Overview

This skill covers testing for all injection-class vulnerabilities where untrusted input is interpreted as code or commands. These remain among the most critical web application vulnerabilities.

## Required Setup

Ensure `strix-sandbox` MCP server is running:

```bash
docker run -d --name strix-sandbox -p 9999:9999 strix/sandbox-mcp
claude mcp add strix-sandbox --url http://localhost:9999
```

## MCP Tools Used

- `browser_*` - Interact with forms and capture responses
- `proxy_list_requests` - View captured requests with injection points
- `proxy_send_request` - Send crafted payloads
- `proxy_repeat_request` - Replay and modify requests
- `python_execute` - Generate payload variants programmatically
- `finding_create` - Record discovered vulnerabilities

## Testing Workflow

### Phase 1: Injection Point Identification

Identify all user-controlled inputs:
- Form fields, search boxes, URL parameters
- API request bodies (JSON, XML, form-encoded)
- HTTP headers (Host, User-Agent, Referer, custom headers)
- File uploads (filename, content, metadata)
- GraphQL variables and arguments

### Phase 2: Payload Testing

For each injection point:
1. Test baseline behavior with normal input
2. Inject detection payloads (quotes, angle brackets, etc.)
3. Analyze error messages and response differences
4. Escalate with exploitation payloads
5. Test WAF bypass variants

### Phase 3: Validation and PoC

1. Confirm vulnerability with minimal, safe payload
2. Document exact request/response
3. Assess impact and exploitability
4. Create reproducible proof-of-concept

## Vulnerability Guides

Detailed testing methodology:
- [SQL Injection](./SQL_INJECTION.md)
- [Cross-Site Scripting (XSS)](./XSS.md)
- [XML External Entity (XXE)](./XXE.md)
- [Remote Code Execution (RCE)](./RCE.md)
- [Path Traversal / LFI / RFI](./PATH_TRAVERSAL.md)

## Quick Reference

### Detection Payloads

```
SQL: ' OR '1'='1  |  ' AND SLEEP(5)--  |  1 UNION SELECT NULL--
XSS: <script>alert(1)</script>  |  "><img src=x onerror=alert(1)>
XXE: <!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
RCE: ; id  |  | id  |  `id`  |  $(id)
Path: ../../../etc/passwd  |  ....//....//etc/passwd
```

### Encoding Variants

| Technique | Example |
|-----------|---------|
| URL encoding | `%27%20OR%20%271%27%3D%271` |
| Double URL | `%2527` |
| Unicode | `\u0027` |
| HTML entities | `&#39;` `&apos;` |
| Mixed case | `<ScRiPt>` |

## Pro Tips

1. Always test multiple encoding variants - WAFs often miss double-encoded or unicode
2. Use time-based techniques when no direct output is visible
3. Check error messages carefully - they often reveal backend technology
4. Test both GET and POST for the same parameter
5. For SQLi, identify the DBMS first to use appropriate syntax
6. Record all attempts to avoid redundant testing
