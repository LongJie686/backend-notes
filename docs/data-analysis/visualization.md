# 数据可视化

## 工具选型

| 工具 | 定位 | 适用场景 |
|------|------|---------|
| Matplotlib | 基础绑图库 | 快速探索、自定义图表 |
| pyecharts | Python 封装 ECharts | 交互式图表、报告生成 |
| ECharts | 前端图表库 | Web 可视化看板 |
| AntV G2/S2 | 前端分析图表 | 数据分析看板、透视表 |
| Seaborn | 统计可视化 | 探索性分析、分布图 |

## Matplotlib 基础

```python
import matplotlib.pyplot as plt

# 折线图
plt.figure(figsize=(10, 6))
plt.plot(months, revenue, marker="o", label="营收")
plt.plot(months, cost, marker="s", label="成本")
plt.title("月度营收与成本趋势")
plt.xlabel("月份")
plt.ylabel("金额（万元）")
plt.legend()
plt.grid(True, alpha=0.3)
plt.savefig("trend.png", dpi=150, bbox_inches="tight")
```

## pyecharts（Python -> 交互式 HTML）

```python
from pyecharts.charts import Bar
from pyecharts import options as opts

bar = (
    Bar()
    .add_xaxis(["北京", "上海", "广州", "深圳"])
    .add_yaxis("销售额", [320, 280, 210, 190])
    .set_global_opts(
        title_opts=opts.TitleOpts(title="城市销售额排名"),
        toolbox_opts=opts.ToolboxOpts(),  # 下载、缩放工具栏
    )
)
bar.render("sales.html")  # 输出 HTML 文件
```

## ECharts（前端集成）

```javascript
// 前端 Vue/React 中使用 ECharts
const chart = echarts.init(document.getElementById("chart"));
chart.setOption({
    xAxis: { type: "category", data: ["Q1", "Q2", "Q3", "Q4"] },
    yAxis: { type: "value" },
    series: [{ type: "bar", data: [120, 200, 150, 80] }]
});
```

## 图表类型选择

| 数据关系 | 推荐图表 | 示例 |
|---------|---------|------|
| 趋势变化 | 折线图 | 月度销售额走势 |
| 分类对比 | 柱状图 | 各城市业绩排名 |
| 占比构成 | 饼图 | 产品类别收入占比 |
| 分布情况 | 直方图/箱线图 | 用户年龄分布 |
| 相关关系 | 散点图 | 广告投入 vs 转化率 |
| 多维对比 | 雷达图 | 产品多维度评分 |

## 导出到 PPT

```python
from pyecharts.charts import Bar
from pptx import Presentation
from pptx.util import Inches

# 生成图表图片
bar = Bar().add_xaxis(["A", "B"]).add_yaxis("销量", [100, 200])
bar.render("chart.html")

# 嵌入 PPT
prs = Presentation()
slide = prs.slides.add_slide(prs.slide_layouts[6])  # 空白布局
slide.shapes.add_picture("chart.png", Inches(1), Inches(1), Inches(8), Inches(5))
prs.save("report.pptx")
```

## 常见坑点

- **中文乱码**：Matplotlib 需设置字体 `plt.rcParams["font.sans-serif"] = ["SimHei"]`
- **图表太多**：看板不是图表堆砌，每张图要有明确的分析目的
- **颜色滥用**：配色不超过 7 种，同类数据用同色系
- **3D 图表**：除特殊需求外避免使用，信息传达效率低
