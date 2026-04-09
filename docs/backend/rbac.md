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

```python
from django.conf import settings

class InitPermission:
    """登录后初始化权限和菜单"""

    def __init__(self, request, user):
        self.request = request
        self.user = user
        self.menu_dict = {}
        self.permissions_dict = {}

    def init_data(self):
        """查询用户的所有权限"""
        return self.user.roles.filter(
            permissions__url__isnull=False
        ).values(
            'permissions__id',
            'permissions__url',
            'permissions__title',
            'permissions__name',
            'permissions__parent_id',
            'permissions__parent__name',
            'permissions__menu_id',
            'permissions__menu__title',
            'permissions__menu__icon',
        ).distinct()

    def init_permissions_dict(self):
        """构建权限字典，存入 Session

        结果格式：
        {
            'customer_list': {'id': 1, 'url': '/customer/list/', 'title': '客户列表', 'pid': None},
            'customer_add':  {'id': 2, 'url': '/customer/add/',  'title': '添加客户', 'pid': 1},
        }
        """
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
        """构建菜单字典，存入 Session

        结果格式：
        {
            1: {
                'title': '客户管理',
                'icon': 'fa fa-users',
                'children': [
                    {'id': 1, 'title': '客户列表', 'url': '/customer/list/'}
                ]
            }
        }
        """
        for row in self.init_data():
            menu_id = row['permissions__menu_id']
            if not menu_id:
                continue
            if menu_id not in self.menu_dict:
                self.menu_dict[menu_id] = {
                    'title': row['permissions__menu__title'],
                    'icon': row['permissions__menu__icon'],
                    'children': [{
                        'id': row['permissions__id'],
                        'title': row['permissions__title'],
                        'url': row['permissions__url'],
                    }]
                }
            else:
                self.menu_dict[menu_id]['children'].append({
                    'id': row['permissions__id'],
                    'title': row['permissions__title'],
                    'url': row['permissions__url'],
                })
        self.request.session[settings.MENU_SESSION_KEY] = self.menu_dict
```

**在登录视图中调用：**

```python
def login(request):
    if request.method == 'POST':
        user = UserInfo.objects.filter(username=username, password=password).first()
        if user:
            # 初始化权限和菜单
            init = InitPermission(request, user)
            init.init_permissions_dict()
            init.init_menu_dict()
            return redirect('/index/')
```

---

## 四、中间件：统一权限校验

每个请求进入时，中间件自动检查当前用户是否有访问该 URL 的权限。

```python
import re
from django.utils.deprecation import MiddlewareMixin
from django.conf import settings

class PermissionMiddleWare(MiddlewareMixin):
    """权限控制中间件"""

    def process_request(self, request):
        current_url = request.path_info

        # 1. 白名单：不需要权限的 URL（登录、注册、静态资源等）
        for reg in settings.VALID_URL:
            if re.match(reg, current_url):
                return None  # 放行

        # 2. 从 Session 获取用户权限
        permissions_dict = request.session.get(settings.PERMISSION_SESSION_KEY)
        if not permissions_dict:
            return redirect('/login/')  # 未登录，跳转登录页

        # 3. 遍历权限，正则匹配当前 URL
        flag = False
        request.breadcrumb_list = [{'title': '首页', 'url': '/index/'}]

        for item in permissions_dict.values():
            reg = item['url']
            if re.match(reg, current_url):
                # 匹配成功，设置当前菜单 ID 和面包屑
                if item['pid']:  # 子权限
                    request.current_menu_id = item['pid']
                    parent = permissions_dict.get(item['pname'], {})
                    request.breadcrumb_list.extend([
                        {'title': parent.get('title', ''), 'url': parent.get('url', '')},
                        {'title': item['title'], 'url': item['url']},
                    ])
                else:  # 一级权限
                    request.current_menu_id = item['id']
                    request.breadcrumb_list.append({
                        'title': item['title'], 'url': item['url']
                    })
                flag = True
                break

        if not flag:
            return HttpResponse('无权访问')  # 没有匹配的权限
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
from django.http import JsonResponse

def require_role(role_names):
    """
    装饰器：要求用户拥有指定角色

    Usage:
        @require_role(['老板', '办公室'])
        def admin_view(request):
            ...

        @require_role('操作员')
        def operator_view(request):
            ...
    """
    if isinstance(role_names, str):
        role_names = [role_names]

    def decorator(view_func):
        @wraps(view_func)
        def _wrapped_view(request, *args, **kwargs):
            user_id = request.session.get('user_id')
            if not user_id:
                return JsonResponse({'status': False, 'message': '用户未登录'})

            user = UserInfo.objects.filter(id=user_id).first()
            if not user:
                return JsonResponse({'status': False, 'message': '用户不存在'})

            user_role_names = [role.title for role in user.roles.all()]
            if not any(name in user_role_names for name in role_names):
                return JsonResponse({
                    'status': False,
                    'message': f'需要以下角色之一: {", ".join(role_names)}',
                })

            request.current_user = user
            return view_func(request, *args, **kwargs)
        return _wrapped_view
    return decorator
```

### 2. 步骤权限检查装饰器

```python
def require_step_permission(operation_type):
    """
    装饰器：检查用户是否有操作指定步骤的权限

    Usage:
        @require_step_permission('start')
        def start_step_view(request, step_id):
            ...
    """
    def decorator(view_func):
        @wraps(view_func)
        def _wrapped_view(request, step_id, *args, **kwargs):
            step = get_object_or_404(OrderProgress, id=step_id)
            user = get_current_user(request)

            is_allowed, error_message, details = check_step_permission(
                user, step, operation_type, request
            )

            if not is_allowed:
                return JsonResponse({'status': False, 'message': error_message})

            request.permission_check_result = details
            request.current_user = user
            request.current_step = step
            return view_func(request, step_id, *args, **kwargs)
        return _wrapped_view
    return decorator
```

---

## 六、工作流步骤权限（进阶）

基础 RBAC 只控制"能不能访问某个 URL"。但在业务系统中，还需要控制"能不能操作某个工作流步骤"。

### 模型设计

```python
class WorkflowStepPermissionType(models.Model):
    """步骤操作类型（开始、完成、跳过、审批）"""
    name = models.CharField(max_length=50, unique=True)
    description = models.CharField(max_length=200)

class WorkflowStepPermission(models.Model):
    """工作流步骤权限"""
    name = models.CharField(max_length=100, unique=True)

    # 适用业务类型
    print_type = models.CharField(max_length=20, choices=[
        ('cover', '封面印刷'), ('content', '内文印刷'),
        ('both', '封面+内文'), ('all', '所有类型'),
    ], default='all')

    # 允许的步骤（JSON 列表）
    allowed_steps = models.TextField(blank=True)  # ["印刷", "覆膜", "烫金"]

    # 允许的操作类型
    permission_types = models.ManyToManyField(WorkflowStepPermissionType)

    # 时间限制
    time_restriction = models.CharField(max_length=20, choices=[
        ('none', '无限制'), ('working_hours', '仅工作时间'),
        ('specific_hours', '指定时间段'),
    ], default='none')
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)

    # 并发限制
    max_concurrent_steps = models.IntegerField(default=0)  # 0=无限制

    # 是否启用
    is_active = models.BooleanField(default=True)

    def can_operate_step(self, step_name, print_type, operation_type):
        """检查是否可以操作指定步骤"""
        if not self.is_active:
            return False
        if self.print_type != 'all' and self.print_type != print_type:
            return False
        allowed_steps = json.loads(self.allowed_steps or '[]')
        if allowed_steps and step_name not in allowed_steps:
            return False
        allowed_ops = [pt.name for pt in self.permission_types.all()]
        if operation_type not in allowed_ops:
            return False
        return True
```

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

```python
class WorkflowStepOperationLog(models.Model):
    """步骤操作日志（审计用）"""
    order_no = models.CharField(max_length=32)          # 订单号
    step_name = models.CharField(max_length=100)        # 步骤名
    print_type = models.CharField(max_length=20)        # 印刷类型
    operation_type = models.CharField(max_length=20, choices=[
        ('start', '开始'), ('complete', '完成'),
        ('skip', '跳过'), ('approve', '审批'),
    ])
    operator_id = models.IntegerField()                 # 操作员 ID
    operator_name = models.CharField(max_length=50)     # 操作员姓名
    operator_roles = models.TextField()                 # 角色列表（JSON）
    permission_check_result = models.BooleanField()     # 权限检查结果
    success = models.BooleanField()                     # 操作是否成功
    ip_address = models.GenericIPAddressField(null=True)
    operation_time = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['order_no', 'operation_time']),
            models.Index(fields=['operator_id', 'operation_time']),
        ]
```

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
