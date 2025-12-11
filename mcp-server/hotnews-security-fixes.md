# HotNews AI 安全漏洞修复指南

**生成时间**: 2025-12-10
**目标系统**: http://148.135.56.115/
**测试工具**: strix-sandbox MCP + Python 运行时深度测试

---

## 漏洞概览

| 优先级 | 漏洞 | 严重级别 | 状态 |
|--------|------|----------|------|
| P0 | 弱管理员凭据 | CRITICAL | 待修复 |
| P0 | 速率限制绕过 | HIGH | 待修复 |
| P1 | IDOR 用户数据枚举 | HIGH | 待修复 |
| P1 | 竞态条件 (浏览计数) | MEDIUM | 待修复 |
| P2 | 计时攻击 | MEDIUM | 待修复 |
| P2 | 安全响应头缺失 | LOW | 待修复 |
| ✅ | X-User-Id 认证绕过 | CRITICAL | 已修复 |
| ✅ | 存储型 XSS | HIGH | 已修复 |

---

## P0 - 紧急修复 (立即处理)

### 1. 弱管理员凭据

**漏洞描述**:
管理员账户使用弱密码 `admin123`，可被轻易猜测或暴力破解。

**复现步骤**:
```bash
curl -X POST http://148.135.56.115/api/v1/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'
```

**修复方案**:

#### 方案 A: 立即更改密码

```python
# api/routes/admin_auth.py 或数据库直接操作

import hashlib
import secrets

# 生成强密码
new_password = secrets.token_urlsafe(16)  # 例如: "Kx9mP2vL8nQ5wR3t"
print(f"新管理员密码: {new_password}")

# 使用 bcrypt 替代 SHA-256
import bcrypt
hashed = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt())

# 更新数据库
# UPDATE admins SET password_hash = '{hashed}' WHERE username = 'admin';
```

#### 方案 B: 实施密码策略

```python
# api/utils/password_policy.py

import re

def validate_password(password: str) -> tuple[bool, str]:
    """
    密码策略:
    - 最少 12 字符
    - 包含大小写字母
    - 包含数字
    - 包含特殊字符
    """
    if len(password) < 12:
        return False, "密码长度至少 12 字符"

    if not re.search(r'[A-Z]', password):
        return False, "需要包含大写字母"

    if not re.search(r'[a-z]', password):
        return False, "需要包含小写字母"

    if not re.search(r'\d', password):
        return False, "需要包含数字"

    if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        return False, "需要包含特殊字符"

    return True, "密码符合要求"
```

#### 方案 C: 使用 bcrypt 替代 SHA-256

```python
# api/routes/admin_auth.py

# 替换原有的 SHA-256 哈希
# 旧代码:
# password_hash = hashlib.sha256(password.encode()).hexdigest()

# 新代码:
import bcrypt

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())
```

---

### 2. 速率限制绕过

**漏洞描述**:
攻击者可通过伪造 `X-Forwarded-For` 或 `True-Client-IP` 头绕过速率限制。

**复现步骤**:
```bash
# 使用伪造 IP 绕过限制
for i in {1..100}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -H "X-Forwarded-For: 1.2.3.$i" \
    http://148.135.56.115/api/v1/news
done
# 结果: 全部 200，无 429
```

**修复方案**:

#### Nginx 配置修复

```nginx
# /etc/nginx/nginx.conf 或 sites-available/hotnews

http {
    # 设置真实 IP 来源 (根据你的部署环境调整)

    # 如果使用 Cloudflare
    set_real_ip_from 103.21.244.0/22;
    set_real_ip_from 103.22.200.0/22;
    set_real_ip_from 103.31.4.0/22;
    set_real_ip_from 104.16.0.0/13;
    set_real_ip_from 104.24.0.0/14;
    set_real_ip_from 108.162.192.0/18;
    set_real_ip_from 131.0.72.0/22;
    set_real_ip_from 141.101.64.0/18;
    set_real_ip_from 162.158.0.0/15;
    set_real_ip_from 172.64.0.0/13;
    set_real_ip_from 173.245.48.0/20;
    set_real_ip_from 188.114.96.0/20;
    set_real_ip_from 190.93.240.0/20;
    set_real_ip_from 197.234.240.0/22;
    set_real_ip_from 198.41.128.0/17;
    real_ip_header CF-Connecting-IP;

    # 如果不使用 CDN，只信任本地代理
    # set_real_ip_from 127.0.0.1;
    # set_real_ip_from 10.0.0.0/8;
    # real_ip_header X-Real-IP;

    # 关键: 忽略不信任来源的 X-Forwarded-For
    real_ip_recursive on;

    # 速率限制区域定义
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=60r/m;
    limit_req_zone $binary_remote_addr zone=auth_limit:10m rate=5r/m;

    server {
        # API 通用限制
        location /api/v1/ {
            limit_req zone=api_limit burst=20 nodelay;
            limit_req_status 429;

            proxy_pass http://backend;
        }

        # 认证端点严格限制
        location /api/v1/admin/auth/ {
            limit_req zone=auth_limit burst=3 nodelay;
            limit_req_status 429;

            proxy_pass http://backend;
        }
    }
}
```

#### FastAPI 层面加固

```python
# api/middleware/rate_limit.py

from slowapi import Limiter
from slowapi.util import get_remote_address
from fastapi import Request

def get_real_ip(request: Request) -> str:
    """
    获取真实客户端 IP
    只信任 nginx 设置的 X-Real-IP
    """
    # 优先使用 nginx 设置的真实 IP
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip

    # 回退到直连 IP
    return request.client.host if request.client else "unknown"

limiter = Limiter(key_func=get_real_ip)

# 在路由中使用
@app.get("/api/v1/news")
@limiter.limit("60/minute")
async def get_news(request: Request):
    ...

@app.post("/api/v1/admin/auth/login")
@limiter.limit("5/minute")
async def admin_login(request: Request):
    ...
```

---

## P1 - 高优先级修复

### 3. IDOR 用户数据枚举

**漏洞描述**:
管理员可通过遍历 UUID 获取任意用户数据，且返回敏感字段。

**复现步骤**:
```bash
# 获取 admin token
TOKEN=$(curl -s -X POST http://148.135.56.115/api/v1/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}' | jq -r '.token')

# 遍历用户 ID
curl -H "Authorization: Bearer $TOKEN" \
  http://148.135.56.115/api/v1/admin/users/00000000-0000-0000-0000-000000000001
# 返回: {"email": "user@example.com", ...}
```

**修复方案**:

```python
# api/routes/admin_users.py

from pydantic import BaseModel
from typing import Optional

# 定义返回模型，排除敏感字段
class UserResponse(BaseModel):
    id: str
    username: str
    is_active: bool
    is_admin: bool
    created_at: datetime
    # 不包含: email, password_hash, salt 等

class UserDetailResponse(UserResponse):
    """仅超级管理员可见的详细信息"""
    email: str
    subscription_tier: str
    total_api_calls: int
    last_login_at: Optional[datetime]

@router.get("/admin/users/{user_id}")
async def get_user(
    user_id: str,
    current_admin: Admin = Depends(get_current_admin)
):
    user = await get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # 权限检查: 只有超级管理员才能看完整信息
    if current_admin.is_super_admin:
        return UserDetailResponse(**user.dict())
    else:
        return UserResponse(**user.dict())

# 添加审计日志
@router.get("/admin/users")
async def list_users(
    current_admin: Admin = Depends(get_current_admin),
    request: Request
):
    # 记录访问日志
    await audit_log.create(
        action="list_users",
        admin_id=current_admin.id,
        ip_address=request.client.host,
        timestamp=datetime.utcnow()
    )
    ...
```

---

### 4. 竞态条件 (浏览计数)

**漏洞描述**:
并发请求导致浏览计数丢失，20 次并发请求仅增加 0-1 次。

**复现步骤**:
```python
import httpx
import concurrent.futures

def send_view():
    return httpx.post(f'{BASE_URL}/api/v1/news/{news_id}/view').status_code

with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
    futures = [executor.submit(send_view) for _ in range(20)]
    # 结果: view_count 仅增加 0-1
```

**修复方案**:

#### 方案 A: 使用原子 SQL 操作

```python
# api/routes/news.py

@router.post("/news/{news_id}/view")
async def track_view(news_id: str):
    # 错误做法 (竞态条件):
    # news = await get_news(news_id)
    # news.view_count += 1
    # await save_news(news)

    # 正确做法 - 原子操作:
    result = await db.execute(
        """
        UPDATE news
        SET view_count = view_count + 1
        WHERE id = :news_id
        RETURNING view_count
        """,
        {"news_id": news_id}
    )

    return {"success": True, "view_count": result.scalar()}
```

#### 方案 B: 使用 Supabase RPC

```sql
-- Supabase SQL Editor 中创建函数

CREATE OR REPLACE FUNCTION increment_view_count(news_id UUID)
RETURNS INTEGER AS $$
DECLARE
    new_count INTEGER;
BEGIN
    UPDATE news
    SET view_count = view_count + 1
    WHERE id = news_id
    RETURNING view_count INTO new_count;

    RETURN new_count;
END;
$$ LANGUAGE plpgsql;
```

```python
# api/routes/news.py

@router.post("/news/{news_id}/view")
async def track_view(news_id: str):
    result = await supabase.rpc(
        "increment_view_count",
        {"news_id": news_id}
    ).execute()

    return {"success": True, "view_count": result.data}
```

#### 方案 C: 使用 Redis 计数器 (高并发场景)

```python
# api/routes/news.py

import redis.asyncio as redis

redis_client = redis.from_url("redis://localhost:6379")

@router.post("/news/{news_id}/view")
async def track_view(news_id: str):
    # Redis 原子递增
    key = f"news:views:{news_id}"
    new_count = await redis_client.incr(key)

    # 异步同步到数据库 (每 100 次或每分钟)
    if new_count % 100 == 0:
        await sync_views_to_db(news_id, new_count)

    return {"success": True, "view_count": new_count}
```

---

## P2 - 中优先级修复

### 5. 计时攻击

**漏洞描述**:
登录响应时间因用户名是否存在而不同，可用于枚举有效用户名。

**修复方案**:

```python
# api/routes/admin_auth.py

import bcrypt
import secrets
import time

# 预计算一个假哈希，用于不存在的用户
DUMMY_HASH = bcrypt.hashpw(b"dummy_password", bcrypt.gensalt())

@router.post("/admin/auth/login")
async def admin_login(credentials: LoginRequest):
    start_time = time.time()

    # 查询用户
    admin = await get_admin_by_username(credentials.username)

    if admin:
        # 用户存在，验证密码
        password_valid = bcrypt.checkpw(
            credentials.password.encode(),
            admin.password_hash.encode()
        )
    else:
        # 用户不存在，仍然执行哈希比较以保持时间一致
        bcrypt.checkpw(credentials.password.encode(), DUMMY_HASH)
        password_valid = False

    # 确保响应时间一致 (最少 200ms)
    elapsed = time.time() - start_time
    if elapsed < 0.2:
        await asyncio.sleep(0.2 - elapsed)

    if not password_valid:
        # 统一错误消息，不透露用户是否存在
        raise HTTPException(
            status_code=401,
            detail="Invalid username or password"
        )

    # 生成 token...
    return {"token": token}
```

---

### 6. 安全响应头缺失

**漏洞描述**:
缺少 HSTS、CSP、Referrer-Policy、Permissions-Policy 等安全头。

**修复方案**:

#### Nginx 配置

```nginx
# /etc/nginx/sites-available/hotnews

server {
    listen 80;
    server_name 148.135.56.115;

    # 强制 HTTPS (如果启用了 SSL)
    # return 301 https://$server_name$request_uri;

    # 安全响应头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;

    # CSP - 根据实际需求调整
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://api.openai.com https://*.supabase.co;" always;

    # HSTS (仅在启用 HTTPS 后添加)
    # add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # 隐藏服务器版本
    server_tokens off;

    # 移除 X-Powered-By (在 Next.js 中配置)
    proxy_hide_header X-Powered-By;

    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api/ {
        proxy_pass http://localhost:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

#### Next.js 配置

```javascript
// next.config.js

module.exports = {
  poweredByHeader: false,  // 移除 X-Powered-By

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },
};
```

---

## 验证修复

修复完成后，运行以下命令验证:

```bash
# 1. 验证弱密码已更改
curl -X POST http://148.135.56.115/api/v1/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'
# 期望: 401 Unauthorized

# 2. 验证速率限制绕过已修复
for i in {1..20}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -H "X-Forwarded-For: 1.2.3.$i" \
    http://148.135.56.115/api/v1/news
done
# 期望: 部分请求返回 429

# 3. 验证安全头
curl -I http://148.135.56.115/ 2>/dev/null | grep -E "^(X-Frame|X-Content|Content-Security|Referrer|Permissions)"
# 期望: 显示所有安全头

# 4. 验证竞态条件 (需要 Python)
python3 -c "
import httpx
import concurrent.futures

BASE_URL = 'http://148.135.56.115'
resp = httpx.get(f'{BASE_URL}/api/v1/news?limit=1')
news_id = resp.json()['items'][0]['id']

initial = httpx.get(f'{BASE_URL}/api/v1/news/{news_id}').json()['view_count']

def send_view():
    return httpx.post(f'{BASE_URL}/api/v1/news/{news_id}/view', timeout=5).status_code

with concurrent.futures.ThreadPoolExecutor(max_workers=10) as e:
    list(e.map(lambda _: send_view(), range(10)))

final = httpx.get(f'{BASE_URL}/api/v1/news/{news_id}').json()['view_count']
print(f'Initial: {initial}, Final: {final}, Expected increase: 10, Actual: {final - initial}')
"
# 期望: Actual increase 接近 10
```

---

## 修复清单

- [ ] **P0** 更改管理员密码为强密码
- [ ] **P0** 实施 bcrypt 密码哈希
- [ ] **P0** 修复 nginx 真实 IP 检测
- [ ] **P0** 加固速率限制配置
- [ ] **P1** 限制 IDOR 返回字段
- [ ] **P1** 添加管理操作审计日志
- [ ] **P1** 修复浏览计数竞态条件
- [ ] **P2** 实施恒定时间密码验证
- [ ] **P2** 添加安全响应头
- [ ] **P2** 隐藏服务器版本信息

---

## 联系方式

如有问题，请联系安全团队或参考:
- OWASP Top 10: https://owasp.org/Top10/
- FastAPI Security: https://fastapi.tiangolo.com/tutorial/security/
- Nginx Rate Limiting: https://nginx.org/en/docs/http/ngx_http_limit_req_module.html
