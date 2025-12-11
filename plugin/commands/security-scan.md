---
description: 对目标进行自动化安全扫描，支持快速/完整/隐蔽模式
argument-hint: <target_url> [--type quick|full|stealth] [--modules recon,auth,injection,logic,api]
---

# /security-scan Command

对指定目标进行自动化安全扫描。

## 使用方式

```
/security-scan <target_url> [options]
```

## 参数

- `target_url`: 目标 URL 或 GitHub 仓库
- `--type`: 扫描类型 (quick|full|stealth)
- `--modules`: 启用的模块 (recon,auth,injection,logic,api)

## 示例

```
/security-scan http://example.com
/security-scan http://example.com --type full
/security-scan https://github.com/org/repo --modules auth,injection
```

## 执行流程

当用户调用此命令时，你应该：

### 1. 创建沙箱环境

```python
# 使用 strix-sandbox MCP
sandbox = await sandbox_create(
    name="security-scan",
    with_proxy=True,
    with_browser=True
)
```

### 2. 执行侦察

- 访问目标站点
- 收集所有请求/响应
- 生成站点地图
- 识别技术栈

### 3. 运行漏洞测试

根据 `--modules` 参数执行相应测试：

**recon**: 信息收集
- 端点枚举
- 目录扫描
- 技术指纹

**auth**: 认证测试
- 弱密码检测
- JWT 漏洞
- 会话管理

**injection**: 注入测试
- SQL 注入
- XSS
- 命令注入

**logic**: 业务逻辑
- 竞态条件
- IDOR
- 权限绕过

**api**: API 安全
- 速率限制
- 输入验证
- 响应泄露

### 4. 记录发现

```python
for vuln in findings:
    await finding_create(
        title=vuln.title,
        severity=vuln.severity,
        endpoint=vuln.endpoint,
        evidence=vuln.evidence,
        poc=vuln.poc,
        remediation=vuln.remediation
    )
```

### 5. 生成报告

```python
report = await finding_export(format="markdown")
```

### 6. 清理

```python
await sandbox_destroy(sandbox_id)
```

## 输出格式

扫描完成后，返回包含以下内容的报告：

1. **执行摘要**
   - 目标信息
   - 扫描时间
   - 发现统计

2. **漏洞详情**
   - 严重程度
   - 漏洞描述
   - 证据/PoC
   - 修复建议

3. **风险评估**
   - CVSS 评分
   - 业务影响

4. **下一步建议**
