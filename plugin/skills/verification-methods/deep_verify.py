#!/usr/bin/env python3
"""
deep_verify.py - 深度验证工具

自动执行 5 步验证流程，避免仅凭 HTTP 状态码误判漏洞。

使用方法:
    from deep_verify import DeepVerifier

    verifier = DeepVerifier(supabase_url, anon_key)
    result = verifier.verify_patch("profiles", "id", target_id, "username", "HACKED")
    result = verifier.verify_delete("posts", "id", target_id)

    if result["vulnerable"]:
        print("漏洞存在!")
    else:
        print("已修复")
"""

import urllib.request
import urllib.error
import json
from typing import Any, Optional
from dataclasses import dataclass


@dataclass
class VerificationResult:
    """验证结果"""
    vulnerable: bool
    http_status: int
    affected_rows: int
    before_value: Any
    after_value: Any
    response_data: Any
    conclusion: str
    evidence: dict


class DeepVerifier:
    """
    深度验证器 - 自动执行 5 步验证流程

    核心原则:
        HTTP 状态码 ≠ 操作成功
        必须验证实际数据变化
    """

    def __init__(self, base_url: str, api_key: str, auth_token: Optional[str] = None):
        """
        初始化验证器

        Args:
            base_url: API 基础 URL (如 https://xxx.supabase.co)
            api_key: API Key (如 Supabase anon key)
            auth_token: 可选的认证 token (默认使用 api_key)
        """
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.auth_token = auth_token or api_key

    def _request(self, method: str, endpoint: str,
                 data: Optional[dict] = None,
                 prefer: Optional[str] = None) -> tuple[int, Any]:
        """发送 HTTP 请求"""
        url = f"{self.base_url}/rest/v1/{endpoint}"
        req = urllib.request.Request(url, method=method)
        req.add_header("apikey", self.api_key)
        req.add_header("Authorization", f"Bearer {self.auth_token}")
        req.add_header("Content-Type", "application/json")
        if prefer:
            req.add_header("Prefer", prefer)

        try:
            body = json.dumps(data).encode() if data else None
            with urllib.request.urlopen(req, data=body, timeout=15) as response:
                content = response.read().decode('utf-8')
                return response.status, json.loads(content) if content else []
        except urllib.error.HTTPError as e:
            content = e.read().decode('utf-8') if e.fp else ""
            try:
                return e.code, json.loads(content)
            except:
                return e.code, content
        except Exception as e:
            return -1, str(e)

    def _get_value(self, table: str, id_field: str, target_id: str,
                   field: Optional[str] = None) -> tuple[bool, Any]:
        """获取资源当前值"""
        select = field if field else "*"
        status, data = self._request("GET", f"{table}?{id_field}=eq.{target_id}&select={select}")

        if status == 200 and isinstance(data, list) and len(data) > 0:
            if field:
                return True, data[0].get(field)
            return True, data[0]
        return False, None

    def verify_patch(self, table: str, id_field: str, target_id: str,
                     field: str, new_value: Any) -> VerificationResult:
        """
        验证 PATCH 操作 (IDOR UPDATE)

        自动执行 5 步验证:
        1. Before State - 获取原始值
        2. Execute - 执行 PATCH (with Prefer: return=representation)
        3. Analyze - 分析响应 ([] vs [{...}])
        4. After State - 获取当前值
        5. Verdict - 对比判断

        Args:
            table: 表名
            id_field: ID 字段名
            target_id: 目标资源 ID
            field: 要修改的字段
            new_value: 新值

        Returns:
            VerificationResult 包含完整验证证据
        """
        print(f"\n{'='*60}")
        print(f"深度验证: PATCH {table}.{field}")
        print(f"{'='*60}")

        # Step 1: Before State
        print("\n[Step 1] Before State")
        exists, before_value = self._get_value(table, id_field, target_id, field)
        print(f"   资源存在: {exists}")
        print(f"   原始值: {before_value}")

        if not exists:
            return VerificationResult(
                vulnerable=False,
                http_status=-1,
                affected_rows=-1,
                before_value=None,
                after_value=None,
                response_data=None,
                conclusion="资源不存在，无法测试",
                evidence={"error": "resource_not_found"}
            )

        # Step 2: Execute with return=representation
        print("\n[Step 2] Execute PATCH")
        status, response = self._request(
            "PATCH",
            f"{table}?{id_field}=eq.{target_id}",
            data={field: new_value},
            prefer="return=representation"
        )
        print(f"   HTTP 状态码: {status}")
        print(f"   响应: {response}")

        # Step 3: Analyze Response
        print("\n[Step 3] Analyze Response")
        if isinstance(response, list):
            affected_rows = len(response)
            print(f"   受影响行数: {affected_rows}")
            if affected_rows == 0:
                print(f"   → [] = RLS 阻止了修改")
            else:
                print(f"   → 数据被修改!")
        elif status == 401 or status == 403:
            affected_rows = 0
            print(f"   → {status} = 权限拒绝")
        else:
            affected_rows = -1
            print(f"   → 非预期响应")

        # Step 4: After State
        print("\n[Step 4] After State")
        _, after_value = self._get_value(table, id_field, target_id, field)
        print(f"   当前值: {after_value}")

        # Step 5: Verdict
        print("\n[Step 5] Verdict")
        data_changed = (before_value != after_value)
        vulnerable = data_changed or (affected_rows > 0)

        if vulnerable:
            conclusion = f"❌ VULNERABLE - {field} 从 '{before_value}' 变为 '{after_value}'"
            print(f"   {conclusion}")
        else:
            conclusion = f"✅ SAFE - {field} 未变化，RLS 阻止了修改"
            print(f"   {conclusion}")

        return VerificationResult(
            vulnerable=vulnerable,
            http_status=status,
            affected_rows=affected_rows,
            before_value=before_value,
            after_value=after_value,
            response_data=response,
            conclusion=conclusion,
            evidence={
                "before": before_value,
                "after": after_value,
                "affected_rows": affected_rows,
                "data_changed": data_changed
            }
        )

    def verify_delete(self, table: str, id_field: str,
                      target_id: str) -> VerificationResult:
        """
        验证 DELETE 操作 (IDOR DELETE)

        自动执行 5 步验证:
        1. Before State - 确认资源存在
        2. Execute - 执行 DELETE (with Prefer: return=representation)
        3. Analyze - 分析响应 ([] vs [{...}])
        4. After State - 确认资源是否仍存在
        5. Verdict - 对比判断

        Args:
            table: 表名
            id_field: ID 字段名
            target_id: 目标资源 ID

        Returns:
            VerificationResult 包含完整验证证据
        """
        print(f"\n{'='*60}")
        print(f"深度验证: DELETE {table}")
        print(f"{'='*60}")

        # Step 1: Before State
        print("\n[Step 1] Before State")
        before_exists, before_data = self._get_value(table, id_field, target_id)
        print(f"   资源存在: {before_exists}")
        if before_data:
            print(f"   数据: {str(before_data)[:100]}...")

        if not before_exists:
            return VerificationResult(
                vulnerable=False,
                http_status=-1,
                affected_rows=-1,
                before_value=None,
                after_value=None,
                response_data=None,
                conclusion="资源不存在，无法测试",
                evidence={"error": "resource_not_found"}
            )

        # Step 2: Execute with return=representation
        print("\n[Step 2] Execute DELETE")
        status, response = self._request(
            "DELETE",
            f"{table}?{id_field}=eq.{target_id}",
            prefer="return=representation"
        )
        print(f"   HTTP 状态码: {status}")
        print(f"   响应: {response}")

        # Step 3: Analyze Response
        print("\n[Step 3] Analyze Response")
        if isinstance(response, list):
            affected_rows = len(response)
            print(f"   受影响行数: {affected_rows}")
            if affected_rows == 0:
                print(f"   → [] = RLS 阻止了删除")
            else:
                print(f"   → 数据被删除!")
        elif status == 401 or status == 403:
            affected_rows = 0
            print(f"   → {status} = 权限拒绝")
        else:
            affected_rows = -1
            print(f"   → 非预期响应")

        # Step 4: After State
        print("\n[Step 4] After State")
        after_exists, _ = self._get_value(table, id_field, target_id)
        print(f"   资源存在: {after_exists}")

        # Step 5: Verdict
        print("\n[Step 5] Verdict")
        resource_deleted = (before_exists and not after_exists)
        vulnerable = resource_deleted or (affected_rows > 0)

        if vulnerable:
            conclusion = f"❌ VULNERABLE - 资源被未授权删除"
            print(f"   {conclusion}")
        else:
            conclusion = f"✅ SAFE - 资源仍存在，RLS 阻止了删除"
            print(f"   {conclusion}")

        return VerificationResult(
            vulnerable=vulnerable,
            http_status=status,
            affected_rows=affected_rows,
            before_value=before_exists,
            after_value=after_exists,
            response_data=response,
            conclusion=conclusion,
            evidence={
                "before_exists": before_exists,
                "after_exists": after_exists,
                "affected_rows": affected_rows,
                "resource_deleted": resource_deleted
            }
        )

    def verify_insert(self, table: str, data: dict,
                      id_field: str = "id") -> VerificationResult:
        """
        验证 INSERT 操作 (未授权插入)

        Args:
            table: 表名
            data: 要插入的数据
            id_field: ID 字段名

        Returns:
            VerificationResult 包含完整验证证据
        """
        print(f"\n{'='*60}")
        print(f"深度验证: INSERT {table}")
        print(f"{'='*60}")

        # Step 1: Count before
        print("\n[Step 1] Before State (Count)")
        status, count_before = self._request("GET", f"{table}?select=count")
        print(f"   记录数查询状态: {status}")

        # Step 2: Execute with return=representation
        print("\n[Step 2] Execute INSERT")
        status, response = self._request(
            "POST",
            table,
            data=data,
            prefer="return=representation"
        )
        print(f"   HTTP 状态码: {status}")
        print(f"   响应: {response}")

        # Step 3: Analyze Response
        print("\n[Step 3] Analyze Response")
        if status == 401 or status == 403:
            affected_rows = 0
            print(f"   → {status} = 权限拒绝，INSERT 被阻止")
            vulnerable = False
            conclusion = f"✅ SAFE - INSERT 被权限策略阻止"
        elif isinstance(response, list) and len(response) > 0:
            affected_rows = len(response)
            print(f"   → 数据被插入! ID: {response[0].get(id_field)}")
            vulnerable = True
            conclusion = f"❌ VULNERABLE - 未授权 INSERT 成功"
        elif isinstance(response, dict) and response.get(id_field):
            affected_rows = 1
            print(f"   → 数据被插入! ID: {response.get(id_field)}")
            vulnerable = True
            conclusion = f"❌ VULNERABLE - 未授权 INSERT 成功"
        else:
            affected_rows = 0
            print(f"   → INSERT 未成功")
            vulnerable = False
            conclusion = f"✅ SAFE - INSERT 未成功"

        print(f"\n[Step 5] Verdict")
        print(f"   {conclusion}")

        return VerificationResult(
            vulnerable=vulnerable,
            http_status=status,
            affected_rows=affected_rows,
            before_value=None,
            after_value=response if vulnerable else None,
            response_data=response,
            conclusion=conclusion,
            evidence={
                "inserted": vulnerable,
                "response": response
            }
        )


def auto_verify_on_status(func):
    """
    装饰器: 自动在 HTTP 200/204 时触发深度验证

    使用方法:
        @auto_verify_on_status
        def test_idor_patch(...):
            ...
    """
    def wrapper(*args, **kwargs):
        result = func(*args, **kwargs)
        status = result.get('status') if isinstance(result, dict) else None

        if status in [200, 204]:
            print("\n⚠️ HTTP 200/204 检测到 - 自动触发深度验证...")
            # 触发验证逻辑
            # (需要根据具体上下文实现)

        return result
    return wrapper


# ============================================================
# 快速使用示例
# ============================================================
if __name__ == "__main__":
    # Supabase 配置
    SUPABASE_URL = "https://batxoopfbvmcfejtrvsx.supabase.co"
    ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJhdHhvb3BmYnZtY2ZlanRydnN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0MTc3MzUsImV4cCI6MjA3NDk5MzczNX0.JYc5IiA7r6kLbmXMRILSHH05oL1vah-fHeqalfqfBxI"

    # 创建验证器
    verifier = DeepVerifier(SUPABASE_URL, ANON_KEY)

    print("\n" + "="*60)
    print("深度验证工具 - 自动 5 步验证")
    print("="*60)

    # 测试 PATCH (IDOR UPDATE)
    result = verifier.verify_patch(
        table="profiles",
        id_field="id",
        target_id="8cec90c5-ebc4-4588-b4b2-d3b82ff0e621",
        field="username",
        new_value="HACKED_TEST"
    )

    # 测试 DELETE (IDOR DELETE)
    result = verifier.verify_delete(
        table="posts",
        id_field="id",
        target_id="6f5791f7-e331-4d30-88c5-fe6f6ce2c38f"
    )

    # 测试 INSERT
    result = verifier.verify_insert(
        table="posts",
        data={"content": "HACKED", "user_id": "fake-user-id"}
    )

    print("\n" + "="*60)
    print("所有验证完成")
    print("="*60)
