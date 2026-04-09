# 数据获取

## 数据源分类

| 数据源 | 获取方式 | 典型场景 |
|--------|---------|---------|
| Web 页面 | 爬虫 | 商品信息、新闻、评论 |
| API 接口 | HTTP 请求 | 天气、地图、企业微信 |
| 数据库 | SQL 查询 | 业务数据、用户行为 |
| 文件 | 解析读取 | CSV、Excel、PDF、JSON |
| 实时流 | Kafka/WebSocket | 日志、传感器、行情 |

## 爬虫开发

### requests + BeautifulSoup

```python
import requests
from bs4 import BeautifulSoup

headers = {"User-Agent": "Mozilla/5.0 ..."}
resp = requests.get("https://example.com/products", headers=headers)
soup = BeautifulSoup(resp.text, "html.parser")

for item in soup.select(".product-item"):
    name = item.select_one(".title").text
    price = item.select_one(".price").text
    print(name, price)
```

### Selenium（动态页面）

```python
from selenium import webdriver
from selenium.webdriver.common.by import By

driver = webdriver.Chrome()
driver.get("https://example.com")

# 等待动态加载
driver.implicitly_wait(10)
items = driver.find_elements(By.CSS_SELECTOR, ".item")

for item in items:
    print(item.text)
driver.quit()
```

## 数据库查询

```python
import psycopg2
import pandas as pd

conn = psycopg2.connect("postgresql://user:pass@localhost/db")
df = pd.read_sql("SELECT * FROM orders WHERE date >= '2025-01-01'", conn)
```

## 文件解析

| 格式 | 库 | 示例 |
|------|-----|------|
| CSV/Excel | pandas.read_csv / read_excel | `pd.read_csv("data.csv")` |
| JSON | json / pandas | `pd.read_json("data.json")` |
| PDF | PyMuPDF (fitz) | `fitz.open("doc.pdf")` |
| Word | python-docx | `Document("doc.docx")` |

## 常见坑点

- **反爬策略**：User-Agent、IP 限制、验证码 -> 加随机延迟、代理池、headers 模拟
- **编码问题**：中文乱码 -> 统一 UTF-8，`resp.encoding = resp.apparent_encoding`
- **数据量大**：内存不足 -> 分批读取、流式处理、存数据库
- **数据更新**：增量采集 -> 记录上次采集时间/位置，只拉取新增数据
