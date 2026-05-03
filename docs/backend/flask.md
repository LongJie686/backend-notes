# Flask

## 核心特性

| 特性 | 说明 |
|------|------|
| 轻量 | 核心精简，按需引入扩展 |
| 灵活 | 不强制项目结构，自由度高 |
| Jinja2 模板 | 强大的模板引擎 |
| 蓝图 | 模块化组织应用 |
| 生态丰富 | Flask-SQLAlchemy / Flask-Login 等扩展 |

## 路由与请求

```python
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route("/users/<int:user_id>")
def get_user(user_id):
    return jsonify({"id": user_id})

@app.route("/items", methods=["GET", "POST"])
def items():
    if request.method == "POST":
        return jsonify(request.get_json()), 201
    return jsonify({"keyword": request.args.get("keyword", ""),
                    "page": request.args.get("page", 1, type=int)})
```

## 蓝图（模块化）

蓝图用于将应用拆分为可复用的模块，每个蓝图有自己的路由前缀。

```python
# blueprints/users.py
users_bp = Blueprint("users", __name__, url_prefix="/users")

@users_bp.route("/")
def list_users():
    return jsonify([])

# app.py -- 注册
app.register_blueprint(users_bp)
```

## 常用扩展

| 扩展 | 用途 |
|------|------|
| Flask-SQLAlchemy | ORM 数据库操作 |
| Flask-Migrate | 数据库迁移 |
| Flask-Login | 用户认证 |
| Flask-CORS | 跨域支持 |

```python
from flask_sqlalchemy import SQLAlchemy

app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///app.db"
db = SQLAlchemy(app)

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120), unique=True)
```

## Flask vs FastAPI

| 对比项 | Flask | FastAPI |
|--------|-------|---------|
| 异步支持 | 需额外配置 | 原生 async/await |
| 自动文档 | 需 Flask-RESTX | 内置 Swagger / ReDoc |
| 类型校验 | 手动或 Marshmallow | Pydantic 自动校验 |
| 性能 | 中等 | 高 |
| 适用场景 | 小型项目、模板渲染 | API 服务、微服务 |

**选型建议：**
- 需要服务端渲染或快速原型 -> **Flask**
- 纯 API 服务、需要自动文档和异步 -> **FastAPI**
