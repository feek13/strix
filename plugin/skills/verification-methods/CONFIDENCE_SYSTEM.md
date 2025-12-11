# CONFIDENCE SYSTEM - Vulnerability Confidence Classification

## Core Principle

```
Not all findings deserve "CONFIRMED" status.
Confidence must be earned through evidence.
```

## Confidence Levels

| Level | Score | Requirements | Report Action |
|-------|-------|--------------|---------------|
| CONFIRMED | 90-100 | Full evidence chain | Report immediately |
| PROBABLE | 70-89 | Strong indicators, partial verification | Report with caveats |
| POSSIBLE | 50-69 | Some indicators, incomplete verification | Investigate further |
| UNLIKELY | 30-49 | Most verifications failed | Low priority |
| SAFE | 0-29 | All verifications failed | Mark as secure |

## Scoring Formula

```
confidence = (
    response_evidence × 0.20 +
    state_change × 0.30 +
    cross_identity × 0.25 +
    impact_confirmed × 0.25
)
```

### Score Components

| Component | Weight | Description |
|-----------|--------|-------------|
| response_evidence | 20% | Response indicates success (data returned, no errors) |
| state_change | 30% | Before ≠ After state comparison |
| cross_identity | 25% | Different users/roles produce different results |
| impact_confirmed | 25% | Actual impact demonstrated (read/write/delete) |

---

## Vulnerability-Specific Scoring

### IDOR (Insecure Direct Object Reference)

| Component | CONFIRMED (100) | PROBABLE (75) | POSSIBLE (50) | UNLIKELY (25) |
|-----------|-----------------|---------------|---------------|---------------|
| response_evidence | Returns `[{data}]` | HTTP 200 only | HTTP 200 + empty | Error response |
| state_change | Before ≠ After | Partial change | No change verified | Cannot verify |
| cross_identity | owner ≠ non-owner | Single identity tested | N/A | Same behavior |
| impact_confirmed | Read/Write/Delete proven | Partial access | Metadata only | No access |

**Example Scoring:**
```
Scenario: PATCH returns HTTP 200 but [] (empty array)
- response_evidence: 50 (HTTP success but empty data)
- state_change: 0 (Before == After)
- cross_identity: 100 (owner vs non-owner tested)
- impact_confirmed: 0 (no actual change)

Score = 50×0.2 + 0×0.3 + 100×0.25 + 0×0.25 = 35
Result: UNLIKELY (not a vulnerability, RLS blocked)
```

---

### SQL Injection

| Component | CONFIRMED (100) | PROBABLE (75) | POSSIBLE (50) | UNLIKELY (25) |
|-----------|-----------------|---------------|---------------|---------------|
| response_evidence | Data extracted / Error disclosed | Response differs | Minor differences | No difference |
| state_change | Boolean blind diff confirmed | Timing diff >3s | Timing diff 1-3s | No timing diff |
| cross_identity | N/A - use OOB instead | DNS callback received | HTTP callback sent | No callback |
| impact_confirmed | Sensitive data read | Schema/version leaked | Table names | Nothing useful |

**Verification Methods:**
1. **Boolean Blind**: `' AND 1=1--` vs `' AND 1=2--` response length/content diff
2. **Time Blind**: `'; WAITFOR DELAY '0:0:5'--` actual delay >5s
3. **Out-of-Band**: DNS/HTTP callback to attacker-controlled server
4. **Union**: Actual data extraction in response

---

### XSS (Cross-Site Scripting)

| Component | CONFIRMED (100) | PROBABLE (75) | POSSIBLE (50) | UNLIKELY (25) |
|-----------|-----------------|---------------|---------------|---------------|
| response_evidence | Payload unencoded in DOM | Partial encoding | Fully encoded | Filtered |
| state_change | Script executed | DOM modified | Stored but not rendered | Not stored |
| cross_identity | Other users see payload | Same user only | N/A | No persistence |
| impact_confirmed | Cookie/token stolen | Alert fired | Console log | Nothing |

**CSP Considerations:**
- Check `Content-Security-Policy` header
- `script-src 'unsafe-inline'` = higher confidence
- Strict CSP = lower confidence even if payload stored

---

### SSRF (Server-Side Request Forgery)

| Component | CONFIRMED (100) | PROBABLE (75) | POSSIBLE (50) | UNLIKELY (25) |
|-----------|-----------------|---------------|---------------|---------------|
| response_evidence | Internal data returned | Different error for internal | URL accepted | URL rejected |
| state_change | Internal service accessed | DNS resolution occurred | N/A | No resolution |
| cross_identity | N/A - use callback | HTTP callback received | DNS callback only | No callback |
| impact_confirmed | Metadata/secrets read | Port scan results | Internal IP confirmed | External only |

**High-Value Targets:**
- `http://169.254.169.254/latest/meta-data/` (AWS)
- `http://metadata.google.internal/` (GCP)
- `http://localhost:port/admin` (Internal services)

---

### Authentication Bypass

| Component | CONFIRMED (100) | PROBABLE (75) | POSSIBLE (50) | UNLIKELY (25) |
|-----------|-----------------|---------------|---------------|---------------|
| response_evidence | Auth-protected data returned | Different data than unauth | Same as unauth | Error |
| state_change | Session established | Token accepted | N/A | Token rejected |
| cross_identity | Access as another user | Access as same user | N/A | No access |
| impact_confirmed | Privileged actions work | Read-only access | Metadata only | Nothing |

---

### File Upload

| Component | CONFIRMED (100) | PROBABLE (75) | POSSIBLE (50) | UNLIKELY (25) |
|-----------|-----------------|---------------|---------------|---------------|
| response_evidence | File accessible at URL | Upload successful | Accepted but sanitized | Rejected |
| state_change | Content preserved | Extension changed | Content modified | Deleted |
| cross_identity | Other users can access | Same user only | N/A | No access |
| impact_confirmed | Code executed / XSS triggered | Downloaded intact | Partial content | Nothing |

---

## Quick Decision Tree

```
┌─────────────────────────────────────────────────────────────┐
│                    Vulnerability Found?                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Q1: Did the actual data/state change?                       │
│     (Before/After comparison)                               │
└─────────────────────────────────────────────────────────────┘
        │                                    │
       YES                                  NO
        │                                    │
        ▼                                    ▼
┌─────────────────┐               ┌─────────────────────────┐
│ Q2: Different   │               │ Likely FALSE POSITIVE   │
│ identity = diff │               │ Score: UNLIKELY/SAFE    │
│ result?         │               └─────────────────────────┘
└─────────────────┘
        │
       YES
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│ Q3: Impact demonstrated?                                    │
│     (Read sensitive data / Write / Delete / Execute)        │
└─────────────────────────────────────────────────────────────┘
        │                                    │
       YES                                  NO
        │                                    │
        ▼                                    ▼
┌─────────────────┐               ┌─────────────────────────┐
│ CONFIRMED       │               │ PROBABLE                │
│ Score: 90-100   │               │ Score: 70-89            │
└─────────────────┘               └─────────────────────────┘
```

---

## Report Requirements by Confidence Level

### CONFIRMED (90-100)
Must include:
- [ ] Before state with timestamp
- [ ] Exact request (headers, body)
- [ ] Exact response (status, body)
- [ ] After state with timestamp
- [ ] Cross-identity verification
- [ ] Impact demonstration

### PROBABLE (70-89)
Must include:
- [ ] Initial observation
- [ ] Partial verification results
- [ ] What remains unverified
- [ ] Recommended next steps

### POSSIBLE (50-69)
Must include:
- [ ] Indicators observed
- [ ] Why verification incomplete
- [ ] Blockers encountered
- [ ] Investigation suggestions

---

## Anti-Patterns (Never Do This)

| Pattern | Why It's Wrong | Correct Approach |
|---------|----------------|------------------|
| HTTP 200 → CONFIRMED | Status ≠ success | Verify state change |
| "Looks vulnerable" | Subjective | Measure and compare |
| Single test → conclusion | Insufficient | Cross-identity verify |
| Assume worst case | Speculation | Prove impact |
| Skip Before/After | No baseline | Always capture state |

---

## Integration with Other Skills

This confidence system integrates with:
- [Deep Verification](./DEEP_VERIFICATION.md) - 5-step verification flow
- [Vulnerability-Specific Verification](./VULN_SPECIFIC_VERIFICATION.md) - Per-vuln methods
- [IDOR Testing](../auth-testing/IDOR.md) - Write operation verification
