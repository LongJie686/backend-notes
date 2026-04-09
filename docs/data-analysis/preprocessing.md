# 数据预处理

## 核心流程

```
原始数据 -> 缺失值处理 -> 异常值处理 -> 格式转换 -> 特征工程 -> 干净数据
```

## Pandas 数据清洗

### 缺失值处理

```python
import pandas as pd

df = pd.read_csv("data.csv")

# 查看缺失情况
df.isnull().sum()

# 处理方式
df = df.dropna()                    # 删除缺失行
df["age"] = df["age"].fillna(0)     # 填充默认值
df["age"] = df["age"].fillna(df["age"].mean())  # 填充均值
```

### 异常值处理

```python
# 基于分位数过滤
q1 = df["price"].quantile(0.25)
q3 = df["price"].quantile(0.75)
iqr = q3 - q1
df = df[(df["price"] >= q1 - 1.5 * iqr) & (df["price"] <= q3 + 1.5 * iqr)]
```

### 格式转换

```python
# 日期转换
df["date"] = pd.to_datetime(df["date"])

# 类型转换
df["amount"] = df["amount"].astype(float)

# 字符串清洗
df["name"] = df["name"].str.strip().str.lower()
```

## NumPy 数值计算

```python
import numpy as np

arr = np.array([1.2, 3.4, 5.6, np.nan, 7.8])

# 基础统计（自动忽略 NaN）
np.nanmean(arr)     # 均值
np.nanstd(arr)      # 标准差
np.nanmedian(arr)   # 中位数

# 矩阵运算
a = np.random.randn(100, 50)
b = np.random.randn(50, 10)
c = a @ b  # 矩阵乘法
```

## ETL 流水线

```python
def extract(filepath):
    """抽取：读取原始数据"""
    return pd.read_csv(filepath)

def transform(df):
    """转换：清洗、计算、聚合"""
    df = df.dropna(subset=["user_id", "amount"])
    df["date"] = pd.to_datetime(df["date"])
    df["month"] = df["date"].dt.to_period("M")
    return df.groupby("month")["amount"].agg(["sum", "mean", "count"])

def load(result, output_path):
    """加载：输出结果"""
    result.to_csv(output_path)

# 执行 ETL
raw = extract("orders.csv")
clean = transform(raw)
load(clean, "monthly_summary.csv")
```

## 常见坑点

- **中文编码**：读取 CSV 时指定 `encoding="utf-8"` 或 `"gbk"`
- **内存溢出**：大文件用 `chunksize` 分批处理
- **时区问题**：统一用 UTC 存储，展示时转换本地时区
- **数据类型陷阱**：Pandas 的 `int` 列有缺失值会自动变 `float`
