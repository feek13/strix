---
name: logic-testing
description: |
  Test business logic vulnerabilities including race conditions, mass assignment,
  workflow bypasses, and insecure file uploads. Use when assessing application
  logic and state management. Requires strix-sandbox MCP server.
---

# Business Logic Testing

## Overview

This skill covers testing for business logic flaws that exploit intended functionality to violate domain invariants. These vulnerabilities require understanding the business model, not just technical payloads.

## Required Setup

Ensure `strix-sandbox` MCP server is running:

```bash
docker run -d --name strix-sandbox -p 9999:9999 strix/sandbox-mcp
claude mcp add strix-sandbox --url http://localhost:9999
```

## MCP Tools Used

- `browser_*` - Walk through business workflows
- `proxy_list_requests` - Capture workflow traffic
- `proxy_repeat_request` - Replay and modify workflow steps
- `python_execute` - Concurrent request testing
- `terminal_execute` - HTTP/2 multiplexing for race conditions
- `finding_create` - Record logic vulnerabilities

## Testing Workflow

### Phase 1: Workflow Mapping

1. Identify critical business workflows:
   - Financial: payments, refunds, credits, discounts
   - Account: signup, upgrade, trial, subscription
   - Authorization: role changes, approvals, reviews
   - Resources: quotas, limits, inventory

2. Document state machines and invariants:
   - What states exist?
   - What transitions are allowed?
   - What conditions must hold?

### Phase 2: Logic Testing

For each workflow:
1. Test step skipping (call finalize without verify)
2. Test step repetition (apply discount twice)
3. Test step reordering (refund before capture)
4. Test late mutation (modify after validation)
5. Test boundary conditions (limits, quotas, time windows)

### Phase 3: Concurrency Testing

1. Send parallel identical requests
2. Test race windows in read-modify-write sequences
3. Verify idempotency key implementation
4. Check atomic operations and locking

## Vulnerability Guides

Detailed testing methodology:
- [Business Logic Flaws](./BUSINESS_LOGIC.md)
- [Race Conditions](./RACE_CONDITIONS.md)
- [Mass Assignment](./MASS_ASSIGNMENT.md)
- [Insecure File Uploads](./FILE_UPLOADS.md)

## Quick Reference

### Common Logic Vulnerabilities

| Category | Example |
|----------|---------|
| Price manipulation | Modify price in cart after discount |
| Discount stacking | Apply multiple exclusive discounts |
| Double spending | Race condition on balance deduction |
| Workflow bypass | Skip payment verification step |
| Limit evasion | Split transactions below threshold |

### Race Condition Testing

```bash
# HTTP/2 multiplexing for tight timing
# Send N concurrent requests
for i in {1..10}; do
  curl -X POST /api/redeem -d '{"code":"ONCE"}' &
done
wait
```

### Mass Assignment Fields

```json
// Try adding these fields to updates
{
  "role": "admin",
  "isAdmin": true,
  "ownerId": "other-user-id",
  "price": 0,
  "verified": true,
  "credits": 9999
}
```

## Pro Tips

1. Map the state machine first - gaps appear where transitions lack guards
2. Test with time and concurrency - many bugs only appear under pressure
3. Never trust client-computed values (totals, prices, discounts)
4. Verify idempotency keys are scoped to user AND operation
5. Check background jobs separately - they often skip auth checks
6. Document invariants and prove their violation with minimal PoCs
