---
name: security-reporting
description: |
  Generate security testing reports with vulnerability documentation, severity
  assessment, and remediation recommendations. Use after completing security
  testing to produce actionable reports. Requires strix-sandbox MCP server.
---

# Security Reporting

## Overview

This skill covers generating comprehensive security reports that document findings, assess risk, and provide actionable remediation guidance.

## Required Setup

Ensure `strix-sandbox` MCP server is running:

```bash
docker run -d --name strix-sandbox -p 9999:9999 strix/sandbox-mcp
claude mcp add strix-sandbox --url http://localhost:9999
```

## MCP Tools Used

- `finding_list` - Retrieve all recorded findings
- `finding_export` - Generate formatted report
- `browser_screenshot` - Capture evidence
- `terminal_execute` - Run report generation tools

## Report Structure

### Executive Summary

High-level overview for stakeholders:
- Assessment scope and methodology
- Overall risk assessment
- Critical findings count
- Key recommendations

### Technical Findings

For each vulnerability:
1. Title and severity (CVSS)
2. Affected component/endpoint
3. Description and impact
4. Proof of concept
5. Remediation steps
6. References

### Methodology

Document testing approach:
- Tools and techniques used
- Coverage achieved
- Limitations and exclusions

## Severity Assessment

Use CVSS 3.1 for consistent scoring:

| Severity | CVSS Score | Response Time |
|----------|------------|---------------|
| Critical | 9.0 - 10.0 | Immediate |
| High | 7.0 - 8.9 | 24-48 hours |
| Medium | 4.0 - 6.9 | 1-2 weeks |
| Low | 0.1 - 3.9 | Next release |
| Info | 0.0 | Advisory |

### CVSS Factors

- **Attack Vector**: Network (N), Adjacent (A), Local (L), Physical (P)
- **Attack Complexity**: Low (L), High (H)
- **Privileges Required**: None (N), Low (L), High (H)
- **User Interaction**: None (N), Required (R)
- **Scope**: Unchanged (U), Changed (C)
- **Impact**: Confidentiality, Integrity, Availability (None/Low/High)

## Report Templates

### Vulnerability Report Template

```markdown
## [SEVERITY] Title

**CVSS Score**: X.X (Vector String)
**Affected Component**: /api/endpoint
**Status**: Open

### Description
Brief description of the vulnerability and its root cause.

### Impact
What an attacker could achieve by exploiting this vulnerability.

### Proof of Concept
Step-by-step reproduction:
1. Navigate to...
2. Submit request...
3. Observe...

### Evidence
[Screenshot or request/response]

### Remediation
Specific steps to fix:
1. Implement input validation...
2. Add authorization check...

### References
- CWE-XXX
- OWASP reference
```

### Executive Summary Template

```markdown
# Security Assessment Report

## Executive Summary

### Scope
- Target: [Application/URL]
- Period: [Date range]
- Type: [Black box / White box / Grey box]

### Risk Summary
| Severity | Count |
|----------|-------|
| Critical | X |
| High | X |
| Medium | X |
| Low | X |

### Key Findings
1. [Most critical finding]
2. [Second critical finding]
3. [Third critical finding]

### Recommendations
1. [Priority remediation]
2. [Security improvement]
3. [Process change]
```

## Pro Tips

1. Write for your audience - executives need risk context, developers need technical detail
2. Include reproduction steps that work - test your PoCs before reporting
3. Prioritize findings by business impact, not just technical severity
4. Provide specific, actionable remediation - not just "fix the vulnerability"
5. Document what was NOT tested due to scope limitations
6. Include positive findings - security controls that worked well
