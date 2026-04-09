# OSGB 到 3D Tiles 模型处理

## 核心结论

1. **OSGB 是倾斜摄影的输出格式** -- 无人机航拍后经空三计算生成，不能直接在 Web 端渲染
2. **3D Tiles 是 Web 三维渲染的标准格式** -- Cesium 定义，支持 LOD 层次细节，适合浏览器端大规模三维场景
3. **转换流水线：坐标变换 + 格式转换** -- 先修正坐标系，再用 3dtile.exe 将 OSGB 转为 3D Tiles
4. **pyproj 处理坐标变换** -- 解析 metadata.xml 中的源坐标系，通过 CRS 转换输出目标坐标系
5. **Linux 部署需要 Wine** -- 3dtile.exe 是 Windows 程序，通过 Wine 在 Docker/Linux 中运行

---

## 一、三维模型处理流水线

```
无人机航拍（DJI 等）
      ↓
空三计算 / 三维重建（CC / PhotoScan 等）
      ↓
OSGB 模型文件（倾斜摄影成果）
      ↓
┌─────────────────────────────────────┐
│  1. 目录结构整理（格式化 OSGB 目录） │
│  2. 坐标系变换（metadata.xml 转换）  │
│  3. OSGB → 3D Tiles 格式转换        │
└─────────────────────────────────────┘
      ↓
3D Tiles 数据集（tileset.json + 分块瓦片）
      ↓
Cesium / Mapbox GL 加载渲染
```

### 为什么需要转换？

| 格式 | 特点 | Web 渲染 |
|------|------|----------|
| OSGB | 倾斜摄影原生格式，文件大，依赖专用软件 | 不支持 |
| 3D Tiles | 开放标准，LOD 分层，按需加载 | 原生支持 |
| glTF/glb | 通用三维格式，适合单个模型 | 支持 |

---

## 二、OSGB → 3D Tiles 转换

### 1. 核心工具：3dtile.exe

基于 [fanvanzh/3dtiles](https://github.com/fanvanzh/3dtiles) 开源工具，将 OSGB 模型转换为 3D Tiles 格式。

```python
import subprocess
import json
import platform
import shutil
from pathlib import Path


class Osgb2Tiles:
    """OSGB 到 3D Tiles 转换器"""

    def __init__(self, exe_path: str = None):
        self.exe_path = self._resolve_3dtile_exe(exe_path)
        self.is_linux = platform.system() == "Linux"

    def _resolve_3dtile_exe(self, explicit_path: str = None) -> str:
        """
        查找 3dtile.exe，优先级：
        1. 显式指定路径
        2. 脚本所在目录
        3. 环境变量 THREEDTILES_PATH
        4. 系统 PATH
        """
        if explicit_path and Path(explicit_path).exists():
            return explicit_path

        # 脚本目录查找
        script_dir = Path(__file__).parent
        for name in ["3dtile.exe", "3dtile"]:
            candidate = script_dir / name
            if candidate.exists():
                return str(candidate)

        # 环境变量
        env_path = os.environ.get("THREEDTILES_PATH")
        if env_path and Path(env_path).exists():
            return env_path

        # 系统 PATH
        found = shutil.which("3dtile.exe") or shutil.which("3dtile")
        if found:
            return found

        raise FileNotFoundError("找不到 3dtile 可执行文件")

    def convert(
        self,
        input_dir: str,
        output_dir: str,
        max_thread: int = 4,
        xyz_offset: tuple = None,
    ) -> dict:
        """
        执行 OSGB → 3D Tiles 转换

        Args:
            input_dir: OSGB 数据目录
            output_dir: 输出目录
            max_thread: 最大线程数
            xyz_offset: 坐标偏移 (x, y, z)

        Returns:
            {"ok": bool, "output_path": str, "stdout": str, "stderr": str, "cmd": str}
        """
        Path(output_dir).mkdir(parents=True, exist_ok=True)

        # 构建命令
        cmd_parts = [self.exe_path, "-p", "OSGB", "-i", input_dir, "-o", output_dir]

        config = {"maxThread": max_thread}
        if xyz_offset:
            config["xyzOffset"] = list(xyz_offset)

        # 写入配置文件
        config_path = Path(output_dir) / ".3dtiles_config.json"
        config_path.write_text(json.dumps(config, ensure_ascii=False))
        cmd_parts.extend(["-c", str(config_path)])

        # Linux 使用 Wine
        if self.is_linux:
            cmd_parts = ["wine"] + cmd_parts

        cmd_str = " ".join(cmd_parts)
        result = subprocess.run(
            cmd_parts,
            capture_output=True,
            text=True,
            timeout=3600,  # 1 小时超时
        )

        return {
            "ok": result.returncode == 0,
            "output_path": output_dir,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "cmd": cmd_str,
            "returncode": result.returncode,
        }
```

### 2. 转换配置

```json
{
  "maxThread": 4,
  "xyzOffset": [0, 0, 0],
  "region": {
    "minX": 116.0,
    "minY": 39.0,
    "maxX": 117.0,
    "maxY": 40.0
  }
}
```

---

## 三、坐标变换

### 1. 为什么需要坐标变换？

无人机生成的模型 metadata.xml 中包含坐标系信息（通常是 WGS84 UTM 投影），需要在转换前修正为正确的坐标系。

### 2. pyproj 坐标变换

```python
import xml.etree.ElementTree as ET
from pathlib import Path
from pyproj import Transformer, CRS


def convert_metadata(
    input_path: str,
    output_path: str = None,
    target_crs: str = "EPSG:4326",
) -> dict:
    """
    DJI 3D Tile metadata.xml 坐标系变换

    Args:
        input_path: 源 metadata.xml 路径
        output_path: 输出路径（默认 new_metadata.xml）
        target_crs: 目标坐标系（默认 WGS84）

    Returns:
        {"source_crs": str, "target_crs": str, "output": str}
    """
    tree = ET.parse(input_path)
    root = tree.getroot()

    # 提取源坐标系 SRS
    srs_element = root.find(".//SRS")
    if srs_element is None or srs_element.text is None:
        raise ValueError("metadata.xml 中未找到 SRS 信息")

    source_crs_str = srs_element.text.strip()

    # 解析 CRS（支持复合坐标系，取水平分量）
    source_crs = _parse_crs(source_crs_str)
    target = CRS.from_string(target_crs)

    # 创建变换器（always_xy=True 确保经度在前）
    transformer = Transformer.from_crs(source_crs, target, always_xy=True)

    # 变换 bounding box 中的坐标
    for bbox in root.findall(".//BoundingBox"):
        for coord_name in ["west", "east"]:
            lon_el = bbox.find(coord_name)
            lat_el = bbox.find("south" if coord_name == "west" else "north")
            if lon_el is not None and lat_el is not None:
                new_lon, new_lat = transformer.transform(
                    float(lon_el.text), float(lat_el.text)
                )
                lon_el.text = str(new_lon)
                lat_el.text = str(new_lat)

    # 更新 SRS 节点
    srs_element.text = target_crs

    # 输出
    if not output_path:
        output_path = str(Path(input_path).parent / f"new_{Path(input_path).name}")

    tree.write(output_path, encoding="utf-8", xml_declaration=True)

    return {
        "source_crs": source_crs_str,
        "target_crs": target_crs,
        "output": output_path,
    }


def _parse_crs(crs_str: str) -> CRS:
    """
    解析 CRS 字符串，支持复合坐标系

    DJI 生成的可能是复合 CRS：
    EPSG:32650+5773（UTM 50N + EGM96 高程）
    需要提取水平分量 EPSG:32650
    """
    if "+" in crs_str:
        horizontal = crs_str.split("+")[0]
        return CRS.from_string(horizontal)
    return CRS.from_string(crs_str)


def quick_convert(input_path: str) -> str:
    """快速转换：自动读取源 SRS，输出到同目录"""
    return convert_metadata(input_path)["output"]
```

### 3. 常见坐标系

| CRS | 说明 | 用途 |
|-----|------|------|
| EPSG:4326 | WGS84 经纬度 | GPS、Web 地图 |
| EPSG:4490 | CGCS2000 经纬度 | 中国国家坐标系 |
| EPSG:32650 | WGS84 UTM Zone 50N | DJI 无人机常用 |
| EPSG:3857 | Web Mercator | Web 地图投影 |

---

## 四、Cesium 加载 3D Tiles

```javascript
// Vue3 + Cesium 加载 3D Tiles
const viewer = new Cesium.Viewer("cesiumContainer", {
  terrainProvider: Cesium.createWorldTerrain(),
});

// 加载 3D Tiles 模型
const tileset = await Cesium.Cesium3DTileset.fromUrl("/Data/3dTiles/tileset.json");

viewer.scene.primitives.add(tileset);

// 飞到模型位置
viewer.zoomTo(tileset);

// 样式调整（可选）
tileset.style = new Cesium.Cesium3DTileStyle({
  color: {
    conditions: [
      ["${height} >= 100", "color('purple')"],
      ["${height} >= 50", "color('red')"],
      ["true", "color('white')"],
    ],
  },
});
```

---

## 五、Docker 部署（含 Wine）

```dockerfile
FROM python:3.10-slim

# 安装 Wine（运行 3dtile.exe）
RUN dpkg --add-architecture i386 && \
    apt-get update && \
    apt-get install -y wine wine32 && \
    rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用和 3dtile.exe
COPY . /app
WORKDIR /app

# Wine 首次初始化
RUN wine boot --init 2>/dev/null || true

CMD ["python", "app.py"]
```

---

## 六、常见面试题

### Q1：OSGB 和 3D Tiles 的区别？

OSGB 是倾斜摄影软件的私有输出格式，适合离线查看和编辑。3D Tiles 是 OGC 开放标准，支持 LOD 层次细节和按需加载，专为 Web 三维场景设计。

### Q2：为什么需要坐标变换？

无人机空三计算使用的坐标系（如 UTM 投影）与 Web 地图使用的坐标系（WGS84 经纬度）不同。pyproj 通过 CRS 转换将坐标从源系映射到目标系，`always_xy=True` 确保经度在前。

### Q3：3D Tiles 的 LOD 是什么？

LOD（Level of Detail）层次细节：远距离时加载低精度模型，近距离时加载高精度模型。3D Tiles 通过 tileset.json 的 boundingVolume 层级结构实现，类似地图的瓦片金字塔。

### Q4：Linux 下如何运行 3dtile.exe？

通过 Wine 兼容层。Wine 在 Linux 上实现了 Windows API 子集，可以直接运行 .exe 程序。Docker 部署时安装 wine 包，在命令前加 `wine` 前缀即可。
