# Django

## 核心特性

| 特性 | 说明 |
|------|------|
| MTV 架构 | Model-Template-View，关注点分离 |
| ORM | 强大的数据库抽象层，支持多种数据库 |
| Admin 后台 | 开箱即用的管理界面 |
| 中间件 | 请求/响应处理的插件机制 |
| 模板引擎 | 内置 Django Template Language |
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

# 查询
Book.objects.filter(author__name="Alice")                        # 关联查询
Book.objects.values("author__name").annotate(count=Count("id"))  # 聚合
Book.objects.select_related("author").all()                      # JOIN 优化
Book.objects.create(title="Guide", author=author, published="2025-01-01")
Book.objects.filter(pk=1).update(title="New Title")
```

```bash
python manage.py makemigrations   # 生成迁移文件
python manage.py migrate          # 执行迁移
```

## 视图与路由

```python
from django.http import JsonResponse
from django.views import View

# FBV（函数视图）
def user_list(request):
    users = User.objects.all().values("id", "name")
    return JsonResponse(list(users), safe=False)

# CBV（类视图）
class UserDetailView(View):
    def get(self, request, pk):
        user = User.objects.get(pk=pk)
        return JsonResponse({"id": user.id, "name": user.name})
```

```python
# urls.py
urlpatterns = [
    path("users/", views.user_list),
    path("users/<int:pk>/", views.UserDetailView.as_view()),
]
```

## 中间件

```python
class SimpleLogMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        print(f"Request: {request.method} {request.path}")
        response = self.get_response(request)
        return response
```

## Django REST Framework

```python
from rest_framework import serializers, viewsets
from rest_framework.routers import DefaultRouter

class BookSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.name", read_only=True)
    class Meta:
        model = Book
        fields = ["id", "title", "author_name", "published"]

class BookViewSet(viewsets.ModelViewSet):
    queryset = Book.objects.select_related("author").all()
    serializer_class = BookSerializer

router = DefaultRouter()
router.register(r"books", BookViewSet)
# urls.py -> urlpatterns = [*router.urls]
```
