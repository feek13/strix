# Strix Security - Claude Code Plugin

AI-powered security testing framework for Claude Code. This plugin provides comprehensive vulnerability testing capabilities through specialized Skills.

## Installation

### Prerequisites

1. **strix-sandbox MCP Server** (required for active testing)
   ```bash
   docker pull strix/sandbox-mcp
   docker run -d --name strix-sandbox -p 9999:9999 strix/sandbox-mcp
   claude mcp add strix-sandbox --url http://localhost:9999
   ```

2. **Install the Plugin**
   ```bash
   claude plugins add strix-security
   ```

## Usage

### Quick Start

Run a comprehensive security test:
```
/security-test https://your-target.com
```

Or test a local codebase:
```
/security-test ./your-project-directory
```

### Using Individual Skills

You can also invoke specific Skills for targeted testing:

- **security-recon** - Reconnaissance and information gathering
- **injection-testing** - SQL injection, XSS, XXE, RCE, path traversal
- **auth-testing** - JWT attacks, IDOR, CSRF, broken access control
- **logic-testing** - Business logic, race conditions, file uploads
- **platform-testing** - GraphQL, Supabase, Firebase, Next.js, FastAPI
- **security-reporting** - Generate vulnerability reports

Example:
```
Use the injection-testing skill to test this login form for SQL injection
```

## Skills Overview

### security-recon

Reconnaissance and attack surface mapping:
- Technology fingerprinting
- Endpoint enumeration
- Information disclosure detection
- Subdomain takeover checks

### injection-testing

Input validation vulnerability testing:
- SQL Injection (error-based, blind, time-based)
- Cross-Site Scripting (reflected, stored, DOM)
- XML External Entity (XXE)
- Remote Code Execution (RCE)
- Path Traversal / LFI / RFI

### auth-testing

Authentication and authorization testing:
- JWT token security
- Insecure Direct Object References (IDOR)
- Cross-Site Request Forgery (CSRF)
- Broken Function-Level Authorization
- Open Redirect vulnerabilities

### logic-testing

Business logic vulnerability testing:
- Workflow bypass and state manipulation
- Race conditions and concurrency bugs
- Mass assignment vulnerabilities
- Insecure file upload handling

### platform-testing

Framework-specific security testing:
- GraphQL introspection, batching, authorization
- Supabase RLS, PostgREST, Storage policies
- Firebase/Firestore security rules
- Next.js middleware, server actions, cache
- FastAPI dependency injection, CORS

### security-reporting

Report generation:
- CVSS severity scoring
- Proof-of-concept documentation
- Executive summary generation
- Remediation recommendations

## MCP Tools

This plugin requires the `strix-sandbox` MCP server which provides:

| Tool Category | Tools |
|--------------|-------|
| Browser Automation | `browser_launch`, `browser_goto`, `browser_click`, `browser_type`, `browser_screenshot`, etc. |
| HTTP Proxy | `proxy_list_requests`, `proxy_view_request`, `proxy_send_request`, `proxy_repeat_request`, etc. |
| Terminal | `terminal_execute`, `terminal_send_input` |
| Python | `python_execute`, `python_session` |
| Findings | `finding_create`, `finding_list`, `finding_update`, `finding_export` |
| Sandbox | `sandbox_create`, `sandbox_destroy`, `sandbox_status` |

## Knowledge Base

Each Skill includes detailed vulnerability testing guides covering:
- Attack methodology
- Detection techniques
- Exploitation payloads
- Bypass methods
- Validation criteria
- False positive identification
- Impact assessment
- Pro tips from security professionals

## Architecture

```
strix-security/
├── .claude-plugin/
│   └── plugin.json           # Plugin metadata
├── skills/
│   ├── security-recon/       # Reconnaissance skill
│   ├── injection-testing/    # Injection vulnerabilities
│   ├── auth-testing/         # Auth/authz vulnerabilities
│   ├── logic-testing/        # Business logic flaws
│   ├── platform-testing/     # Platform-specific testing
│   └── security-reporting/   # Report generation
├── commands/
│   └── security-test.md      # /security-test command
└── README.md
```

## Contributing

Contributions are welcome! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT License - See [LICENSE](LICENSE) for details.

## Security

This tool is designed for authorized security testing only. Always ensure you have explicit permission before testing any system.

Report security issues to: security@strix.dev
