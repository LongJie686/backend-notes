# 图像处理

## OpenCV 核心

### 基础操作

```python
import cv2
import numpy as np

img = cv2.imread("photo.jpg")

# 基本属性
print(img.shape)  # (高, 宽, 通道数)

# 灰度化
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

# 缩放
resized = cv2.resize(img, (800, 600))

# 裁剪
crop = img[100:400, 200:600]

# 保存
cv2.imwrite("output.jpg", gray)
```

### 常用处理

```python
# 高斯模糊（去噪）
blur = cv2.GaussianBlur(img, (5, 5), 0)

# 边缘检测
edges = cv2.Canny(gray, threshold1=50, threshold2=150)

# 阈值分割
_, binary = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)

# 轮廓检测
contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
cv2.drawContours(img, contours, -1, (0, 255, 0), 2)
```

## PDF 文档处理（PyMuPDF）

```python
import fitz  # PyMuPDF

doc = fitz.open("document.pdf")

for page_num in range(len(doc)):
    page = doc[page_num]

    # 提取文字
    text = page.get_text()

    # 提取图片
    images = page.get_images()
    for img_index, img in enumerate(images):
        xref = img[0]
        pix = fitz.Pixmap(doc, xref)
        pix.save(f"page{page_num}_img{img_index}.png")

    # 页面转图片（用于视觉比对）
    pix = page.get_pixmap(dpi=200)
    pix.save(f"page_{page_num}.png")
```

## 视觉差异检测

```python
def compare_images(img1_path, img2_path, threshold=30):
    """逐像素差异检测"""
    img1 = cv2.imread(img1_path)
    img2 = cv2.imread(img2_path)

    # 确保尺寸一致
    img2 = cv2.resize(img2, (img1.shape[1], img1.shape[0]))

    # 计算差异
    diff = cv2.absdiff(img1, img2)
    gray_diff = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)

    # 阈值过滤（忽略微小差异）
    _, mask = cv2.threshold(gray_diff, threshold, 255, cv2.THRESH_BINARY)

    # 标记差异区域
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    result = img1.copy()
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        cv2.rectangle(result, (x, y), (x + w, y + h), (0, 0, 255), 2)

    # 统计差异
    diff_pixels = cv2.countNonZero(mask)
    total_pixels = mask.shape[0] * mask.shape[1]
    diff_ratio = diff_pixels / total_pixels * 100

    return result, diff_ratio
```

## 差异标记模式

| 模式 | 标记方式 | 适用场景 |
|------|---------|---------|
| 矩形框 | 红框圈出差异区域 | 合同、文档比对 |
| 像素高亮 | 差异像素着色 | 精细对比 |
| 蒙版叠加 | 半透明红色覆盖 | 多处差异可视化 |

## 常见坑点

- **颜色通道**：OpenCV 默认 BGR 而非 RGB，转其他库需 `cv2.cvtColor`
- **坐标顺序**：NumPy 数组是 `[y, x]`，OpenCV 函数参数是 `(x, y)`
- **中文路径**：OpenCV 的 imread 不支持中文路径，用 `cv2.imdecode` 替代
- **PDF 分辨率**：页面转图片时 DPI 不够会导致比对不准，建议 200+
