# PineaStudio — Development Design Document

> 本地 AI 多后端统一管理平台。Ubuntu，简洁可用。

---

## 1. Overview

PineaStudio 是多个推理后端的**统一管理前端**，自身不做推理。

核心能力：
- 聚合多个后端（Ollama / llama-server / llama.cpp-omni / 任意 OpenAI 兼容）的模型列表
- 提供 Chat Playground（文本 + 多模态）
- 提供 HuggingFace 模型搜索与下载
- 提供统一 OpenAI 兼容代理（`/v1/*`，自动路由到对应后端）
- 管理托管后端的生命周期（启停、配置）
- 系统资源监控（GPU / 内存）

---

## 2. Architecture

```
                         ┌──────────────────────┐
                         │   Browser (:8000)    │
                         └──────────┬───────────┘
                                    │
┌───────────────────────────────────▼───────────────────────────────────┐
│                        PineaStudio (:8000)                           │
│                                                                      │
│  FastAPI                                                             │
│  ├── Static Files ──→ React SPA (build artifacts)                    │
│  ├── /api/backends/*   后端 CRUD + 状态                              │
│  ├── /api/models/*     聚合模型列表                                   │
│  ├── /api/hub/*        HuggingFace 搜索 & 下载                       │
│  ├── /api/system/*     GPU / 内存 / 磁盘                             │
│  ├── /v1/*             OpenAI 兼容代理 (路由到后端)                    │
│  └── /ws/downloads     WebSocket 下载进度推送                         │
│                                                                      │
│  BackendManager                                                      │
│  ├── OllamaBackend       (external, :11434)                          │
│  ├── LlamaServerBackend  (managed,  :8080)                           │
│  ├── OmniServerBackend   (managed,  :9060)                           │
│  └── OpenAICompatBackend (external, user-defined)                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
   ┌───────────┐      ┌────────────┐      ┌──────────────┐
   │  Ollama   │      │llama-server│      │llama.cpp-omni│   ...
   │  :11434   │      │  :8080     │      │  :9060       │
   └───────────┘      └────────────┘      └──────────────┘
```

---

## 3. Model Storage Strategy

### 3.1 问题：模型散落各处

各后端各自管理模型存储，同一个模型可能被存多份：

```
~/.ollama/models/blobs/sha256-xxxx          ← Ollama (自有 blob 格式, 不是原始 GGUF)
~/.cache/huggingface/hub/models--Qwen--...  ← HF Hub cache (原始文件)
~/.cache/llama.cpp/hf/...                   ← llama.cpp 自己的 HF cache
~/random/path/model.gguf                    ← 用户手动下载的
```

一个 8B 模型 ~5GB，重复存储浪费严重。

### 3.2 策略：不拷贝，用 symlink

**核心原则：PineaStudio 不拷贝模型文件，只建立符号链接。**

```
~/.pineastudio/models/                      ← llama-server --models-dir 指向这里
├── qwen3-8b-q4_k_m.gguf                   → symlink → ~/.cache/huggingface/hub/models--Qwen--xxx/snapshots/.../qwen3-8b-q4_k_m.gguf
├── gemma-3-4b-it-q4_k_m.gguf              → symlink → ~/Downloads/gemma-3-4b-it-q4_k_m.gguf
└── my-custom-model.gguf                    → 直接文件 (用户手动放的)
```

**各后端的模型存储方式：**

| 后端 | 模型存在哪 | PineaStudio 怎么处理 |
|------|-----------|---------------------|
| **Ollama** | `~/.ollama/models/` (Ollama 管理) | **不碰**。Ollama 自己管，PineaStudio 只通过 API 查询模型列表 |
| **llama-server** | `~/.pineastudio/models/` | 通过 `--models-dir` 指向此目录，内含 symlink 或真实文件 |
| **llama.cpp-omni** | `~/.pineastudio/models-omni/` | 模型组目录，存放 MiniCPM-o 全部组件 |
| **HF 下载** | `~/.cache/huggingface/hub/` (HF SDK 管理) | 下载完后在 `models/` 创建 symlink 指向 HF cache 中的文件 |
| **手动导入** | 用户指定路径 | 在 `models/` 创建 symlink 指向原始路径，不移动文件 |
| **外接后端** | 远程/其他机器 | **不涉及**本地存储 |

### 3.3 HuggingFace 下载流程（避免重复）

```
用户点击下载 "Qwen/Qwen3-8B-GGUF" 的 qwen3-8b-q4_k_m.gguf
  │
  ├─ 1. 检查 HF cache 中是否已有该文件
  │     ~/.cache/huggingface/hub/models--Qwen--Qwen3-8B-GGUF/...
  │     → 已有: 跳过下载
  │
  ├─ 2. huggingface_hub.hf_hub_download()
  │     → 下载到 HF cache (SDK 默认行为, 支持断点续传)
  │     → 实际文件在 cache 的 blobs/ 目录, snapshots 目录有 symlink
  │
  ├─ 3. 在 ~/.pineastudio/models/ 创建 symlink
  │     ln -s ~/.cache/huggingface/hub/.../qwen3-8b-q4_k_m.gguf
  │           ~/.pineastudio/models/qwen3-8b-q4_k_m.gguf
  │
  └─ 4. llama-server 通过 --models-dir 自动发现
```

**好处：**
- 模型只存一份 (HF cache 里)
- 如果用户之前用 `huggingface-cli download` 下过，PineaStudio 能直接复用
- 删除 symlink 不会删除原始文件，安全
- `llama-server` 只认 `models/` 目录，不需要知道文件实际在哪

### 3.4 模型导入（已有文件）

```
用户在 UI 点 "导入本地模型"
  → 选择文件路径: /data/my-models/qwen3-8b.gguf
  → PineaStudio: ln -s /data/my-models/qwen3-8b.gguf ~/.pineastudio/models/
  → 不拷贝, 不移动, 零额外磁盘开销
```

### 3.5 模型删除

```
用户在 UI 删除一个模型:
  ├─ 如果是 symlink → 只删 symlink, 原始文件保留
  ├─ 如果是真实文件 → 提示 "将永久删除文件 (5.2GB), 确认?"
  └─ 如果是 Ollama 的模型 → 调 Ollama API 删除 (ollama rm), 或提示用户自己删
```

### 3.6 Data Directory

```
~/.pineastudio/
├── config.toml                  # 全局配置
├── pineastudio.db               # SQLite (后端注册、下载任务、对话历史)
├── models/                      # llama-server models-dir (symlinks + real files)
│   ├── qwen3-8b-q4_k_m.gguf    → symlink → ~/.cache/huggingface/...
│   └── custom-model.gguf       → real file
├── models-omni/                 # MiniCPM-o 模型组
│   └── MiniCPM-o-4_5-gguf/
│       ├── MiniCPM-o-4_5-Q4_K_M.gguf
│       ├── audio/
│       ├── vision/
│       ├── tts/
│       └── token2wav-gguf/
├── bin/                         # 托管后端二进制
│   ├── llama-server
│   └── llama-omni-cli
└── logs/                        # 后端进程日志
    ├── llama-server.log
    └── omni-server.log
```

---

## 4. Configuration (`config.toml`)

```toml
[server]
host = "127.0.0.1"
port = 8000

[storage]
models_dir = "~/.pineastudio/models"
models_omni_dir = "~/.pineastudio/models-omni"

[huggingface]
# HF token for gated models (Llama etc). Leave empty if not needed.
token = ""

# 后端注册持久化在 SQLite 中, 不在 config.toml 里
```

---

## 5. Backend Abstraction

### 5.1 Base Protocol

```python
from enum import Enum
from typing import AsyncIterator
from dataclasses import dataclass

class BackendType(Enum):
    MANAGED = "managed"      # PineaStudio 管理生命周期
    EXTERNAL = "external"    # 外部已运行的服务

@dataclass
class ModelInfo:
    id: str                  # 全局唯一: "{backend_id}/{model_name}"
    name: str                # 后端原始模型名
    backend_id: str          # 所属后端 ID
    backend_type: str        # "ollama" / "llama-server" / "omni" / "openai-compat"
    size_bytes: int | None   # 模型文件大小
    details: dict            # 后端特定元数据

class Backend:
    id: str                  # 用户自定义或自动生成, 如 "ollama-local"
    backend_type: str        # "ollama" / "llama-server" / "omni" / "openai-compat"
    kind: BackendType        # managed / external
    base_url: str            # "http://localhost:11434"

    async def health_check(self) -> bool
    async def list_models(self) -> list[ModelInfo]
    async def proxy_request(self, path: str, request) -> Response
    async def proxy_stream(self, path: str, request) -> AsyncIterator[bytes]
```

### 5.2 Managed Backend (additional)

```python
class ManagedBackend(Backend):
    kind = BackendType.MANAGED

    async def start(self, config: dict) -> None
    async def stop(self) -> None
    async def restart(self) -> None
    def is_running(self) -> bool
    def get_process_info(self) -> dict  # pid, uptime, memory
```

### 5.3 Backend Implementations

| Backend | Type | Model Names | API Base | Notes |
|---------|------|-------------|----------|-------|
| `OllamaBackend` | external | `qwen3:8b`, `gemma3:4b` | `http://host:11434` | 用 `/api/tags` 列模型，用 `/v1/*` 代理 |
| `LlamaServerBackend` | managed | `qwen3-8b-q4.gguf` | `http://host:8080` | router mode, `--models-dir` |
| `OmniServerBackend` | managed | `MiniCPM-o-4_5` | `http://host:9060` | 额外 `/v1/stream/*` 端点 |
| `OpenAICompatBackend` | external | 任意 | 用户配置 | 通用 fallback |

---

## 6. Model Naming Convention

跨后端路由的关键问题：同一请求中的 `model` 字段如何定位到具体后端？

**方案：`{backend_id}/{original_model_name}`**

```
ollama-local/qwen3:8b           → 路由到 Ollama 后端
llama/qwen3-8b-q4_k_m.gguf     → 路由到 llama-server 后端
omni/MiniCPM-o-4_5             → 路由到 omni 后端
remote-api/gpt-4o               → 路由到用户配置的远程 API
```

**规则：**
1. 前端 UI 统一显示 `{backend_id}/{model_name}`, 用户选择时自动携带
2. 代理层 (`/v1/*`) 根据 `/` 前的 prefix 路由到对应后端
3. 转发给后端时**去掉 prefix**，只传原始 model name
4. 如果请求中 model 字段不含 `/`，尝试在所有后端中匹配（ambiguous fallback）
5. 如果只有一个后端，允许省略 prefix

---

## 7. API Design

### 7.1 Backend Management

```
GET    /api/backends                    # 列出所有后端
POST   /api/backends                    # 注册新后端
GET    /api/backends/{id}               # 获取后端详情
PUT    /api/backends/{id}               # 更新后端配置
DELETE /api/backends/{id}               # 移除后端
POST   /api/backends/{id}/start         # 启动托管后端
POST   /api/backends/{id}/stop          # 停止托管后端
GET    /api/backends/{id}/health        # 健康检查
```

**POST /api/backends request body:**
```json
{
  "id": "ollama-local",
  "type": "ollama",
  "base_url": "http://localhost:11434",
  "auto_connect": true
}
```

### 7.2 Model Aggregation

```
GET    /api/models                      # 聚合所有后端的模型 (含来源标注)
GET    /api/models/{backend_id}/{name}  # 单个模型详情
```

**GET /api/models response:**
```json
{
  "models": [
    {
      "id": "ollama-local/qwen3:8b",
      "name": "qwen3:8b",
      "backend_id": "ollama-local",
      "backend_type": "ollama",
      "size_bytes": 4920000000,
      "status": "ready",
      "details": { "parameter_size": "8B", "quantization": "Q4_0" }
    },
    {
      "id": "llama/gemma-3-4b-it-q4_k_m.gguf",
      "name": "gemma-3-4b-it-q4_k_m.gguf",
      "backend_id": "llama",
      "backend_type": "llama-server",
      "size_bytes": 2800000000,
      "status": "unloaded",
      "details": {}
    }
  ]
}
```

### 7.3 HuggingFace Hub

```
GET    /api/hub/search?q=qwen+gguf&sort=downloads  # 搜索 HF 模型
GET    /api/hub/model/{repo_id}                     # 模型详情 + 文件列表
POST   /api/hub/download                            # 开始下载
GET    /api/hub/downloads                            # 下载任务列表 (进度)
DELETE /api/hub/downloads/{task_id}                  # 取消下载
```

**POST /api/hub/download request body:**
```json
{
  "repo_id": "Qwen/Qwen3-8B-GGUF",
  "filename": "qwen3-8b-q4_k_m.gguf",
  "target_backend": "llama"
}
```

### 7.4 System Info

```
GET    /api/system/info         # GPU, CPU, 内存, 磁盘概览
GET    /api/system/gpu          # nvidia-smi 详细信息
```

### 7.5 OpenAI Compatible Proxy

```
POST   /v1/chat/completions     # 路由到对应后端 (根据 model 字段)
GET    /v1/models                # 聚合所有后端模型 (OpenAI 格式)
POST   /v1/embeddings           # 路由到对应后端
POST   /v1/completions          # 路由到对应后端
```

**代理要求：**
- SSE 流式响应: 禁用 response buffering, 逐 chunk 转发
- 超时: 推理请求不限时 (模型首次加载可能 > 60s)
- 错误处理: 后端不可用时返回标准 OpenAI 错误格式

---

## 8. Frontend Pages

| Page | Route | 功能 |
|------|-------|------|
| **Models** | `/` | 聚合模型列表 + HF 搜索下载 + 模型管理 |
| **Chat** | `/chat` | 文本对话 Playground (选模型, stream, 参数调节) |
| **Omni** | `/omni` | MiniCPM-o 语音/视频对话 (Phase 2) |
| **System** | `/system` | GPU/内存/磁盘监控, 后端状态 |
| **Settings** | `/settings` | 后端注册管理, HF token, 存储路径 |

**前端技术栈:** React + Vite + TypeScript。构建产物嵌入 FastAPI `StaticFiles`。

---

## 9. Project Structure

```
pineastudio/
├── pyproject.toml
├── .gitignore
│
├── src/pineastudio/                   # Python package (src layout)
│   ├── __init__.py                    # version
│   ├── main.py                        # FastAPI app + startup + CLI entry
│   ├── config.py                      # Settings (pydantic-settings, 读 config.toml)
│   ├── db.py                          # SQLite via aiosqlite (backends, downloads)
│   │
│   ├── routers/
│   │   ├── backends.py                # /api/backends/*
│   │   ├── models.py                  # /api/models/*
│   │   ├── hub.py                     # /api/hub/*
│   │   ├── system.py                  # /api/system/*
│   │   └── proxy.py                   # /v1/* (OpenAI proxy)
│   │
│   ├── services/
│   │   ├── backend_manager.py         # BackendManager (registry, routing)
│   │   ├── backends/
│   │   │   ├── base.py                # Backend / ManagedBackend protocols
│   │   │   ├── ollama.py              # OllamaBackend
│   │   │   ├── llama_server.py        # LlamaServerBackend (managed)
│   │   │   ├── omni_server.py         # OmniServerBackend (managed)
│   │   │   └── openai_compat.py       # OpenAICompatBackend (generic)
│   │   ├── downloader.py             # HF model download (huggingface_hub)
│   │   └── hardware.py               # GPU/memory detection (nvidia-smi, psutil)
│   │
│   └── schemas.py                     # Pydantic models (API request/response)
│
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/                       # API client (fetch wrappers)
│       │   └── client.ts
│       ├── pages/
│       │   ├── Models.tsx
│       │   ├── Chat.tsx
│       │   ├── OmniChat.tsx           # Phase 2
│       │   ├── System.tsx
│       │   └── Settings.tsx
│       └── components/
│           ├── ChatMessage.tsx
│           ├── ModelCard.tsx
│           ├── DownloadProgress.tsx
│           └── Layout.tsx
│
└── docs/
    ├── think.md                       # 思考过程记录
    └── design.md                      # 本文件
```

---

## 10. Key Flows (Sequence)

### 10.1 Startup

```
pineastudio CLI
  │
  ├─ 1. Load config.toml (create default if missing)
  ├─ 2. Init SQLite DB (create tables if missing)
  ├─ 3. Start FastAPI on :8000
  ├─ 4. BackendManager.auto_discover():
  │     ├─ Check Ollama at localhost:11434 → if alive, register
  │     ├─ Check llama-server binary → if found, start with --models-dir
  │     └─ Load saved backends from DB
  ├─ 5. Serve frontend SPA
  └─ 6. Open browser (optional, --no-browser flag)
```

### 10.2 Chat (text)

```
User selects "ollama-local/qwen3:8b", types message
  │
  ├─ Frontend: POST /v1/chat/completions
  │     body: { model: "ollama-local/qwen3:8b", messages: [...], stream: true }
  │
  ├─ proxy.py: parse model → backend_id="ollama-local", model="qwen3:8b"
  ├─ BackendManager.get("ollama-local") → OllamaBackend
  ├─ OllamaBackend.proxy_stream("/v1/chat/completions", modified_body)
  │     (modified_body has model="qwen3:8b" without prefix)
  │
  ├─ SSE chunks forwarded to frontend (no buffering)
  └─ Frontend renders tokens incrementally
```

### 10.3 Model Download

```
User searches "Qwen3 8B GGUF" in Hub page
  │
  ├─ GET /api/hub/search?q=Qwen3+8B+GGUF
  ├─ Backend: huggingface_hub.list_models(search=..., library="gguf")
  ├─ User clicks download on "qwen3-8b-q4_k_m.gguf" (2.8GB)
  │
  ├─ POST /api/hub/download
  │     body: { repo_id: "Qwen/Qwen3-8B-GGUF", filename: "..." }
  │
  ├─ Backend: check disk space (warn if < model size * 1.2)
  ├─ Check HF cache: already downloaded? → skip, just create symlink
  ├─ Otherwise: create download task in DB → start async download
  ├─ WebSocket /ws/downloads → push progress updates (%, speed, ETA)
  ├─ huggingface_hub.hf_hub_download() → file lands in HF cache
  │
  ├─ Create symlink: ~/.pineastudio/models/qwen3-8b-q4_k_m.gguf → HF cache
  ├─ llama-server auto-discovers via --models-dir
  └─ Model appears in aggregated list
```

### 10.4 First Run

```
User runs `pineastudio` for the first time
  │
  ├─ ~/.pineastudio/ created with default config.toml
  ├─ No backends found → UI shows "Getting Started" guide:
  │     ┌─────────────────────────────────────────┐
  │     │  Welcome to PineaStudio!                │
  │     │                                         │
  │     │  No inference backends detected.        │
  │     │  Choose how to get started:             │
  │     │                                         │
  │     │  [Connect Ollama]  ← if ollama installed│
  │     │  [Setup llama-server]  ← auto download  │
  │     │  [Add custom endpoint]                  │
  │     └─────────────────────────────────────────┘
  │
  ├─ User picks "Connect Ollama"
  │     → auto-detect at :11434 → register → show models
  │
  └─ Or "Setup llama-server"
       → download binary from GitHub Release
       → start with empty models-dir
       → redirect to Hub page to download first model
```

---

## 11. SSE Streaming Proxy

流式代理是 PineaStudio 最关键的技术点之一。

```python
from starlette.responses import StreamingResponse
import httpx

async def proxy_stream(backend_url: str, body: dict):
    async def event_generator():
        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST",
                f"{backend_url}/v1/chat/completions",
                json=body,
                timeout=None,   # 推理无超时限制
            ) as resp:
                async for chunk in resp.aiter_bytes():
                    yield chunk

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # 禁用 nginx 缓冲 (如果前面有)
        },
    )
```

---

## 12. Dependencies

### Python (pyproject.toml)

```
fastapi
uvicorn[standard]
httpx               # async HTTP client (backend proxy)
huggingface-hub     # model search & download
aiosqlite           # async SQLite
pydantic-settings   # config management
psutil              # system resource monitoring
websockets          # download progress push
```

### Frontend (package.json)

```
react, react-dom, react-router-dom
@tanstack/react-query     # API state management
typescript, vite
tailwindcss               # styling
lucide-react              # icons
```

---

## 13. Development Phases

### Phase 1 — Core (MVP)

能跑通"选模型 → 对话"的完整链路。

| # | Task | Details |
|---|------|---------|
| 1 | 项目脚手架 | pyproject.toml, FastAPI 骨架, React + Vite 初始化 |
| 2 | 配置系统 | config.toml, Settings model, 数据目录创建 |
| 3 | Backend 抽象 | base.py, BackendManager |
| 4 | Ollama 后端 | OllamaBackend: health, list_models, proxy/proxy_stream |
| 5 | llama-server 后端 | LlamaServerBackend: start/stop + 同上 |
| 6 | OpenAI 代理 | /v1/* 路由，SSE streaming proxy |
| 7 | 模型聚合 API | /api/models (合并所有后端) |
| 8 | Chat 页面 | 模型选择, 对话, 流式输出, temperature/max_tokens |
| 9 | 模型管理页面 | 本地模型列表, 来源标注 |
| 10 | HF 下载 | /api/hub/search, /api/hub/download, 进度推送 |
| 11 | 系统监控 | /api/system/info, GPU/内存/磁盘 |
| 12 | 首次运行引导 | 无后端时的 setup wizard |

### Phase 2 — MiniCPM-o Omni

| # | Task | Details |
|---|------|---------|
| 1 | OmniServerBackend | 编译管理, start/stop, omni 端点代理 |
| 2 | MiniCPM-o 模型组下载 | 一键下载全部 GGUF 组件 (~9GB Q4_K_M) |
| 3 | 语音对话 UI | 浏览器录音 → prefill → decode → TTS 播放 |
| 4 | 视觉对话 UI | 图片/摄像头输入 → 视觉理解 |

### Phase 3 — Polish

| # | Task | Details |
|---|------|---------|
| 1 | 对话历史持久化 | SQLite 存储, 历史列表 |
| 2 | 模型对比 (A/B) | 两个模型同时回答 |
| 3 | OpenAI compat 后端 | 通用外接 (vLLM, SGLang, remote) |
| 4 | Ollama pull 集成 | 在 PineaStudio UI 里拉取 Ollama 模型 |
| 5 | API Key 管理 | 给 /v1/* 代理加认证 |

---

## 14. Decisions Log

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | 不自己做推理 | llama-server / Ollama 已足够好，聚合是更高的价值 |
| 2 | FastAPI + React | Python ML 生态好; React 开发体验好, build 后零依赖 |
| 3 | 多后端同时运行 | 用户可能 Ollama + llama-server 共存, 约束是硬件不是软件 |
| 4 | `backend_id/model_name` 路由 | 简单明确, 避免模型名冲突 |
| 5 | SQLite (not JSON) | 后端注册/下载任务需要 query, JSON 不够 |
| 6 | 托管后端二进制自动下载 | 用户体验优先, 减少安装步骤 |
| 7 | 统一代理 + 直连都支持 | 代理方便 (一个端口), 直连低延迟 |
| 8 | HF token in config.toml | gated models 需要, 但不强制 |
| 9 | 只支持 Ubuntu | 减少跨平台开发和测试成本 |
| 10 | Phase 1 不含 omni | 先跑通文本对话 MVP, 再扩展多模态 |
| 11 | symlink 而非拷贝模型文件 | 避免重复存储浪费磁盘，HF 下载存 HF cache，models/ 只放 symlink |
| 12 | 各后端模型存储各自管理 | Ollama 的模型 PineaStudio 不碰，只通过 API 查询。不试图统一存储 |

---

## 15. Non-Goals (明确不做)

- 自研推理引擎
- 模型训练/微调（至少短期内）
- 用户认证/多用户系统
- 跨平台 (Windows/macOS)
- Docker 作为唯一部署方式
- 移动端适配

---

*Created: 2026-04-10*
