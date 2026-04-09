# 语音交互系统（STT/TTS）

语音交互是 AI 应用的核心能力之一，涉及语音识别（STT）、语音合成（TTS）和实时通信。

## STT 语音识别

将音频流转换为文本，是语音交互的入口。

### 方案对比

| 方案 | 特点 | 适用场景 |
|------|------|---------|
| **Whisper** (OpenAI) | 开源，支持 99 种语言，精度高 | 离线部署、多语言场景 |
| **FunASR** (阿里达摩院) | 中文效果好，支持热词 | 中文业务、企业部署 |
| **SherpaONNX** | 轻量级，CPU 友好，离线运行 | 边缘设备、嵌入式场景 |
| **Azure Speech** | 云服务，实时流式，标点恢复 | 生产环境、低延迟要求 |

### Whisper 使用示例

```python
import whisper

model = whisper.load_model("medium")  # tiny/base/small/medium/large
result = model.transcribe("audio.mp3", language="zh")
print(result["text"])

# 流式识别（使用 faster-whisper 提升速度）
from faster_whisper import WhisperModel
model = WhisperModel("medium", device="cuda", compute_type="float16")
segments, info = model.transcribe("audio.mp3", language="zh")
for segment in segments:
    print(f"[{segment.start:.1f}s] {segment.text}")
```

## TTS 语音合成

将文本转换为自然语音，决定交互体验的上限。

### 方案对比

| 方案 | 特点 | 适用场景 |
|------|------|---------|
| **GPT-SoVITS** | 声音克隆，零样本/少样本，支持中日英 | 个性化语音、虚拟角色 |
| **CosyVoice** (阿里) | 开源，多情感，多语言 | 情感对话、有声阅读 |
| **Edge-TTS** (微软) | 免费，质量稳定，多种音色 | 快速集成、成本敏感 |
| **MiniMax** | 云 API，高质量，低延迟 | 商业产品、高并发 |

### Edge-TTS 使用示例

```python
import edge_tts
import asyncio

async def synthesize(text: str, output: str):
    communicate = edge_tts.Communicate(text, voice="zh-CN-XiaoxiaoNeural")
    await communicate.save(output)

asyncio.run(synthesize("你好，今天天气不错", "output.mp3"))
```

### GPT-SoVITS 声音克隆

```python
# 提供 3-10 秒参考音频即可克隆声音
# API 调用示例
import requests

response = requests.post("http://localhost:9880/tts", json={
    "text": "这是一段克隆声音的测试",
    "text_lang": "zh",
    "ref_audio_path": "reference.wav",   # 参考音频
    "prompt_text": "参考音频对应的文字",
    "prompt_lang": "zh",
})
with open("cloned_output.wav", "wb") as f:
    f.write(response.content)
```

## 完整语音交互流程

```
┌─────┐   ┌─────┐   ┌──────┐   ┌────────┐   ┌─────┐   ┌───────┐
│ 录音 │──>│ STT │──>│ LLM  │──>│情感分析│──>│ TTS │──>│Live2D │
└─────┘   └─────┘   └──────┘   └────────┘   └─────┘   └───────┘
   │                     │                        │
   └── WebSocket 流式上传 ┘                        └── 流式音频播放
```

1. **录音采集**：浏览器/客户端采集音频流
2. **STT 识别**：实时转写为文本（VAD 静音检测断句）
3. **LLM 推理**：文本送入大模型，流式生成回复
4. **情感分析**：根据回复内容判断情感状态（开心/悲伤/惊讶等）
5. **TTS 合成**：按情感选择音色，流式合成音频
6. **Live2D 驱动**：情感参数映射到虚拟形象动作

## WebSocket 实时通信

```python
# server.py - 简化的 WebSocket 语音交互服务
import websockets
import json

async def handle_connection(websocket):
    async for message in websocket:
        if isinstance(message, bytes):
            # 音频数据 -> STT
            text = await stt_process(message)
            await websocket.send(json.dumps({"type": "transcript", "text": text}))

            # LLM 流式推理
            async for chunk in llm_stream(text):
                await websocket.send(json.dumps({"type": "llm_chunk", "text": chunk}))

            # TTS 合成
            audio = await tts_synthesize(full_response)
            await websocket.send(audio)  # 二进制音频帧

async def main():
    async with websockets.serve(handle_connection, "0.0.0.0", 8765):
        await asyncio.Future()  # 永久运行
```

## 性能优化

| 优化点 | 方法 | 效果 |
|--------|------|------|
| **流式 TTS** | 边生成边播放，不等全部完成 | 首字延迟降低 60%+ |
| **音频缓冲** | 客户端预缓冲 200-500ms 再播放 | 避免卡顿 |
| **VAD 断句** | 静音超过 600ms 自动提交 | 减少等待时间 |
| **模型量化** | Whisper 用 float16，TTS 用 INT8 | 推理速度提升 2-3x |
| **连接复用** | WebSocket 长连接，避免频繁握手 | 减少网络开销 |

目标延迟：STT < 500ms，LLM 首字 < 300ms，TTS 首帧 < 200ms，端到端 < 1.5s。
