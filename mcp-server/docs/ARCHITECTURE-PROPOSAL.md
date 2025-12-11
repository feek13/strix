# Strix Security Testing Architecture Proposal

## 目标

让 Claude Code 能够像使用 `@agent-feature-dev` 一样，通过 `@agent-security` 进行安全测试。

---

## 架构设计

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Claude Code                                   │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  @agent-security:penetration-tester                            │ │
│  │  @agent-security:code-auditor                                  │ │
│  │  @agent-security:vulnerability-scanner                         │ │
│  └────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 1: Security Skills (Workflow Orchestration)                   │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │
│  │ recon.md    │ │ auth.md     │ │ injection.md│ │ reporting.md│   │
│  │ 侦察流程    │ │ 认证测试    │ │ 注入测试    │ │ 报告生成    │   │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 2: Strix MCP (High-Level Security Tools)                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ scan_target()     - 自动侦察目标                               ││
│  │ test_auth()       - 认证漏洞测试套件                           ││
│  │ test_injection()  - 注入漏洞测试套件                           ││
│  │ generate_report() - 生成安全报告                               ││
│  │ exploit()         - 验证漏洞可利用性                           ││
│  └─────────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────────┤
│  Layer 3: Sandbox Runtime (Low-Level Primitives)                     │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐       │
│  │ browser    │ │ proxy      │ │ terminal   │ │ python     │       │
│  │ automation │ │ intercept  │ │ commands   │ │ execution  │       │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘       │
├─────────────────────────────────────────────────────────────────────┤
│  Docker Container (Isolated Environment)                             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 实现方案

### 方案 A: Claude Code Plugin (推荐)

创建一个 Claude Code 插件，整合 Skills + MCP:

```
strix-security/
├── plugin.json                 # 插件配置
├── agents/
│   ├── penetration-tester.md   # Agent 定义
│   ├── code-auditor.md
│   └── vulnerability-scanner.md
├── skills/
│   ├── recon.md               # 侦察技能
│   ├── auth-testing.md        # 认证测试技能
│   ├── injection-testing.md   # 注入测试技能
│   ├── logic-testing.md       # 逻辑漏洞技能
│   └── reporting.md           # 报告生成技能
├── commands/
│   ├── security-scan.md       # /security-scan 命令
│   ├── pentest.md             # /pentest 命令
│   └── audit.md               # /audit 命令
└── mcp/
    └── strix-sandbox/         # MCP server 集成
```

**plugin.json 示例:**

```json
{
  "name": "strix-security",
  "version": "1.0.0",
  "description": "AI-powered security testing framework",
  "agents": {
    "penetration-tester": {
      "description": "Autonomous penetration testing agent",
      "tools": ["strix-sandbox/*"],
      "skills": ["recon", "auth-testing", "injection-testing"]
    },
    "code-auditor": {
      "description": "Source code security auditor",
      "tools": ["Read", "Grep", "Glob"],
      "skills": ["code-review", "vulnerability-detection"]
    },
    "vulnerability-scanner": {
      "description": "Automated vulnerability scanner",
      "tools": ["strix-sandbox/*"],
      "skills": ["scanning", "fingerprinting"]
    }
  },
  "commands": {
    "/security-scan": "commands/security-scan.md",
    "/pentest": "commands/pentest.md",
    "/audit": "commands/audit.md"
  },
  "mcp_servers": {
    "strix-sandbox": {
      "command": "docker",
      "args": ["compose", "-f", "docker-compose.yml", "exec", "sandbox", "python", "-m", "strix_sandbox"]
    }
  }
}
```

### 方案 B: 增强 MCP Server

将高级安全测试流程封装为 MCP 工具:

```python
# strix_sandbox/tools/security_workflows.py

@tool
async def scan_target(
    target: str,
    scan_type: Literal["quick", "full", "stealth"] = "quick"
) -> ScanResult:
    """
    对目标进行自动化安全侦察

    自动执行:
    1. 端点枚举
    2. 技术指纹识别
    3. 信息泄露检测
    4. 攻击面映射
    """
    # 编排多个低级工具
    sandbox = await create_sandbox(with_proxy=True, with_browser=True)

    # 自动化侦察流程
    endpoints = await enumerate_endpoints(sandbox, target)
    fingerprints = await fingerprint_tech(sandbox, target)
    leaks = await detect_info_leaks(sandbox, target)

    return ScanResult(
        endpoints=endpoints,
        fingerprints=fingerprints,
        leaks=leaks,
        attack_surface=build_attack_surface(endpoints, fingerprints)
    )


@tool
async def test_vulnerability(
    target: str,
    vuln_type: Literal["sqli", "xss", "auth_bypass", "idor", "ssrf"],
    endpoint: str,
    params: dict
) -> VulnTestResult:
    """
    测试特定漏洞类型

    自动执行:
    1. 生成测试 payload
    2. 发送测试请求
    3. 分析响应
    4. 验证漏洞
    5. 生成 PoC
    """
    payloads = generate_payloads(vuln_type)
    results = []

    for payload in payloads:
        response = await send_test_request(target, endpoint, params, payload)
        analysis = analyze_response(response, vuln_type)

        if analysis.is_vulnerable:
            poc = generate_poc(target, endpoint, payload)
            results.append(VulnFinding(
                type=vuln_type,
                severity=analysis.severity,
                evidence=analysis.evidence,
                poc=poc
            ))

    return VulnTestResult(findings=results)


@tool
async def generate_security_report(
    findings: list[Finding],
    format: Literal["markdown", "html", "pdf", "sarif"] = "markdown"
) -> str:
    """
    生成安全测试报告

    包含:
    1. 执行摘要
    2. 漏洞详情
    3. 风险评估 (CVSS)
    4. 修复建议
    5. PoC 代码
    """
    # ...
```

### 方案 C: Skill + MCP 深度集成

创建 "Security Skill Pack":

```markdown
<!-- skills/security-testing.md -->

# Security Testing Skill

## 当调用此 Skill 时

你将获得以下能力:

### 可用 MCP 工具 (strix-sandbox)

| 工具 | 用途 | 示例 |
|------|------|------|
| `sandbox_create` | 创建隔离测试环境 | `sandbox_create(with_proxy=True)` |
| `browser_goto` | 浏览器导航 | `browser_goto(url="...")` |
| `proxy_send_request` | 发送自定义请求 | `proxy_send_request(method="POST", ...)` |
| `python_execute` | 执行 Python 代码 | `python_execute(code="...")` |
| `finding_create` | 记录发现 | `finding_create(severity="HIGH", ...)` |

### 测试流程

1. **侦察阶段**: 使用 `browser_goto` + `proxy_list_requests` 映射攻击面
2. **测试阶段**: 使用 `proxy_send_request` + `python_execute` 进行漏洞测试
3. **验证阶段**: 使用 `python_execute` 生成 PoC
4. **报告阶段**: 使用 `finding_create` + `finding_export` 生成报告

### 自动化测试模板

```python
# 速率限制绕过测试
async def test_rate_limit_bypass(target: str):
    headers_to_test = [
        'X-Forwarded-For',
        'X-Real-IP',
        'True-Client-IP'
    ]

    for header in headers_to_test:
        results = await concurrent_requests(
            target,
            count=50,
            headers={header: f'{i}.{i}.{i}.{i}' for i in range(50)}
        )

        if results['429'] == 0:
            await finding_create(
                title=f"Rate Limit Bypass via {header}",
                severity="HIGH",
                evidence=results
            )
```

## 使用示例

用户: "对 http://example.com 进行安全测试"

Claude 应该:
1. 调用 `sandbox_create(with_proxy=True, with_browser=True)`
2. 调用 `browser_goto(url="http://example.com")`
3. 执行侦察流程...
4. 执行漏洞测试...
5. 生成报告
```

---

## 云端部署架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Cloud Platform                               │
├─────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    API Gateway                                 │  │
│  │  - 认证/授权                                                   │  │
│  │  - 速率限制                                                    │  │
│  │  - 计费计量                                                    │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│  ┌───────────────────────────▼───────────────────────────────────┐  │
│  │                 Strix Orchestrator                             │  │
│  │  - 任务队列 (Redis/SQS)                                       │  │
│  │  - 沙箱调度                                                    │  │
│  │  - 结果聚合                                                    │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│  ┌───────────────────────────▼───────────────────────────────────┐  │
│  │              Sandbox Pool (Kubernetes)                         │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐             │  │
│  │  │Sandbox 1│ │Sandbox 2│ │Sandbox 3│ │Sandbox N│             │  │
│  │  │ User A  │ │ User B  │ │ User C  │ │   ...   │             │  │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘             │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│  ┌───────────────────────────▼───────────────────────────────────┐  │
│  │                    Data Layer                                  │  │
│  │  - PostgreSQL (用户/项目/报告)                                │  │
│  │  - S3 (报告文件/截图/日志)                                    │  │
│  │  - Redis (缓存/会话)                                          │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘

用户访问方式:
1. Web UI (dashboard.strix.security)
2. CLI (strix scan --target example.com)
3. API (POST /api/v1/scans)
4. Claude Code Plugin (MCP over WebSocket)
```

### 云端 API 设计

```yaml
# OpenAPI 3.0
paths:
  /api/v1/scans:
    post:
      summary: 创建安全扫描任务
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                target:
                  type: string
                  description: 目标 URL 或 GitHub repo
                scan_type:
                  enum: [quick, full, stealth, custom]
                modules:
                  type: array
                  items:
                    enum: [recon, auth, injection, logic, api]
      responses:
        202:
          description: 任务已创建
          content:
            application/json:
              schema:
                type: object
                properties:
                  scan_id: string
                  status: string
                  websocket_url: string  # 实时进度

  /api/v1/scans/{scan_id}/stream:
    get:
      summary: SSE 实时进度流

  /api/v1/mcp:
    websocket:
      summary: MCP over WebSocket (for Claude Code)
```

---

## 实施路线图

### Phase 1: 本地优化 (1-2 周)

1. 创建 `strix-security` Claude Code 插件
2. 定义 Agent 类型 (`penetration-tester`, `code-auditor`)
3. 编写 Security Skills (recon, auth, injection, reporting)
4. 集成现有 strix-sandbox-mcp

### Phase 2: MCP 增强 (2-3 周)

1. 添加高级安全测试工具到 MCP
2. 实现 `scan_target`, `test_vulnerability`, `generate_report`
3. 优化沙箱性能
4. 添加更多漏洞测试模块

### Phase 3: 云端 MVP (4-6 周)

1. 搭建 Kubernetes 集群
2. 实现 API Gateway + 认证
3. 实现沙箱调度器
4. 实现 MCP over WebSocket
5. 构建 Web Dashboard

### Phase 4: 商业化 (持续)

1. 计费系统
2. 团队协作功能
3. 合规报告 (SOC2, PCI-DSS)
4. 企业 SSO 集成

---

## 技术选型

| 组件 | 技术选择 | 原因 |
|------|---------|------|
| 容器编排 | Kubernetes | 弹性伸缩、隔离性 |
| API Gateway | Kong / AWS API Gateway | 成熟、插件丰富 |
| 任务队列 | Redis Streams / AWS SQS | 简单可靠 |
| 数据库 | PostgreSQL + pgvector | 存储报告 + 语义搜索 |
| 对象存储 | S3 / MinIO | 报告、截图 |
| 实时通信 | WebSocket / SSE | MCP 协议 + 进度推送 |
| 监控 | Prometheus + Grafana | 可观测性 |

---

## 安全考虑

1. **沙箱隔离**: 每个用户/任务独立容器，网络隔离
2. **目标授权**: 要求用户证明对目标的授权
3. **速率限制**: 防止滥用
4. **日志审计**: 记录所有操作
5. **数据加密**: 静态加密 + 传输加密
