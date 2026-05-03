# RBAC 权限系统设计

## 核心结论

1. **RBAC = 基于角色的访问控制** -- 用户关联角色，角色关联权限，用户间接获得权限
2. **核心模型：用户-角色-权限 三张表** -- 多对多关系，灵活可扩展
3. **菜单权限 + URL 权限 + 按钮权限 三级控制** -- 从页面到按钮粒度
4. **中间件做统一拦截** -- 每个请求自动校验权限，业务代码无需关心
5. **装饰器做细粒度控制** -- 角色检查、步骤权限检查

---

## 一、RBAC 是什么？

RBAC（Role-Based Access Control），基于角色的访问控制。

**核心思想：** 不直接给用户分配权限，而是通过"角色"这个中间层间接授权。

```
用户 → 角色 → 权限

张三 → 操作员 → 印刷开始、印刷完成
李四 → 老板   → 所有权限
王五 → 外调员 → 外调开始、外调完成
```

**为什么需要角色这一层？**
- 50 个用户、100 个权限，直接分配是 50×100 = 5000 条记录
- 有了角色层：5 个角色、100 条角色-权限映射、50 条用户-角色映射，总共 150 条

---

## 二、数据库模型设计

### 1. 基础 RBAC（五张表）

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│  用户表   │     │  角色表   │     │  权限表   │
│ UserInfo │     │  Role    │     │Permission│
└────┬─────┘     └────┬─────┘     └────┬─────┘
     │                │                │
     │ M2M            │ M2M            │
     └────────┬───────┘                │
              │                        │
     用户-角色关联表              角色-权限关联表
```

**Django 模型实现：**

```python
from django.db import models

class Menu(models.Model):
    """菜单表"""
    title = models.CharField('菜单名称', max_length=32, unique=True)
    icon = models.CharField('图标', max_length=128, blank=True, null=True)

class Permission(models.Model):
    """权限表"""
    title = models.CharField('权限标题', max_length=32)
    url = models.CharField('含正则的URL', max_length=128)
    name = models.CharField('URL别名', max_length=64, unique=True)  # 控制到按钮
    parent = models.ForeignKey(
        'self', null=True, blank=True, on_delete=models.CASCADE,
        limit_choices_to={'parent__isnull': True}
    )  # 构建父子权限关系
    menu = models.ForeignKey(Menu, null=True, blank=True, on_delete=models.CASCADE)

class Role(models.Model):
    """角色表"""
    title = models.CharField('角色名称', max_length=32)
    permissions = models.ManyToManyField(Permission, blank=True)

class UserInfo(models.Model):
    """用户表"""
    username = models.CharField('用户名', max_length=32)
    password = models.CharField('密码', max_length=64)
    roles = models.ManyToManyField(Role, blank=True)
```

### 2. 权限层级结构

```
菜单（Menu）
  └── 一级权限（Permission, parent=None, menu=Menu）
        └── 二级权限（Permission, parent=一级权限）
              └── 三级权限（按钮级）

示例：
客户管理（菜单）
  ├── 客户列表（一级权限，URL: /customer/list/）
  │     ├── 添加客户（二级权限，URL: /customer/add/）
  │     └── 编辑客户（二级权限，URL: /customer/edit/）
  └── 联系记录（一级权限，URL: /contact/list/）
```

---

## 三、权限初始化（登录时加载）

用户登录后，从数据库查询该用户所有角色下的所有权限，存入 Session。

### 核心类与方法

| 方法 | 用途 | 输出目标 |
|------|------|---------|
| `init_data()` | 跨表查询用户所有权限和菜单信息 | 返回 QuerySet |
| `init_permissions_dict()` | 以权限别名(name)为 key 构建字典 | `session[PERMISSION_SESSION_KEY]` |
| `init_menu_dict()` | 以菜单ID为 key 构建菜单树 | `session[MENU_SESSION_KEY]` |

### 输出格式

**permissions_dict（权限字典）：**

| Key (name) | id | url | title | pid | pname |
|------|----|-----|-------|-----|-------|
| customer_list | 1 | /customer/list/ | 客户列表 | null | null |
| customer_add | 2 | /customer/add/ | 添加客户 | 1 | customer_list |

**menu_dict（菜单字典）：**

| Key (menu_id) | title | icon | children |
|------|-------|------|----------|
| 1 | 客户管理 | fa-users | `[{id, title, url}, ...]` |

### 核心实现

```python
from django.conf import settings

class InitPermission:
    def __init__(self, request, user):
        self.request = request
        self.user = user
        self.menu_dict = {}
        self.permissions_dict = {}

    def init_data(self):
        return self.user.roles.filter(
            permissions__url__isnull=False
        ).values(
            'permissions__id', 'permissions__url', 'permissions__title',
            'permissions__name', 'permissions__parent_id',
            'permissions__parent__name', 'permissions__menu_id',
            'permissions__menu__title', 'permissions__menu__icon',
        ).distinct()

    def init_permissions_dict(self):
        for row in self.init_data():
            self.permissions_dict[row['permissions__name']] = {
                'id': row['permissions__id'],
                'url': row['permissions__url'],
                'title': row['permissions__title'],
                'pid': row['permissions__parent_id'],
                'pname': row['permissions__parent__name'],
            }
        self.request.session[settings.PERMISSION_SESSION_KEY] = self.permissions_dict

    def init_menu_dict(self):
        # 类似逻辑，按 menu_id 分组构建菜单树
        ...
```

登录视图调用：`InitPermission(request, user).init_permissions_dict()` + `init_menu_dict()`。

---

## 四、中间件：统一权限校验

每个请求进入时，中间件自动检查当前用户是否有访问该 URL 的权限。

### 处理流程

1. 获取当前请求路径 `request.path_info`
2. 匹配白名单 `VALID_URL` -- 命中则直接放行
3. 从 Session 获取用户权限字典，不存在则跳转登录页
4. 遍历权限字典，用正则匹配当前 URL
5. 匹配成功：设置 `current_menu_id` 和面包屑，放行
6. 无匹配：返回 403 "无权访问"

### 核心代码

```python
import re
from django.utils.deprecation import MiddlewareMixin

class PermissionMiddleWare(MiddlewareMixin):
    def process_request(self, request):
        current_url = request.path_info

        # 白名单放行
        for reg in settings.VALID_URL:
            if re.match(reg, current_url):
                return None

        # 权限校验
        permissions_dict = request.session.get(settings.PERMISSION_SESSION_KEY)
        if not permissions_dict:
            return redirect('/login/')

        for item in permissions_dict.values():
            if re.match(item['url'], current_url):
                request.current_menu_id = item['pid'] or item['id']
                # 设置面包屑导航...
                return None

        return HttpResponse('无权访问')
```

**settings.py 配置：**

```python
# Session key
PERMISSION_SESSION_KEY = 'permissions'
MENU_SESSION_KEY = 'menus'

# 白名单 URL（不需要权限校验）
VALID_URL = [
    r'/admin/.*',
    r'/login/',
    r'/register/',
    r'/static/.*',
    r'/api/public/.*',
]
```

---

## 五、装饰器：细粒度权限控制

### 1. 角色检查装饰器

```python
from functools import wraps

def require_role(role_names):
    """要求用户拥有指定角色，支持字符串或列表"""
    if isinstance(role_names, str):
        role_names = [role_names]

    def decorator(view_func):
        @wraps(view_func)
        def _wrapped_view(request, *args, **kwargs):
            user = get_current_user(request)
            user_roles = {r.title for r in user.roles.all()}
            if not any(name in user_roles for name in role_names):
                return JsonResponse({
                    'status': False,
                    'message': f'需要角色: {", ".join(role_names)}',
                })
            return view_func(request, *args, **kwargs)
        return _wrapped_view
    return decorator
```

### 2. 步骤权限检查装饰器

```python
def require_step_permission(operation_type):
    """检查用户是否有操作指定步骤的权限"""
    def decorator(view_func):
        @wraps(view_func)
        def _wrapped_view(request, step_id, *args, **kwargs):
            step = get_object_or_404(OrderProgress, id=step_id)
            user = get_current_user(request)
            is_allowed, error_msg, _ = check_step_permission(
                user, step, operation_type, request)
            if not is_allowed:
                return JsonResponse({'status': False, 'message': error_msg})
            return view_func(request, step_id, *args, **kwargs)
        return _wrapped_view
    return decorator
```

---

## 六、工作流步骤权限（进阶）

基础 RBAC 只控制"能不能访问某个 URL"。但在业务系统中，还需要控制"能不能操作某个工作流步骤"。

### 模型设计

**WorkflowStepPermission 字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| name | CharField(100) | 权限名称，唯一 |
| print_type | CharField(20) | 适用印刷类型：cover/content/both/all |
| allowed_steps | TextField(JSON) | 允许的步骤名列表，如 `["印刷","覆膜"]` |
| permission_types | M2M(WorkflowStepPermissionType) | 允许的操作类型（开始/完成/跳过/审批） |
| time_restriction | CharField(20) | 时间限制：none/working_hours/specific_hours |
| max_concurrent_steps | IntegerField | 并发限制，0=无限制 |
| is_active | BooleanField | 是否启用 |

核心检查方法 `can_operate_step(step_name, print_type, operation_type)` 依次校验 is_active、print_type 匹配、步骤在 allowed_steps 中、操作类型在 permission_types 中。

### 权限检查链路

```
用户请求操作步骤
    ↓
检查用户角色（User.roles）
    ↓
遍历角色的步骤权限（Role.workflow_step_permissions）
    ↓
每个步骤权限检查：
  ├─ 印刷类型是否匹配？
  ├─ 步骤名称是否在允许列表？
  ├─ 操作类型是否允许？
  └─ 时间限制是否满足？
    ↓
全部通过 → 允许操作
任一失败 → 拒绝并记录日志
```

### 操作日志

**WorkflowStepOperationLog 字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| order_no | CharField(32) | 订单号 |
| step_name | CharField(100) | 步骤名称 |
| print_type | CharField(20) | 印刷类型 |
| operation_type | CharField(20) | 操作类型：start/complete/skip/approve |
| operator_id | IntegerField | 操作员 ID |
| operator_name | CharField(50) | 操作员姓名 |
| operator_roles | TextField(JSON) | 角色列表 |
| permission_check_result | BooleanField | 权限检查通过/失败 |
| success | BooleanField | 操作是否成功 |
| ip_address | GenericIPAddressField | 操作 IP |
| operation_time | DateTimeField | 操作时间（自动记录） |

索引：`(order_no, operation_time)` 和 `(operator_id, operation_time)`。

---

## 七、整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        请求流程                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  浏览器请求                                                  │
│      ↓                                                      │
│  中间件拦截                                                  │
│      ├─ 白名单？ → 放行                                      │
│      ├─ 未登录？ → 跳转登录                                  │
│      └─ 权限校验                                             │
│           ├─ Session 中有该 URL 权限 → 放行                   │
│           └─ 无权限 → 返回 403                               │
│      ↓                                                      │
│  视图函数                                                    │
│      ├─ @require_role 检查角色                               │
│      ├─ @require_step_permission 检查步骤权限                 │
│      └─ 业务逻辑                                             │
│      ↓                                                      │
│  返回响应                                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                      数据模型关系                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  UserInfo ──M2M──> Role ──M2M──> Permission                 │
│                        │                                    │
│                        └──M2M──> WorkflowStepPermission      │
│                                       ├─ print_type          │
│                                       ├─ allowed_steps       │
│                                       └─ permission_types    │
│                                                             │
│  Menu <──FK── Permission ──FK──> Permission (parent)        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 八、FastAPI 实现参考

同样的 RBAC 逻辑，用 FastAPI 实现：

```python
from fastapi import Depends, HTTPException, Request
from functools import wraps

# 依赖注入：获取当前用户
async def get_current_user(request: Request) -> User:
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")
    user = await User.get_or_none(id=user_id)
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")
    return user

# 依赖注入：角色检查
def require_roles(*role_names: str):
    async def check(user: User = Depends(get_current_user)):
        user_roles = {r.title for r in await user.roles.all()}
        if not user_roles.intersection(set(role_names)):
            raise HTTPException(status_code=403, detail=f"需要角色: {role_names}")
        return user
    return check

# 使用
@app.get("/admin/dashboard")
async def admin_dashboard(user: User = Depends(require_roles("老板", "管理员"))):
    return {"message": f"欢迎 {user.username}"}
```

---

## 九、RBAC 设计原则

| 原则 | 说明 |
|------|------|
| 最小权限 | 角色只分配必要的权限 |
| 职责分离 | 关键操作需要多个角色共同授权 |
| 默认拒绝 | 没有明确授权的请求一律拒绝 |
| 权限缓存 | 登录时加载到 Session/Redis，避免每次查库 |
| 审计日志 | 权限变更和敏感操作必须记录 |
| 白名单机制 | 登录、注册、静态资源等 URL 豁免权限检查 |

---

## 十、常见面试题

### Q1：RBAC 和 ACL 的区别？

- **ACL（访问控制列表）**：直接给用户分配权限，适合小系统
- **RBAC**：通过角色间接授权，适合中大型系统，维护成本低

### Q2：权限数据什么时候加载？

登录成功后查询一次，存入 Session 或 Redis。权限变更时需要重新登录或主动刷新。

### Q3：按钮级权限怎么做？

给每个按钮操作定义一个权限（如 `customer:add`），前端根据权限列表控制按钮显示/隐藏，后端中间件校验 URL。

### Q4：中间件和装饰器分别负责什么？

- **中间件**：全局统一拦截，校验 URL 权限
- **装饰器**：细粒度控制，检查角色或步骤权限
