# Strix Security - 云端部署架构

## 概述

将 strix-security 从本地扩展到云端，为用户提供 SaaS 化的安全测试服务。

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          用户接入层                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   │
│  │   Web UI     │  │  Claude Code │  │    CLI       │                   │
│  │  Dashboard   │  │   Plugin     │  │  strix-cli   │                   │
│  └──────────────┘  └──────────────┘  └──────────────┘                   │
│         │                 │                 │                            │
│         └─────────────────┼─────────────────┘                            │
│                           ▼                                              │
├─────────────────────────────────────────────────────────────────────────┤
│                       API Gateway                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  - JWT 认证 / API Key                                                ││
│  │  - 速率限制 (按用户/套餐)                                             ││
│  │  - 请求路由 (REST / WebSocket / MCP)                                 ││
│  │  - 用量计量 (按扫描次数/时长)                                         ││
│  └─────────────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────────────┤
│                       核心服务层                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │   Scan Manager  │  │  MCP Gateway    │  │   Report Gen    │         │
│  │   扫描调度器    │  │  MCP 协议网关   │  │   报告生成器    │         │
│  │                 │  │                 │  │                 │         │
│  │  - 任务队列     │  │  - WebSocket    │  │  - CVSS 计算    │         │
│  │  - 优先级调度   │  │  - SSE 支持     │  │  - PDF 导出     │         │
│  │  - 并发控制     │  │  - 工具路由     │  │  - 合规报告     │         │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘         │
│           │                   │                   │                     │
│           └───────────────────┼───────────────────┘                     │
│                               ▼                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                      沙箱执行层 (Kubernetes)                             │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                     Sandbox Pool                                     ││
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐        ││
│  │  │ Sandbox-1 │  │ Sandbox-2 │  │ Sandbox-3 │  │ Sandbox-N │        ││
│  │  │  User A   │  │  User B   │  │  User C   │  │    ...    │        ││
│  │  │           │  │           │  │           │  │           │        ││
│  │  │ Browser   │  │ Browser   │  │ Browser   │  │ Browser   │        ││
│  │  │ Proxy     │  │ Proxy     │  │ Proxy     │  │ Proxy     │        ││
│  │  │ Python    │  │ Python    │  │ Python    │  │ Python    │        ││
│  │  │ Terminal  │  │ Terminal  │  │ Terminal  │  │ Terminal  │        ││
│  │  └───────────┘  └───────────┘  └───────────┘  └───────────┘        ││
│  │                                                                      ││
│  │  特性:                                                               ││
│  │  - 每用户/任务独立容器                                                ││
│  │  - 网络隔离 (Network Policy)                                         ││
│  │  - 资源限制 (CPU/Memory Quotas)                                      ││
│  │  - 自动扩缩容 (HPA)                                                  ││
│  │  - 空闲超时回收                                                       ││
│  └─────────────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────────────┤
│                         数据持久层                                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │   PostgreSQL    │  │      S3         │  │     Redis       │         │
│  │                 │  │                 │  │                 │         │
│  │  - 用户账户     │  │  - 扫描报告     │  │  - 会话缓存     │         │
│  │  - 项目配置     │  │  - 截图/日志    │  │  - 任务队列     │         │
│  │  - 漏洞数据     │  │  - 导出文件     │  │  - 速率限制     │         │
│  │  - 审计日志     │  │  - 备份归档     │  │  - MCP 状态     │         │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## MCP over WebSocket 协议

### 连接流程

```
Client (Claude Code)                           Server (Strix Cloud)
        │                                              │
        │  1. WebSocket Connect                        │
        │  wss://api.strix.security/mcp               │
        │─────────────────────────────────────────────>│
        │                                              │
        │  2. Authentication                           │
        │  {"type": "auth", "token": "sk-xxx"}        │
        │─────────────────────────────────────────────>│
        │                                              │
        │  3. Auth Response                            │
        │  {"type": "auth_ok", "user_id": "..."}      │
        │<─────────────────────────────────────────────│
        │                                              │
        │  4. MCP Initialize                           │
        │  {"jsonrpc": "2.0", "method": "initialize"} │
        │─────────────────────────────────────────────>│
        │                                              │
        │  5. Tool List                                │
        │  {"result": {"tools": [...]}}               │
        │<─────────────────────────────────────────────│
        │                                              │
        │  6. Tool Call                                │
        │  {"method": "tools/call", "params": {...}}  │
        │─────────────────────────────────────────────>│
        │                                              │
        │           [Sandbox Execution]                │
        │                                              │
        │  7. Tool Result                              │
        │  {"result": {...}}                          │
        │<─────────────────────────────────────────────│
```

### 协议消息格式

```typescript
// 认证消息
interface AuthMessage {
  type: "auth";
  token: string;  // API Key 或 JWT
}

// MCP 消息 (JSON-RPC 2.0)
interface MCPRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// 进度通知 (SSE 或 WebSocket)
interface ProgressNotification {
  type: "progress";
  task_id: string;
  status: "running" | "completed" | "failed";
  progress: number;  // 0-100
  message: string;
}
```

---

## API 设计

### RESTful API

```yaml
# OpenAPI 3.0
openapi: 3.0.3
info:
  title: Strix Security API
  version: 1.0.0

paths:
  /api/v1/scans:
    post:
      summary: 创建安全扫描任务
      security:
        - bearerAuth: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [target]
              properties:
                target:
                  type: string
                  description: 目标 URL 或 GitHub repo
                scan_type:
                  type: string
                  enum: [quick, full, stealth, custom]
                  default: quick
                modules:
                  type: array
                  items:
                    type: string
                    enum: [recon, auth, injection, logic, api, platform]
      responses:
        "202":
          description: 任务已创建
          content:
            application/json:
              schema:
                type: object
                properties:
                  scan_id:
                    type: string
                    format: uuid
                  status:
                    type: string
                    enum: [queued, running, completed, failed]
                  websocket_url:
                    type: string
                    description: 实时进度 WebSocket

  /api/v1/scans/{scan_id}:
    get:
      summary: 获取扫描状态和结果
      parameters:
        - name: scan_id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: 扫描详情
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ScanResult"

  /api/v1/scans/{scan_id}/findings:
    get:
      summary: 获取漏洞发现列表
      parameters:
        - name: severity
          in: query
          schema:
            type: string
            enum: [CRITICAL, HIGH, MEDIUM, LOW, INFO]
      responses:
        "200":
          description: 漏洞列表

  /api/v1/scans/{scan_id}/report:
    get:
      summary: 下载扫描报告
      parameters:
        - name: format
          in: query
          schema:
            type: string
            enum: [markdown, html, pdf, sarif]
            default: markdown
      responses:
        "200":
          description: 报告文件

  /api/v1/mcp:
    description: MCP over WebSocket 端点
    # WebSocket 升级

components:
  schemas:
    ScanResult:
      type: object
      properties:
        scan_id:
          type: string
        status:
          type: string
        target:
          type: string
        started_at:
          type: string
          format: date-time
        completed_at:
          type: string
          format: date-time
        findings_count:
          type: object
          properties:
            critical:
              type: integer
            high:
              type: integer
            medium:
              type: integer
            low:
              type: integer

  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

---

## 定价模型

### 套餐设计

| 套餐 | 价格 | 扫描次数 | 并发沙箱 | 功能 |
|------|------|---------|---------|------|
| Free | $0/月 | 3 次/月 | 1 | 基础扫描 |
| Pro | $49/月 | 50 次/月 | 3 | 全部模块 + 报告导出 |
| Team | $199/月 | 200 次/月 | 10 | 团队协作 + API 访问 |
| Enterprise | 定制 | 无限 | 无限 | 私有部署 + SLA |

### 计费指标

- **扫描次数**: 每次完整扫描计费
- **沙箱时长**: 按分钟计费 (超时自动回收)
- **存储用量**: 报告/日志按 GB 计费
- **API 调用**: MCP 工具调用按次计费

---

## 安全考虑

### 沙箱隔离

```yaml
# Kubernetes NetworkPolicy
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: sandbox-isolation
spec:
  podSelector:
    matchLabels:
      app: sandbox
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: mcp-gateway
  egress:
    - to: []  # 允许访问互联网 (扫描目标)
    - to:
        - namespaceSelector:
            matchLabels:
              name: kube-system
      ports:
        - port: 53  # DNS
```

### 目标授权验证

1. **域名验证**: DNS TXT 记录或 HTML meta 标签
2. **IP 验证**: 反向 DNS 或 WHOIS 验证
3. **GitHub 验证**: OAuth 授权确认仓库所有权

### 数据加密

- **传输中**: TLS 1.3
- **静态**: AES-256-GCM
- **密钥管理**: AWS KMS / HashiCorp Vault

---

## 部署架构

### Kubernetes 部署

```yaml
# 核心组件
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-gateway
spec:
  replicas: 3
  selector:
    matchLabels:
      app: mcp-gateway
  template:
    spec:
      containers:
        - name: mcp-gateway
          image: strix/mcp-gateway:latest
          ports:
            - containerPort: 8080
          env:
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: strix-secrets
                  key: redis-url
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: strix-secrets
                  key: database-url
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "500m"

---
# 沙箱池 (动态创建)
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: sandbox-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: sandbox-pool
  minReplicas: 2
  maxReplicas: 100
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

---

## 实施路线图

### Phase 1: MVP (4 周)

- [ ] MCP WebSocket Gateway 实现
- [ ] 基础 API 端点 (创建扫描、获取结果)
- [ ] 沙箱容器池管理
- [ ] 简单 Web Dashboard

### Phase 2: 商业化 (4 周)

- [ ] 用户认证系统 (Auth0/Clerk)
- [ ] Stripe 集成 (订阅 + 用量计费)
- [ ] 扫描历史和报告存储
- [ ] 团队协作功能

### Phase 3: 企业功能 (持续)

- [ ] SSO 集成 (SAML/OIDC)
- [ ] 合规报告 (SOC2, PCI-DSS)
- [ ] 私有部署选项
- [ ] SLA 保证

---

## 技术选型

| 组件 | 选择 | 原因 |
|------|------|------|
| 容器编排 | Kubernetes (EKS/GKE) | 弹性伸缩、隔离性 |
| API Gateway | Kong / AWS API Gateway | 成熟、插件丰富 |
| 任务队列 | Redis Streams | 简单可靠、支持优先级 |
| 数据库 | PostgreSQL | 关系型、pgvector 支持 |
| 对象存储 | S3 | 成本低、CDN 集成 |
| 实时通信 | WebSocket + SSE | MCP 协议 + 进度推送 |
| 监控 | Prometheus + Grafana | 开源、可观测性 |
| 日志 | ELK / Loki | 审计追踪 |
