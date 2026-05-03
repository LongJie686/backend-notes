# Django

## 核心特性

| 特性 | 说明 |
|------|------|
| MTV 架构 | Model-Template-View，关注点分离 |
| ORM | 强大的数据库抽象层，支持多种数据库 |
| Admin 后台 | 开箱即用的管理界面 |
| 中间件 | 请求/响应处理的插件机制 |
| 安全性 | 内置 CSRF / XSS / SQL 注入防护 |

## 项目结构

```
myproject/
  manage.py
  myproject/
    settings.py      # 项目配置
    urls.py          # 根路由
  apps/
    users/
      models.py      # 数据模型
      views.py       # 视图
      urls.py        # 子路由
      serializers.py # DRF 序列化器
```

## ORM 常用操作

```python
from django.db import models

class Author(models.Model):
    name = models.CharField(max_length=100)

class Book(models.Model):
    title = models.CharField(max_length=200)
    author = models.ForeignKey(Author, on_delete=models.CASCADE, related_name="books")
    published = models.DateField()
```

| 操作 | 示例 |
|------|------|
| 关联查询 | `Book.objects.filter(author__name="Alice")` |
| 聚合 | `Book.objects.values("author__name").annotate(count=Count("id"))` |
| JOIN优化 | `Book.objects.select_related("author").all()` |
| 创建 | `Book.objects.create(title="G", author=a)` |
| 更新 | `Book.objects.filter(pk=1).update(title="New")` |
| 迁移 | `python manage.py makemigrations && migrate` |

## 视图与路由

| 类型 | 特点 | 适用 |
|------|------|------|
| FBV（函数视图） | 简单直接 | 逻辑简单的接口 |
| CBV（类视图） | GET/POST自动分发 | RESTful 风格 |

```python
# CBV 示例
class UserDetailView(View):
    def get(self, request, pk):
        return JsonResponse({"id": pk})
```

```python
# urls.py
urlpatterns = [
    path("users/<int:pk>/", views.UserDetailView.as_view()),
]
```

## 中间件

中间件是请求/响应处理的钩子链，可用于日志、鉴权、跨域等。

```python
class SimpleLogMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
    def __call__(self, request):
        response = self.get_response(request)
        return response
```

## Django REST Framework

| 组件 | 作用 |
|------|------|
| Serializer | 序列化/反序列化 + 字段校验 |
| ModelViewSet | 自动生成 CRUD 接口 |
| Router | 自动注册 URL 路由 |

```python
class BookSerializer(serializers.ModelSerializer):
    class Meta:
        model = Book
        fields = ["id", "title", "published"]

class BookViewSet(viewsets.ModelViewSet):
    queryset = Book.objects.all()
    serializer_class = BookSerializer

router = DefaultRouter()
router.register(r"books", BookViewSet)
```
