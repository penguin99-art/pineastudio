# PineaStudio — 本地 AI 多后端统一管理平台

> 目标：Ubuntu 上简洁可用，不追求跨平台，不过度设计。

## 核心发现：不要重复造轮子

调研后发现 **llama.cpp server** (2025.12 新增 router mode) 已经内置了：
- OpenAI 兼容 API (`/v1/chat/completions`, `/v1/models` 等)
- 多模型管理（自动发现、按需加载、LRU 淘汰）
- 多进程架构（单个模型崩溃不影响其他）
- 内置 Web UI（含模型切换下拉框）
- 多模态支持（mmproj）
- HuggingFace 模型下载（`llama-server -hf user/model`）

参考: [llama.cpp Model Management](https://huggingface.co/blog/ggml-org/model-management-in-llamacpp)

**结论：PineaStudio 不需要自己实现推理层和 OpenAI API，站在巨人肩膀上。**

### llama.cpp-omni（MiniCPM-o 全模态支持）

[llama.cpp-omni](https://github.com/tc-mb/llama.cpp-omni) 是 llama.cpp 的 fork，专为 **MiniCPM-o 4.5** 全模态推理打造：

- **是 llama.cpp 的超集** — 包含标准 llama-server 的所有功能（OpenAI API、router mode 等）
- **额外增加 omni 端点**：`/v1/stream/omni_init`、`/v1/stream/prefill`、`/v1/stream/decode`
- 支持完整的视觉 + 音频输入、TTS 语音合成、全双工流式对话
- 模型拆分为独立 GGUF 模块：VPM (视觉) + APM (音频) + LLM (Qwen3-8B) + TTS + Token2Wav
- Q4_K_M 量化下 ~9GB 显存即可跑全模态

**关键发现：标准 llama.cpp 只支持 MiniCPM-o 的图片理解，不支持音频/TTS/全双工。**
要完整跑 MiniCPM-o 的语音交互，必须用 llama.cpp-omni。

### 推理后端策略 — 多后端并存

PineaStudio 不绑定单一推理引擎，而是作为**多后端的统一管理前端**。
后端分两类：

```
┌─ 托管后端 (PineaStudio 负责启停) ────────────────────┐
│                                                      │
│  llama-server (标准版)    — 文本 LLM + 基础视觉       │
│  llama.cpp-omni server   — MiniCPM-o 全模态          │
│                                                      │
└──────────────────────────────────────────────────────┘

┌─ 外接后端 (已在运行，PineaStudio 只连接) ────────────┐
│                                                      │
│  Ollama          — ollama 已有的模型直接用            │
│  任意 OpenAI 兼容服务 — vLLM / SGLang / 远程 API 等  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**多后端可以同时运行**，约束是硬件资源（显存/内存）而不是进程数。例如：
- Ollama 跑着 qwen3:8b + llama-server 跑着另一个 GGUF 模型
- Ollama 在 CPU 上跑小模型 + llama.cpp-omni 在 GPU 上跑 MiniCPM-o
- 只用 Ollama（机器上已经装了，不想再装别的）

PineaStudio 汇聚所有后端的模型列表，用户在 Chat 里选模型时能看到来自所有后端的模型。

---

## 定位：多推理后端的统一管理前端

```
PineaStudio 的价值 = 
    多后端统一管理 (llama-server / llama.cpp-omni / Ollama / 任意 OpenAI 兼容)
  + 更好的模型发现与下载体验 (HuggingFace 浏览/搜索/一键下载)
  + 更友好的 Chat Playground (文本 + 语音/视觉多模态)
  + 系统资源监控 (GPU/内存)
  + MiniCPM-o 全模态交互 UI (语音对话、视频通话)
```

后端做重活（推理），PineaStudio 做管理、聚合和体验。

---

## 架构

```
┌──────────────────────────────────────────────────────────────┐
│                       PineaStudio (:8000)                    │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │             Web UI (前端, 内嵌在 FastAPI 中)            │  │
│  │                                                        │  │
│  │  模型管理 │ Chat Playground │ 语音/视频 │ 系统监控     │  │
│  └──────────────────────┬─────────────────────────────────┘  │
│                         │                                    │
│  ┌──────────────────────▼─────────────────────────────────┐  │
│  │              FastAPI 管理服务                           │  │
│  │                                                        │  │
│  │  /api/hub/*        HF 模型搜索下载                     │  │
│  │  /api/models/*     聚合所有后端的模型列表               │  │
│  │  /api/backends/*   后端管理 (注册/启停/状态)            │  │
│  │  /api/system/*     系统资源信息                         │  │
│  │  /v1/*             统一 OpenAI 代理 (路由到对应后端)    │  │
│  └──────────────────────┬─────────────────────────────────┘  │
│                         │                                    │
│     ┌───────────────────┼───────────────────────┐            │
│     │ BackendManager    │                       │            │
│     │ (注册、发现、路由) │                       │            │
│     └───────────────────┼───────────────────────┘            │
│                         │                                    │
│         ┌───────────────┼──────────────┐                     │
│         ▼               ▼              ▼                     │
│  ┌─────────────┐ ┌────────────┐ ┌─────────────────┐         │
│  │ llama-server│ │ llama.cpp  │ │ Ollama          │         │
│  │ (托管)      │ │ -omni(托管)│ │ (外接)          │         │
│  │ :8080       │ │ :9060      │ │ :11434          │         │
│  │             │ │            │ │                 │         │
│  │ 文本/视觉   │ │ MiniCPM-o  │ │ qwen/gemma/...  │         │
│  │ GGUF 模型   │ │ 全模态     │ │ ollama 管理的   │         │
│  └─────────────┘ └────────────┘ │ 所有模型        │         │
│                                  └─────────────────┘         │
│         还可以接更多...                                       │
│  ┌──────────────────────────────────────┐                    │
│  │ 任意 OpenAI 兼容服务 (外接)          │                    │
│  │ vLLM / SGLang / 远程 API / ...       │                    │
│  └──────────────────────────────────────┘                    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**设计要点：**

1. **统一模型视图** — `/api/models` 聚合所有后端的模型列表，用户在 UI 里看到一个统一列表，
   每个模型标注来源（llama-server / Ollama / omni / ...）

2. **统一 OpenAI 代理** (可选) — PineaStudio 自身在 `:8000` 也暴露 `/v1/*`，
   根据请求的 `model` 字段路由到对应后端。外部应用只需记住一个地址。
   也可以直接调各后端的原始端口。

3. **后端分两类**：
   - **托管后端**: PineaStudio 负责启停（llama-server、llama.cpp-omni）
   - **外接后端**: 已在运行，PineaStudio 只连接（Ollama、vLLM、远程 API）
   
4. **多后端可同时运行** — 约束是硬件资源，不是软件限制。
   PineaStudio 只提供资源监控，让用户自己判断。

---

## 技术选型（从简）

| 组件 | 选择 | 理由 |
|------|------|------|
| 推理后端 (托管) | llama-server / llama.cpp-omni | GGUF 推理，PineaStudio 管理生命周期 |
| 推理后端 (外接) | Ollama / 任意 OpenAI 兼容 | 已在运行的服务，PineaStudio 只连接 |
| 管理后端 | Python + FastAPI | 轻量，与 huggingface_hub 集成方便 |
| 前端 | 内嵌的单页应用 (Vanilla/轻量框架) | 由 FastAPI 直接 serve 静态文件，无需单独构建 |
| 模型下载 | huggingface_hub Python SDK | 断点续传、模型搜索、元数据 |
| 数据存储 | SQLite + JSON 配置文件 | 零依赖 |
| 进程管理 | Python subprocess | 管理 llama-server 启停 |

**前端方案对比：**

| 方案 | 优点 | 缺点 |
|------|------|------|
| Gradio | 零前端代码，内置 Chat 组件 | 定制性差，依赖重 |
| React + Vite | 灵活强大 | 需要 Node.js 构建，增加复杂度 |
| **htmx + Jinja2** | 无构建步骤，由后端渲染，简洁 | 复杂交互稍弱 |
| **Vue/React (打包后嵌入)** | 开发体验好，构建后只是静态文件 | 开发时需要 Node |

**推荐**: 用 **React + Vite** 开发，`npm run build` 后把 dist 目录嵌入 FastAPI static files。开发体验好，部署时零依赖。

### Backend 抽象接口

所有后端实现统一接口，方便扩展：

```python
class Backend:
    name: str                          # "ollama", "llama-server", "omni", "openai-compat"
    type: "managed" | "external"       # 托管 or 外接
    base_url: str                      # "http://localhost:11434"

    async def list_models() -> list    # 获取该后端的模型列表
    async def health() -> bool         # 健康检查
    async def proxy(request) -> Response  # 代理 OpenAI 请求
    
    # 仅 managed 后端:
    async def start(**config) -> None  # 启动进程
    async def stop() -> None           # 停止进程
```

新增后端只需实现这个接口。比如将来接 vLLM，写个 `VllmBackend` 就行。

---

## 功能范围（MVP）

### 必做（Phase 1）
1. **llama-server 管理**
   - 自动下载/编译 llama.cpp（或检测已安装的）
   - 启动/停止 llama-server（router mode）
   - 配置参数（GPU layers, context size, models-max 等）

2. **模型管理**
   - 本地模型列表（扫描 models 目录）
   - 从 HuggingFace 搜索 GGUF 模型
   - 一键下载（断点续传、进度显示）
   - 删除模型

3. **Chat Playground**
   - 选择模型 → 对话（调用 llama-server 的 /v1/chat/completions）
   - 流式输出
   - 基本参数调节（temperature, max_tokens）

4. **系统信息**
   - GPU 信息（nvidia-smi）
   - 内存/显存使用
   - 已加载模型状态

### Phase 2 — MiniCPM-o 全模态接入
1. **llama.cpp-omni 后端管理**
   - 自动下载/编译 llama.cpp-omni
   - 启动 omni server，管理与标准 llama-server 的切换
   - MiniCPM-o 模型组下载（LLM + VPM + APM + TTS + Token2Wav，约 9GB Q4_K_M）

2. **语音对话 UI**
   - 浏览器录音 (Web Audio API) → 发送音频流
   - 接收 TTS 音频 → 播放
   - 调用 omni 端点（prefill + decode 循环）

3. **视觉对话 UI**
   - 图片上传 → 视觉理解
   - 摄像头/屏幕截图 → 实时视频交互（WebRTC，可参考 omni 自带 demo）

### 以后再说
- 对话历史持久化
- 模型对比 (A/B test)
- ModelScope 源
- Embedding / Image Gen
- API Key 管理

---

## 目录结构

```
pineastudio/
├── pineastudio/                  # Python 包
│   ├── __init__.py
│   ├── main.py                   # FastAPI 入口 + static files
│   ├── config.py                 # 配置 (模型目录、端口、llama-server 路径)
│   ├── routers/
│   │   ├── hub.py                # /api/hub/* — HF 模型搜索下载
│   │   ├── models.py             # /api/models/* — 聚合所有后端模型列表
│   │   ├── backends.py           # /api/backends/* — 后端注册/启停/状态
│   │   ├── proxy.py              # /v1/* — 统一 OpenAI 代理 (路由到后端)
│   │   └── system.py             # /api/system/* — GPU/内存信息
│   ├── services/
│   │   ├── backend_manager.py    # 后端统一管理 (注册/发现/路由)
│   │   ├── backends/
│   │   │   ├── base.py           # Backend 基类/协议
│   │   │   ├── llama_server.py   # llama-server 托管后端
│   │   │   ├── omni_server.py    # llama.cpp-omni 托管后端
│   │   │   └── ollama.py         # Ollama 外接后端
│   │   ├── model_downloader.py   # HF 模型下载
│   │   └── hardware.py           # 硬件检测 (nvidia-smi 等)
│   └── db.py                     # SQLite (模型注册、下载任务)
├── frontend/                     # React 前端 (开发用)
│   ├── package.json
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Models.tsx        # 模型管理 + HF 搜索
│   │   │   ├── Chat.tsx          # 文本对话 Playground
│   │   │   ├── OmniChat.tsx      # 语音/视频全模态对话 (MiniCPM-o)
│   │   │   └── System.tsx        # 系统监控
│   │   └── components/
│   └── dist/                     # build 产物, FastAPI serve 这里
├── pyproject.toml
└── .gitignore
```

~15 个文件就能跑起来的规模。

---

## 关键流程

### 启动流程
```
用户运行 pineastudio
  → FastAPI 启动 (:8000)
  → 扫描可用后端:
    → 检测 Ollama 是否在运行 (curl :11434/api/tags) → 有就自动注册
    → 检测 llama-server 二进制 → 有就启动 (router mode, :8080)
    → 检测 llama.cpp-omni 二进制 → 有就标记可用 (按需启动)
  → 打开浏览器 http://localhost:8000
```

### 模型下载流程
```
用户在 Web UI 搜索 "Qwen3 8B GGUF"
  → 后端调 huggingface_hub.search_models()
  → 返回模型列表 (名称、大小、量化方式)
  → 用户点击下载
  → 后端 huggingface_hub.hf_hub_download() 到 ~/.pineastudio/models/
  → WebSocket 推送下载进度
  → 下载完成 → llama-server 自动发现 (models-dir)
```

### 对话流程
```
用户在 Chat 页面选模型 (列表聚合了所有后端的模型)
  → 选了 Ollama 的 qwen3:8b
    → 前端 POST :8000/v1/chat/completions {model: "ollama/qwen3:8b"}
    → PineaStudio 代理到 Ollama :11434
  → 选了 llama-server 的 gemma-3-4b.gguf
    → 前端 POST :8000/v1/chat/completions {model: "llama/gemma-3-4b.gguf"}
    → PineaStudio 代理到 llama-server :8080
  → SSE 流式返回 → 前端逐字显示
```

### 后端注册流程
```
用户在设置页面 "添加后端"
  → 选择类型: Ollama / OpenAI 兼容 / llama-server / omni
  → 填入地址: http://192.168.1.100:11434
  → PineaStudio 验证连接 (GET /v1/models 或 /api/tags)
  → 注册成功 → 模型列表自动刷新
```

---

## 安装 & 运行（目标体验）

```bash
# 安装
pip install pineastudio

# 或者开发模式
git clone ... && cd pineastudio
pip install -e .

# 运行
pineastudio
# → 自动启动, 打开浏览器 http://localhost:8000

# 外部应用通过 PineaStudio 统一代理 (自动路由到对应后端)
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "ollama/qwen3:8b", "messages": [{"role": "user", "content": "你好"}]}'

# 也可以直连各后端
curl http://localhost:11434/v1/chat/completions ...   # Ollama
curl http://localhost:8080/v1/chat/completions ...     # llama-server
```

---

## 与现有方案对比

| | Ollama | LM Studio | Open WebUI | **PineaStudio** |
|---|---|---|---|---|
| 本质 | 推理引擎+CLI | 桌面应用 | 前端 UI | **多后端统一管理** |
| 推理 | 自研(基于llama.cpp) | 嵌入llama.cpp | 需外接Ollama | llama-server + omni + Ollama + ... |
| 多后端 | ❌ 单一 | ❌ 单一 | Ollama only | ✅ 任意 OpenAI 兼容后端 |
| 安装 | 简单 | 下载dmg/exe | Docker | pip install |
| 模型下载 | ollama pull | 内置UI | 不管 | HuggingFace搜索+下载 |
| OpenAI API | ✅ | ✅ | ❌ (只是UI) | ✅ (统一代理所有后端) |
| Web访问 | ❌ | ❌ | ✅ | ✅ |
| 全模态(语音/视频) | ❌ | ❌ | ❌ | ✅ (MiniCPM-o via omni) |

**PineaStudio 的独特价值**:
1. **统一管理多后端** — Ollama 的模型、llama-server 的模型、远程 API 都在一个界面里
2. **MiniCPM-o 全模态集成** — 市面上唯一把 llama.cpp-omni 包装成好用 UI 的方案
3. **统一 OpenAI 代理** — 外部应用只需一个端点，PineaStudio 自动路由到对应后端
4. 不重复造推理引擎，专注做**聚合、管理、体验**

---

## 开放问题

1. **推理后端二进制从哪来？**
   - 方案 A: 要求用户自己编译安装
   - 方案 B: PineaStudio 自动从 GitHub Release 下载预编译版
   - 方案 C: pip 包里打包 llama-cpp-python，用它的 server 模式
   - **倾向 B**: 自动下载预编译 llama-server；llama.cpp-omni 需要从源码编译（无预编译 release）

2. **llama.cpp-omni 的维护风险？**
   - 它是 fork，可能滞后于上游 llama.cpp
   - 目前活跃 (114 stars, 46 commits)，但长期不确定
   - **对策**: 标准模型用上游 llama-server，只有 MiniCPM-o 才用 omni fork
   - 如果上游 llama.cpp 以后原生支持 MiniCPM-o omni，可以切回

3. **统一代理 vs 直连？**
   - 统一代理 (PineaStudio :8000/v1/*) 对用户友好，只需记一个地址
   - 直连各后端端口延迟更低
   - **两种都支持**: 默认走统一代理，高级用户可以直连

4. **Ollama 集成深度？**
   - 最简: 只读取 Ollama 的模型列表 + 代理请求（通过 Ollama 的 OpenAI 兼容 API）
   - 更深: 在 PineaStudio UI 里触发 `ollama pull` 下载模型
   - **先做最简版**: 连接已运行的 Ollama，列出它的模型，代理 chat 请求

5. **MiniCPM-o 模型下载体验？**
   - 模型分多个文件 (LLM + VPM + APM + TTS + Token2Wav)，总共 ~9GB (Q4_K_M)
   - 需要作为一个"模型组"来管理，一键下载所有组件
   - HuggingFace 上有预转换的 GGUF

---

*更新: 2026-04-10*
