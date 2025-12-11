# DEEP VERIFICATION - Write Operation Validation

## Core Principle

```
HTTP Status Code ≠ Operation Success
Must Verify Actual Data Changes
```

Many APIs return HTTP 200/204 even when authorization blocks the actual operation. Only data comparison reveals the truth.

## The Problem

| What You See | What You Assume | Reality |
|--------------|-----------------|---------|
| HTTP 204 No Content | "Operation succeeded" | Could be blocked by RLS |
| HTTP 200 OK | "Data modified" | Response body may be empty |
| No error message | "Vulnerability exists" | Authorization may have silently blocked |

## Verification Strategies

### Strategy 1: Return Representation

Best for APIs supporting the `Prefer` header (Supabase, PostgREST, some REST APIs).

```http
PATCH /rest/v1/profiles?id=eq.{target_id}
Content-Type: application/json
Prefer: return=representation

{"username": "HACKED"}
```

**Result Interpretation**:
- `[]` (empty array) = 0 rows affected = RLS blocked = **NO vulnerability**
- `[{"id": "...", "username": "HACKED"}]` = Data modified = **VULNERABILITY**

### Strategy 2: Before/After Compare

Universal method - works with any API.

```
1. GET target resource → save "before" state
2. Execute PATCH/PUT/DELETE operation
3. GET target resource → save "after" state
4. Compare: before === after → NO vulnerability
            before !== after → VULNERABILITY
```

**Example Flow**:
```python
# Step 1: Before state
before = GET("/api/users/123")  # {"name": "Alice"}

# Step 2: Execute attack
PATCH("/api/users/123", {"name": "HACKED"})  # Returns 200

# Step 3: After state
after = GET("/api/users/123")  # {"name": "Alice"} or {"name": "HACKED"}?

# Step 4: Verdict
if before == after:
    print("SAFE - Authorization blocked the modification")
else:
    print("VULNERABLE - Data was actually modified")
```

### Strategy 3: Blind Channel Detection

When direct reads are unavailable or restricted.

#### 3a. Count Difference

```http
GET /rest/v1/posts?select=count
Prefer: count=exact
```
Compare counts before/after DELETE operations.

#### 3b. ETag Comparison

```http
HEAD /api/resource/123
# Compare ETag header before/after operations
```

#### 3c. Timing Analysis

```python
# Existing resources often respond faster
# Due to index hits vs full scans
t1 = time(GET("/api/users/existing_id"))
t2 = time(GET("/api/users/nonexistent_id"))
# Consistent timing difference indicates existence
```

#### 3d. Error Shape Analysis

```python
# Owner vs non-owner may get different error formats
owner_error = PATCH("/resource/123", token=owner)      # {"error": "validation failed"}
attacker_error = PATCH("/resource/123", token=other)  # {"error": "not found"}
# Shape difference reveals existence and authorization model
```

## Platform-Specific Guidance

### Supabase / PostgREST

**Best Method**: `Prefer: return=representation`

```bash
# Test IDOR write
curl -X PATCH 'https://PROJECT.supabase.co/rest/v1/profiles?id=eq.TARGET_ID' \
  -H 'apikey: ANON_KEY' \
  -H 'Authorization: Bearer ANON_KEY' \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=representation' \
  -d '{"username": "HACKED"}'

# Result: [] = SAFE (RLS blocked)
# Result: [{...}] = VULNERABLE
```

**Count Method for DELETE**:
```bash
# Before
curl 'https://PROJECT.supabase.co/rest/v1/posts?select=count' \
  -H 'apikey: ANON_KEY' \
  -H 'Prefer: count=exact'
# Returns: content-range: 0-9/10

# Execute DELETE
curl -X DELETE 'https://PROJECT.supabase.co/rest/v1/posts?id=eq.TARGET_ID' \
  -H 'apikey: ANON_KEY'

# After
# Compare count: 10 → 10 = SAFE, 10 → 9 = VULNERABLE
```

### Firebase / Firestore

**Best Method**: Compare `updateTime` or `writeResult`

```javascript
// Before
const docBefore = await db.doc('users/TARGET_ID').get();
const beforeData = docBefore.data();

// Execute attack
await db.doc('users/TARGET_ID').update({ name: 'HACKED' });

// After
const docAfter = await db.doc('users/TARGET_ID').get();
const afterData = docAfter.data();

// Compare
if (JSON.stringify(beforeData) === JSON.stringify(afterData)) {
    console.log("SAFE - Rules blocked modification");
} else {
    console.log("VULNERABLE - Data was modified");
}
```

**Using writeResult**:
```javascript
const result = await db.doc('users/TARGET_ID').update({ name: 'HACKED' });
// If rules block, this throws PermissionDenied
// If it succeeds silently, compare writeTime
```

### GraphQL

**Best Method**: Check `affected_rows` in mutation response

```graphql
mutation UpdateUser {
  update_users(
    where: { id: { _eq: "TARGET_ID" } }
    _set: { name: "HACKED" }
  ) {
    affected_rows
    returning {
      id
      name
    }
  }
}
```

**Result Interpretation**:
- `affected_rows: 0` = Authorization blocked = **NO vulnerability**
- `affected_rows: 1` + `returning` shows modified data = **VULNERABILITY**

### Standard REST APIs

**Best Method**: Before/After Compare

```python
def verify_idor_write(api_base, resource_path, target_id, field, new_value, headers):
    """Universal REST IDOR verification"""

    # 1. Before state
    before_resp = requests.get(f"{api_base}{resource_path}/{target_id}", headers=headers)
    before_value = before_resp.json().get(field)

    # 2. Execute operation
    patch_resp = requests.patch(
        f"{api_base}{resource_path}/{target_id}",
        json={field: new_value},
        headers=headers
    )

    # 3. After state
    after_resp = requests.get(f"{api_base}{resource_path}/{target_id}", headers=headers)
    after_value = after_resp.json().get(field)

    # 4. Verdict
    return {
        "http_status": patch_resp.status_code,
        "before": before_value,
        "after": after_value,
        "vulnerable": before_value != after_value,
        "conclusion": "VULNERABLE" if before_value != after_value else "SAFE"
    }
```

## Verification Template

```python
class DeepVerifier:
    """Universal deep verification for write operations"""

    def verify_write(self,
                     read_func,      # Function to read current value
                     write_func,     # Function to execute write
                     target_id: str,
                     field: str,
                     new_value: any) -> dict:
        """
        Returns:
            {
                "vulnerable": bool,
                "evidence": {
                    "before": any,
                    "after": any,
                    "http_status": int,
                    "response_body": any
                },
                "conclusion": str
            }
        """
        # 1. Capture before state
        before = read_func(target_id, field)

        # 2. Execute write operation
        status, response = write_func(target_id, {field: new_value})

        # 3. Capture after state
        after = read_func(target_id, field)

        # 4. Determine vulnerability
        data_changed = (before != after)

        return {
            "vulnerable": data_changed,
            "evidence": {
                "before": before,
                "after": after,
                "http_status": status,
                "response_body": response
            },
            "conclusion": f"VULNERABLE - {field} changed from '{before}' to '{after}'"
                         if data_changed
                         else f"SAFE - {field} unchanged (authorization blocked)"
        }
```

## Report Requirements

Every IDOR/write vulnerability report MUST include:

### Required Evidence

| Field | Description | Example |
|-------|-------------|---------|
| Before State | Original value before operation | `username: "alice"` |
| Request | Full request with headers | `PATCH /api/users/123 ...` |
| HTTP Response | Status + body | `204 No Content` + `[]` |
| After State | Value after operation | `username: "alice"` or `"HACKED"` |
| Affected Rows | From return=representation | `0` or `1+` |
| Conclusion | Based on data change, NOT status code | "SAFE - RLS blocked" |

### Report Template

```markdown
## Finding: IDOR - Profile Modification

**Before State**:
```json
{"id": "123", "username": "alice", "email": "alice@example.com"}
```

**Request**:
```http
PATCH /rest/v1/profiles?id=eq.123
Authorization: Bearer <attacker_token>
Prefer: return=representation

{"username": "HACKED"}
```

**Response**:
- HTTP Status: 200
- Body: `[]` (empty array)

**After State**:
```json
{"id": "123", "username": "alice", "email": "alice@example.com"}
```

**Affected Rows**: 0

**Conclusion**: **NOT VULNERABLE** - RLS policy blocked the modification.
The empty response array indicates 0 rows were affected.
```

## Verification Checklist

Before reporting any write-based vulnerability:

- [ ] Captured Before state (original value)
- [ ] Executed write operation with appropriate headers
- [ ] Used `Prefer: return=representation` if available
- [ ] Captured After state (post-operation value)
- [ ] Compared Before vs After
- [ ] Analyzed response for affected rows indicator
- [ ] Tested with different identities (owner vs non-owner)
- [ ] Conclusion based on DATA CHANGE, not HTTP status

## Common Mistakes

### Mistake 1: Trusting HTTP Status

```
❌ HTTP 204 → "Vulnerability confirmed!"
✅ HTTP 204 + data unchanged → "Authorization working correctly"
```

### Mistake 2: Ignoring Empty Responses

```
❌ PATCH returned 200 → "Write succeeded!"
✅ PATCH returned 200 + [] → "0 rows affected, RLS blocked"
```

### Mistake 3: No Before/After Comparison

```
❌ "PATCH request completed, vulnerability exists"
✅ "PATCH completed, but data unchanged → no vulnerability"
```

## Remember

```
The ONLY reliable indicator of a write vulnerability is:
ACTUAL DATA CHANGE verified through direct comparison

Not HTTP status codes.
Not response timing.
Not error messages.

VERIFY THE DATA.
```

---

## Auto-Trigger Condition Matrix

When to automatically invoke deep verification:

| Trigger Condition | Verification Strategy | Must Check |
|-------------------|----------------------|------------|
| HTTP 200/201/204 on write | State comparison | Before/After data |
| Write operation "succeeds" | Integrity verification | Did data actually change? |
| DELETE returns success | Existence check | Does resource still exist? |
| Auth appears bypassed | Permission verification | Test privileged operations |
| Injection seems successful | Data extraction/callback | Read sensitive data |
| Upload seems successful | Execution verification | File accessible/executable? |
| SSRF seems successful | Callback confirmation | OOB data exfiltration |
| XSS seems stored | DOM inspection | Payload encoding check |

---

## Three Principles Against False Positives

### Principle 1: Never Trust HTTP Status Codes

```
HTTP 200/204 only means "request was processed"
NOT "operation succeeded"

↓ Always verify actual impact
```

### Principle 2: Must Verify Actual Impact

```
Verification Chain:
1. Before/After state comparison
2. Cross-identity verification (owner vs non-owner)
3. Multi-channel verification (different methods confirm same result)

All three should align for CONFIRMED status
```

### Principle 3: Confidence-Based Reporting

```
┌─────────────┬───────────────────────────────────────────┐
│ CONFIRMED   │ Full evidence chain required              │
│ (90-100)    │ → Before ≠ After + Cross-identity +       │
│             │   Impact demonstrated                     │
├─────────────┼───────────────────────────────────────────┤
│ PROBABLE    │ Strong indicators, partial verification   │
│ (70-89)     │ → Document what remains unverified        │
├─────────────┼───────────────────────────────────────────┤
│ POSSIBLE    │ Some indicators, incomplete verification  │
│ (50-69)     │ → Explain why confirmation impossible     │
├─────────────┼───────────────────────────────────────────┤
│ UNLIKELY    │ Most verifications failed                 │
│ (30-49)     │ → Low priority investigation             │
├─────────────┼───────────────────────────────────────────┤
│ SAFE        │ All verifications failed                  │
│ (0-29)      │ → Mark as secure                         │
└─────────────┴───────────────────────────────────────────┘

See [Confidence System](./CONFIDENCE_SYSTEM.md) for detailed scoring.
```

---

## Integration

This methodology integrates with:
- [Confidence System](./CONFIDENCE_SYSTEM.md) - Vulnerability confidence scoring
- [Vulnerability-Specific Verification](./VULN_SPECIFIC_VERIFICATION.md) - Per-vulnerability methods
- [IDOR Testing](../auth-testing/IDOR.md) - Authorization bypass verification
- [deep_verify.py](./deep_verify.py) - Automated verification tool
