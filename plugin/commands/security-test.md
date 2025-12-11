---
description: 综合安全测试工作流，包含环境设置、侦察、漏洞测试、报告生成
argument-hint: <target> (local path | GitHub URL | web URL)
---

# Security Test Command

When the user invokes `/security-test <target>`, execute the following comprehensive security testing workflow.

## Target Analysis

First, determine the target type:

| Target Type | Recognition | Testing Mode |
|-------------|-------------|--------------|
| Local Directory | Path exists and is a directory | White-box + Black-box |
| GitHub URL | Contains `github.com` | Clone, then White-box + Black-box |
| Web URL | Starts with `http://` or `https://` | Pure Black-box |

## Workflow Execution

### Phase 1: Environment Setup

1. **Initialize Sandbox**
   - Use `sandbox_create` to create an isolated testing environment
   - Start mitmproxy for traffic interception
   - Launch Playwright browser with proxy configured

2. **Configure Scope**
   - Use `scope_rules` to set target domain allowlist
   - Configure proxy to capture only in-scope traffic

### Phase 2: Reconnaissance (Use `security-recon` skill)

1. **Technology Fingerprinting**
   - Identify frontend framework (React, Vue, Next.js, etc.)
   - Identify backend framework (FastAPI, Express, Django, etc.)
   - Identify database/BaaS (PostgreSQL, Supabase, Firebase, etc.)
   - Note authentication mechanisms (JWT, sessions, OAuth)

2. **Attack Surface Mapping**
   - Crawl the application using `sandbox_browser_*` tools
   - Enumerate API endpoints from traffic and documentation
   - Identify file upload and export surfaces
   - Map authentication and authorization boundaries

3. **Information Gathering**
   - Check for debug endpoints and error disclosure
   - Look for API documentation (OpenAPI, GraphQL introspection)
   - Search for source maps and configuration leaks

### Phase 3: Vulnerability Testing

Based on reconnaissance findings, invoke relevant skills in parallel using the Task tool:

```
IF discovered forms/user inputs:
    Use `injection-testing` skill for:
    - SQL injection testing
    - XSS testing
    - Command injection testing
    - Path traversal testing

IF discovered authentication system:
    Use `auth-testing` skill for:
    - JWT/token security testing
    - IDOR testing
    - CSRF testing
    - Access control testing

IF discovered specific platforms (GraphQL, Supabase, Firebase, Next.js, FastAPI):
    Use `platform-testing` skill for:
    - Platform-specific vulnerability testing
    - Configuration security assessment
    - SSRF testing

IF discovered complex business workflows:
    Use `logic-testing` skill for:
    - Business logic testing
    - Race condition testing
    - File upload security testing
```

### Phase 4: Exploitation and Validation

For each potential vulnerability:

1. **Confirm Vulnerability**
   - Create minimal proof-of-concept
   - Verify reproducibility
   - Document exact steps

2. **Assess Impact**
   - Determine CVSS score
   - Identify affected data/functionality
   - Estimate business impact

3. **Record Finding**
   - Use `finding_create` to document:
     - Title and description
     - Severity and CVSS
     - Proof of concept
     - Remediation recommendations

### Phase 5: Reporting (Use `security-reporting` skill)

1. **Compile Findings**
   - Use `finding_list` to retrieve all documented vulnerabilities
   - Organize by severity and category

2. **Generate Report**
   - Create executive summary
   - Document all findings with PoCs
   - Provide prioritized remediation roadmap

3. **Export**
   - Use `finding_export` to generate final report
   - Include all evidence and screenshots

### Phase 6: Cleanup

1. **Destroy Sandbox**
   - Use `sandbox_destroy` to clean up the testing environment
   - Ensure no sensitive data persists

## Output Format

Provide the user with:

1. **Summary Table**
   | Severity | Count |
   |----------|-------|
   | Critical | X |
   | High | X |
   | Medium | X |
   | Low | X |

2. **Top Findings** (Critical and High)
   - Brief description of each
   - Impact assessment
   - Priority remediation steps

3. **Next Steps**
   - Recommended immediate actions
   - Suggested follow-up testing

## Error Handling

- If sandbox creation fails: Inform user and suggest manual MCP server setup
- If target is unreachable: Verify URL and network connectivity
- If testing blocked by WAF: Note limitation and test alternative vectors
- If credentials required: Request authentication details from user

## Safety Considerations

- Only test systems you have authorization to test
- Avoid destructive operations unless explicitly requested
- Use minimal payloads for proof-of-concept
- Document all testing activities for audit purposes
