# PineaStudio — Development Design Document

> 边缘端 AI 伙伴：有记忆、有个性、能看能听能说，完全本地运行。

---

## 1. Overview

PineaStudio 是一个运行在边缘硬件（NVIDIA GB10）上的**本地 AI 伙伴**。

它不是一个工具平台，而是一个有记忆、有人格、能语音对话的个人助理。
底层聚合多个推理后端（Ollama / llama-server / llama.cpp-omni），自身不做推理。

核心能力：

| 层 | 能力 | 状态 |
|----|------|------|
| **对话** | Chat (文本) / Realtime (ASR→LLM→TTS) / Omni (全双工语音+视觉) | ✅ 已完成 |
| **后端管理** | 聚合多后端模型列表、生命周期管理、OpenAI 兼容代理 `/v1/*` | ✅ 已完成 |
| **模型获取** | HuggingFace 搜索下载、symlink 管理 | ✅ 已完成 |
| **系统监控** | GPU / 内存 / 磁盘 | ✅ 已完成 |
| **记忆** | SOUL.md / USER.md / MEMORY.md + prompt 注入 | 🔨 下一步 |
| **诞生仪式** | 首次访问时的沉浸式语音初始化 | 🔨 下一步 |

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
│  ├── /api/memory/*     记忆文件 CRUD (SOUL/USER/MEMORY)   ← NEW     │
│  ├── /api/setup/*      初始化仪式状态                      ← NEW     │
│  ├── /v1/*             OpenAI 兼容代理 (路由到后端)                    │
│  ├── /ws/downloads     WebSocket 下载进度推送                         │
│  └── /ws/realtime      WebSocket 语音对话 (ASR→LLM→TTS)   ← 复用    │
│                                                                      │
│  Services                                                            │
│  ├── BackendManager    后端注册/路由/生命周期                          │
│  ├── MemoryManager     记忆文件读写 + prompt_builder        ← NEW    │
│  ├── MemoryTool        add/replace/remove 记忆操作          ← NEW    │
│  └── ASR / TTS         faster-whisper / Edge TTS                     │
│                                                                      │
│  Backends                                                            │
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

## 3. Memory System

### 3.1 Overview

记忆是从"工具"到"伙伴"的核心跨越。没有记忆，每次打开都是陌生人。

设计原则（借鉴 Hermes Agent / PenguinAI / Vision-Agent）：
- Markdown 文件做主记忆（人可读、可 git 管理、LLM 直接读取）
- SQLite 做索引和检索（对话摘要、结构化事实）
- 冻结快照注入 system prompt（会话内不更新，保护 prefix cache）
- 助理通过 memory tool 自主管理记忆

### 3.2 Storage Layout

```
~/.pineastudio/
├── memory/                          # Markdown 文件 = 人可读的记忆
│   ├── SOUL.md                      # 助理人格定义 (~300 tokens)
│   ├── USER.md                      # 用户画像 (~500 tokens)
│   └── MEMORY.md                    # 助理认知索引 (~800 tokens)
│
├── daily/                           # 每日记录
│   ├── 2026-04-13.md
│   └── ...
│
└── pineastudio.db                   # SQLite
    ├── conversations                # 对话历史 (已有)
    ├── messages                     # 消息记录 (已有)
    ├── memory_episodes              # 对话摘要 (新增)
    └── memory_facts                 # 结构化事实 (新增)
```

### 3.3 Memory Files

```
SOUL.md — 助理人格 (~800 字符上限)
  名字、性格、说话风格、语言偏好
  由诞生仪式生成，用户可手动编辑
  注入 system prompt 最前面

USER.md — 用户画像 (~1375 字符上限)
  称呼、职业、兴趣、偏好、重要信息
  由诞生仪式初始化，助理通过 memory tool 持续更新

MEMORY.md — 助理认知 (~2200 字符上限)
  环境信息、项目笔记、经验教训
  由助理通过 memory tool 完全自主管理
  超出预算时，助理自己决定删什么
```

### 3.4 prompt_builder — 冻结快照注入

每次会话开始时读取记忆文件，拼接为 system prompt，整个会话期间不再更新。

```python
# services/memory_manager.py

class MemoryManager:
    def __init__(self, base_dir: Path):
        self.memory_dir = base_dir / "memory"
        self.daily_dir = base_dir / "daily"

    def build_system_prompt(self) -> str:
        """读三文件 + today daily → 拼接为 system prompt 冻结快照"""
        parts = []
        for name in ["SOUL.md", "USER.md", "MEMORY.md"]:
            path = self.memory_dir / name
            if path.exists():
                parts.append(path.read_text())

        today = self.daily_dir / f"{date.today()}.md"
        if today.exists():
            parts.append(today.read_text())

        return "\n\n---\n\n".join(p for p in parts if p.strip())

    def exists(self, filename: str) -> bool:
        return (self.memory_dir / filename).exists()

    def read(self, filename: str) -> str:
        path = self.memory_dir / filename
        return path.read_text() if path.exists() else ""

    def write(self, filename: str, content: str) -> None:
        self.memory_dir.mkdir(parents=True, exist_ok=True)
        (self.memory_dir / filename).write_text(content)

    def is_initialized(self) -> bool:
        """SOUL.md 存在 = 已经过诞生仪式"""
        return self.exists("SOUL.md")
```

### 3.5 Memory Tool — 助理管理自己的记忆

```python
# services/memory_tool.py

CHAR_LIMITS = {
    "MEMORY.md": 2200,
    "USER.md": 1375,
}

class MemoryTool:
    """
    memory tool — 助理通过 LLM tool_call 管理记忆
    支持 add / replace / remove 三种操作
    replace / remove 用子串匹配（LLM 天然擅长子串匹配，不擅长数行号）
    """

    def __init__(self, memory_manager: MemoryManager):
        self.mm = memory_manager

    def schema(self) -> dict:
        return {
            "name": "memory",
            "description": "管理持久记忆。记忆在下次会话中可用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["add", "replace", "remove"],
                    },
                    "file": {
                        "type": "string",
                        "enum": ["MEMORY.md", "USER.md"],
                    },
                    "content": {
                        "type": "string",
                        "description": "要添加/替换为的内容",
                    },
                    "old_content": {
                        "type": "string",
                        "description": "要被替换/删除的子串",
                    },
                },
                "required": ["action", "file"],
            },
        }

    def execute(self, action: str, file: str, content: str = "", old_content: str = "") -> str:
        text = self.mm.read(file)

        if action == "add":
            text += "\n" + content
        elif action == "replace":
            if old_content not in text:
                return f"Error: '{old_content[:50]}...' not found in {file}"
            text = text.replace(old_content, content, 1)
        elif action == "remove":
            if old_content not in text:
                return f"Error: '{old_content[:50]}...' not found in {file}"
            text = text.replace(old_content, "", 1)

        limit = CHAR_LIMITS.get(file)
        if limit and len(text) > limit:
            return f"Error: {file} would exceed {limit} chars ({len(text)}). Remove old content first."

        self.mm.write(file, text.strip())
        return f"OK: {action} on {file} ({len(text)} chars)"
```

### 3.6 Memory Integration Points

记忆通过 prompt_builder 注入三个对话通道：

| 通道 | 注入方式 | 说明 |
|------|---------|------|
| **Chat** (`/v1/chat/completions`) | 代理前 prepend system message | messages[0] 插入记忆 prompt |
| **Realtime** (`/ws/realtime`) | `run_turn()` 替换 SYSTEM_PROMPT | 动态组装替代硬编码常量 |
| **Omni** (`/ws/omni`) | `omni_init()` 注入 prompt | init 阶段传入记忆 prompt |

```python
# routers/proxy.py — Chat 接入示例

async def chat_completions(request: Request):
    body = await request.json()
    messages = body.get("messages", [])

    memory_prompt = memory_manager.build_system_prompt()
    if memory_prompt:
        messages.insert(0, {"role": "system", "content": memory_prompt})

    body["messages"] = messages
    # ... 正常代理到后端
```

### 3.7 对话结束摘要

每次 Chat 对话结束后，异步调用 LLM 提取摘要：

```python
async def summarize_conversation(messages: list[dict]):
    """对话结束后异步执行，不阻塞用户"""
    prompt = "请用 2-3 句话总结以下对话的要点：\n\n" + format_messages(messages)
    summary = await ollama_call(prompt)
    await db.insert_memory_episode(summary=summary, message_count=len(messages))
```

---

## 4. Birth Ceremony (诞生仪式)

### 4.1 Overview

首次访问时的全屏沉浸式语音对话。不是 setup wizard，是 first contact。
目的：让 AI "诞生"——获得名字、人格，同时了解用户。

**触发条件**：`SOUL.md` 不存在时，自动跳转到 `/setup`。

### 4.2 Flow

```
用户首次打开 PineaStudio
  │
  ├─ 前端检测: GET /api/memory/status → { initialized: false }
  ├─ 自动跳转 /setup
  │
  ▼
Phase 1: 等待觉醒
  全屏深色渐变 + 中央呼吸灯光球
  "准备好认识你的 AI 伙伴了吗？" + [开始] 按钮
  │
  ▼ 点击开始 → 请求麦克风 → 建立 /ws/realtime (mode=setup)
  │
Phase 2: 相遇 (Meet)
  AI 语音: "你好，我是一个刚刚醒来的 AI……你希望我叫什么名字？"
  光球随语音脉动
  │
Phase 3: 了解 (Understand)
  AI 通过自然对话了解用户（职业、兴趣、偏好）
  LLM 自适应引导：用户不确定时主动提供选项
  │
Phase 4: 试衣间 (Try On)
  AI 用不同人格风格说同一段话，让用户凭直觉选
  光球颜色/运动随风格变化
  │
Phase 5: 成形 (Crystallize)
  AI 用新人格做总结确认 → 用户确认/修改
  光球凝聚成形 → 完成动画
  │
  ▼
后台: finalize_setup()
  ├─ LLM 从对话中提取 → 生成 SOUL.md + USER.md
  ├─ 创建空 MEMORY.md
  ├─ 记录第一条 memory_episode
  └─ 跳转主页，AI 带着人格开始工作
```

### 4.3 Frontend: `/setup` Page

```
frontend/src/pages/Setup.tsx
├── 全屏沉浸式布局（无侧边栏、无导航）
├── OrbVisualizer 组件
│   ├── WebAudio API 驱动
│   ├── AI 说话 → 光球扩散 + 粒子飞散
│   └── 用户说话 → 光球收聚 + 粒子向心
├── 半透明字幕层（AI/用户文字实时显示）
├── 进度圆点（●●●○○ 第 3/5 步）
├── 麦克风权限请求 → WebSocket /ws/realtime
└── 渐变背景 + CSS 动画 + 光球状态机

不要的元素：
├── 聊天气泡（这不是聊天，是仪式）
├── 侧边栏/导航（全屏沉浸）
├── 模型选择/参数设置
└── 跳过按钮（可通过文字输入降级）
```

### 4.4 Backend: Realtime 管线复用

不新建 WebSocket 端点。在 `/ws/realtime` 上加 `setup_start` 消息类型：

```python
# routers/realtime.py — setup 模式扩展

SETUP_PROMPT = """你是一个刚刚被激活的 AI 助理。你还没有名字，没有性格……
（完整引导 prompt，包含引导策略矩阵和试衣间模式说明）"""

async def run_turn(ws, state):
    if state.mode == "setup":
        system_prompt = SETUP_PROMPT
    else:
        system_prompt = memory_manager.build_system_prompt() or DEFAULT_PROMPT

    # ASR → Ollama (with system_prompt) → TTS — 核心管线不变
    ...
```

### 4.5 finalize_setup()

对话结束后，用 LLM 从对话中提取结构化信息：

```python
async def finalize_setup(conversation: list[dict]):
    extraction_prompt = """
    从以下初始化对话中提取信息，生成两个 Markdown 文件：

    === 对话记录 ===
    {messages}

    === SOUL.md ===
    ```soul
    # [助理名字] — [用户名字]的个人助理
    ## 性格
    [性格特点]
    ## 说话风格
    [语气/风格偏好]
    ## 语言
    [语言偏好]
    ```

    === USER.md ===
    ```user
    # 用户画像
    ## 基本信息
    - 称呼: [用户名字]
    - 职业/领域: [职业]
    ## 初始印象
    [对话中观察到的特点]
    ```
    """

    result = await ollama_call(extraction_prompt.format(messages=format_msgs(conversation)))
    memory_manager.write("SOUL.md", extract_fenced(result, "soul"))
    memory_manager.write("USER.md", extract_fenced(result, "user"))
    memory_manager.write("MEMORY.md", "")
```

### 4.6 Text Fallback

无麦克风时降级：同样的全屏 UI + 视觉效果，对话通过文字输入框进行，
AI 回复仍有 TTS 语音输出（单向语音）。

---

## 5. Model Storage Strategy

### 5.1 核心原则：不拷贝，用 symlink

```
~/.pineastudio/models/                      ← llama-server --models-dir
├── qwen3-8b-q4_k_m.gguf                   → symlink → ~/.cache/huggingface/...
├── gemma-3-4b-it-q4_k_m.gguf              → symlink → ~/Downloads/...
└── my-custom-model.gguf                    → 直接文件 (用户手动放的)
```

### 5.2 各后端的模型存储

| 后端 | 模型存在哪 | PineaStudio 怎么处理 |
|------|-----------|---------------------|
| **Ollama** | `~/.ollama/models/` | 不碰。只通过 API 查询模型列表 |
| **llama-server** | `~/.pineastudio/models/` | `--models-dir` 指向此目录 |
| **llama.cpp-omni** | `~/.pineastudio/models-omni/` | MiniCPM-o 全部组件 |
| **HF 下载** | `~/.cache/huggingface/hub/` | 下载后在 models/ 创建 symlink |
| **手动导入** | 用户指定路径 | 在 models/ 创建 symlink |

### 5.3 HuggingFace 下载流程

```
用户点击下载 "Qwen/Qwen3-8B-GGUF" 的某个文件
  ├─ 1. 检查 HF cache 是否已有 → 已有则跳过下载
  ├─ 2. huggingface_hub.hf_hub_download() → 下载到 HF cache
  ├─ 3. 在 ~/.pineastudio/models/ 创建 symlink
  └─ 4. llama-server 通过 --models-dir 自动发现
```

---

## 6. Data Directory

```
~/.pineastudio/
├── config.toml                  # 全局配置
├── pineastudio.db               # SQLite
│   ├── backends                 # 后端注册
│   ├── conversations            # 对话历史
│   ├── messages                 # 消息记录
│   ├── downloads                # 下载任务
│   ├── memory_episodes          # 对话摘要 (新增)
│   └── memory_facts             # 结构化事实 (新增)
│
├── memory/                      # 记忆文件 (新增)
│   ├── SOUL.md                  # 助理人格
│   ├── USER.md                  # 用户画像
│   └── MEMORY.md                # 助理认知
│
├── daily/                       # 每日记录 (新增)
│   └── YYYY-MM-DD.md
│
├── models/                      # llama-server models-dir (symlinks)
│   └── *.gguf
├── models-omni/                 # MiniCPM-o 模型组
│   └── MiniCPM-o-4_5-gguf/
├── bin/                         # 托管后端二进制
│   ├── llama-server
│   └── llama-omni-cli
└── logs/                        # 后端进程日志
```

---

## 7. Configuration (`config.toml`)

```toml
[server]
host = "127.0.0.1"
port = 8000

[storage]
data_dir = "~/.pineastudio"
models_dir = "~/.pineastudio/models"
models_omni_dir = "~/.pineastudio/models-omni"

[huggingface]
token = ""
```

---

## 8. Backend Abstraction

### 8.1 Base Protocol

```python
class BackendType(Enum):
    MANAGED = "managed"      # PineaStudio 管理生命周期
    EXTERNAL = "external"    # 外部已运行的服务

@dataclass
class ModelInfo:
    id: str                  # "{backend_id}/{model_name}"
    name: str
    backend_id: str
    backend_type: str        # "ollama" / "llama-server" / "omni" / "openai-compat"
    size_bytes: int | None
    details: dict

class Backend:
    id: str
    backend_type: str
    kind: BackendType
    base_url: str

    async def health_check(self) -> bool
    async def list_models(self) -> list[ModelInfo]
    async def proxy_request(self, path: str, request) -> Response
    async def proxy_stream(self, path: str, request) -> AsyncIterator[bytes]
```

### 8.2 Managed Backend

```python
class ManagedBackend(Backend):
    kind = BackendType.MANAGED

    async def start(self, config: dict) -> None
    async def stop(self) -> None
    async def restart(self) -> None
    def is_running(self) -> bool
    def get_process_info(self) -> dict
```

### 8.3 Implementations

| Backend | Type | API Base | Notes |
|---------|------|----------|-------|
| `OllamaBackend` | external | `:11434` | `/api/tags` 列模型，`/v1/*` 代理 |
| `LlamaServerBackend` | managed | `:8080` | router mode, `--models-dir` |
| `OmniServerBackend` | managed | `:9060` | MiniCPM-o 全双工语音 + 视觉 |
| `OpenAICompatBackend` | external | user-defined | 通用 fallback |

---

## 9. Model Naming Convention

跨后端路由：`{backend_id}/{original_model_name}`

```
ollama-local/qwen3:8b           → Ollama
llama/qwen3-8b-q4_k_m.gguf     → llama-server
omni/MiniCPM-o-4_5             → llama.cpp-omni
remote-api/gpt-4o               → 外接 API
```

规则：
1. 前端显示 `{backend_id}/{model_name}`，选择时自动携带
2. 代理层按 `/` 前的 prefix 路由
3. 转发时去掉 prefix，只传原始 model name
4. 无 `/` 时尝试在所有后端匹配

---

## 10. API Design

### 10.1 Backend Management

```
GET    /api/backends                    # 列出所有后端
POST   /api/backends                    # 注册新后端
GET    /api/backends/{id}               # 后端详情
PUT    /api/backends/{id}               # 更新配置
DELETE /api/backends/{id}               # 移除后端
POST   /api/backends/{id}/start         # 启动托管后端
POST   /api/backends/{id}/stop          # 停止托管后端
GET    /api/backends/{id}/health        # 健康检查
```

### 10.2 Model Aggregation

```
GET    /api/models                      # 聚合所有后端模型
GET    /api/models/{backend_id}/{name}  # 单个模型详情
```

### 10.3 HuggingFace Hub

```
GET    /api/hub/search?q=...&sort=downloads   # 搜索
GET    /api/hub/model/{repo_id}               # 模型详情 + 文件列表
POST   /api/hub/download                      # 开始下载
GET    /api/hub/downloads                      # 下载任务列表
DELETE /api/hub/downloads/{task_id}            # 取消下载
```

### 10.4 System Info

```
GET    /api/system/info         # GPU, CPU, 内存, 磁盘
GET    /api/system/gpu          # nvidia-smi 详细信息
```

### 10.5 Conversations

```
GET    /api/conversations                    # 对话列表
POST   /api/conversations                    # 新建对话
GET    /api/conversations/{id}               # 对话详情 + 消息
DELETE /api/conversations/{id}               # 删除对话
POST   /api/conversations/{id}/messages      # 追加消息
```

### 10.6 Memory (新增)

```
GET    /api/memory/status                # { initialized: bool, files: {...} }
GET    /api/memory/{filename}            # 读取 SOUL.md / USER.md / MEMORY.md
PUT    /api/memory/{filename}            # 更新记忆文件内容
POST   /api/memory/tool                  # memory tool 调用 (add/replace/remove)
POST   /api/memory/reinitialize          # 备份旧文件 → 删除 SOUL.md → 重新初始化
```

**GET /api/memory/status response:**
```json
{
  "initialized": true,
  "files": {
    "SOUL.md": { "exists": true, "size": 423, "modified": "2026-04-13T10:30:00" },
    "USER.md": { "exists": true, "size": 287, "modified": "2026-04-13T10:30:00" },
    "MEMORY.md": { "exists": true, "size": 1024, "modified": "2026-04-13T15:20:00" }
  }
}
```

### 10.7 Setup (新增)

```
POST   /api/setup/finalize              # 对话结束后生成 SOUL.md + USER.md
```

通过 `/ws/realtime` (mode=setup) 进行语音对话，
对话完成后前端调 `/api/setup/finalize` 触发 `finalize_setup()`。

### 10.8 OpenAI Compatible Proxy

```
POST   /v1/chat/completions     # 路由到后端 (记忆 prompt 自动注入)
GET    /v1/models                # 聚合所有后端模型 (OpenAI 格式)
POST   /v1/embeddings           # 路由到后端
POST   /v1/completions          # 路由到后端
```

代理要求：
- SSE 流式响应：禁用 buffering，逐 chunk 转发
- 超时：推理请求不限时
- 记忆注入：`/v1/chat/completions` 代理前自动 prepend 记忆 system prompt
- 错误处理：后端不可用时返回标准 OpenAI 错误格式

### 10.9 WebSocket

```
/ws/downloads       # 下载进度推送 (已有)
/ws/realtime        # 语音对话 — 支持两种模式 (已有，扩展)
                    #   mode=chat    → 普通对话 (记忆 prompt 注入)
                    #   mode=setup   → 诞生仪式 (引导 prompt)
```

---

## 11. Frontend — UI Architecture

### 11.1 三层导航

UI 按用途分为三层，用户 95% 的时间在助理主界面：

```
┌──────────────────────────────────────────────────────────┐
│  🏠 助理    │   🎭 展示台 ▾   │   🔧 工作台 ▾    │  ● │
│  (默认)     │   ├ Omni        │   ├ Playground    │    │
│             │   └ Realtime    │   ├ 模型管理      │    │
│             │                 │   ├ 系统监控      │    │
│             │                 │   └ 设置          │    │
└──────────────────────────────────────────────────────────┘
```

| 层 | 页面 | Route | 功能 | 状态 |
|----|------|-------|------|------|
| **助理** | 主界面 | `/` | 和 AI 伙伴交流（文字+语音），带记忆和人格 | 🔨 重构 |
| **展示台** | Omni | `/showcase/omni` | MiniCPM-o 全双工语音 + 摄像头 | ✅ 迁移 |
| | Realtime | `/showcase/realtime` | ASR→LLM→TTS 语音管线展示 | ✅ 迁移 |
| **工作台** | Playground | `/studio/chat` | Chat 测试：选模型、调参数、对比输出 | ✅ 迁移 |
| | 模型管理 | `/studio/models` | HF 搜索下载 + 本地模型列表 | ✅ 迁移 |
| | 系统监控 | `/studio/system` | GPU/内存/磁盘 | ✅ 迁移 |
| | 设置 | `/studio/settings` | 后端管理 + 默认模型 + 记忆管理 + 重新初始化 | ✅ 扩展 |
| **特殊** | 诞生仪式 | `/setup` | 全屏沉浸式语音初始化（无导航栏） | 🔨 新增 |

### 11.2 助理主界面 (`/`)

用户打开 PineaStudio 后看到的第一个画面——不是模型列表，是助理在等你。

```
┌──────────────────────────────────────────────────────────┐
│  🏠 助理  │  🎭 展示台 ▾  │  🔧 工作台 ▾  │       Pine ● │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────────┐                                              │
│  │对话历史│                                               │
│  │        │          ✦ (光球 / 助理头像)                  │
│  │ 今天   │             Pine                             │
│  │ ├ 项目 │       "有什么我可以帮你的？"                   │
│  │ ├ 学习 │                                              │
│  │        │  ┌──────────────────────────────────────┐    │
│  │ 昨天   │  │                                      │    │
│  │ ├ 聊天 │  │  You: 帮我想想项目 A 的架构           │    │
│  │        │  │  Pine: 好的，我整理了几个思路……        │    │
│  │ 更早   │  │  ...                                 │    │
│  │ └ ...  │  │                                      │    │
│  │        │  └──────────────────────────────────────┘    │
│  └────────┘                                              │
│              ┌──────────────────────────────────────┐    │
│              │ 输入消息…                       🎤 ⏎ │    │
│              └──────────────────────────────────────┘    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**设计原则**：

| 设计点 | 说明 |
|--------|------|
| 不选模型 | 用哪个模型由 Settings 中"默认助理模型"决定 |
| 不显示参数 | 没有 temperature/max_tokens，那是 Playground 的事 |
| 文字 + 语音统一 | 输入框右侧 🎤 按钮，按住说话，松开发送。也可以打字 |
| 记忆自动注入 | 每次对话自动注入 SOUL+USER+MEMORY，用户无感知 |
| 人格说话 | AI 用 SOUL.md 的人格回复 |
| 对话历史 | 左侧面板，按日期分组，可折叠 |
| 光球/头像 | 顶部助理视觉标识，语音时脉动 |

**语音交互**（内嵌，不是独立页面）：

```
文字模式（默认）:
  打字 → 回车 → 流式文字回复

语音模式:
  按住 🎤 → 录音 → ASR 转写 → LLM → TTS 播放 + 文字同步
  技术: 复用 /ws/realtime 管线，system prompt 换为 prompt_builder 动态组装
```

### 11.3 助理界面 vs Chat Playground

| 维度 | 助理主界面 (`/`) | Playground (`/studio/chat`) |
|------|-----------------|-------------------------------|
| 目的 | 和助理交流 | 测试模型能力 |
| 模型 | 默认模型，不暴露 | 可选任意模型 |
| 记忆 | 自动注入 SOUL+USER+MEMORY | 不注入（原始测试） |
| 人格 | SOUL.md 人格说话 | 无人格（或可选 system prompt） |
| 参数 | 隐藏 | temperature / max_tokens 可调 |
| 对话历史 | 持久化 + 按日期分组 | 临时测试为主 |
| 目标用户 | 所有人 | 开发者/高级用户 |

### 11.4 路由逻辑

```
App.tsx → 启动时 GET /api/memory/status
  → initialized: false → /setup（全屏仪式，无导航栏）
  → initialized: true  → /（助理主界面）
```

**前端技术栈:** React + Vite + TypeScript + Tailwind CSS

---

## 12. Project Structure

```
pineastudio/
├── pyproject.toml
├── .gitignore
│
├── src/pineastudio/                     # Python package (src layout)
│   ├── __init__.py
│   ├── main.py                          # FastAPI app + startup + CLI entry
│   ├── config.py                        # Settings (pydantic-settings)
│   ├── db.py                            # SQLite (aiosqlite)
│   ├── schemas.py                       # Pydantic models
│   │
│   ├── routers/
│   │   ├── backends.py                  # /api/backends/*
│   │   ├── models.py                    # /api/models/*
│   │   ├── hub.py                       # /api/hub/*
│   │   ├── system.py                    # /api/system/*
│   │   ├── conversations.py             # /api/conversations/*
│   │   ├── proxy.py                     # /v1/* (OpenAI proxy + 记忆注入)
│   │   ├── realtime.py                  # /ws/realtime (ASR→LLM→TTS)
│   │   ├── omni.py                      # /ws/omni (MiniCPM-o)
│   │   ├── memory.py                    # /api/memory/* (新增)
│   │   └── setup.py                     # /api/setup/* (新增)
│   │
│   ├── services/
│   │   ├── backend_manager.py           # 后端注册/路由/生命周期
│   │   ├── memory_manager.py            # 记忆文件读写 + prompt_builder (新增)
│   │   ├── memory_tool.py               # memory tool: add/replace/remove (新增)
│   │   ├── asr.py                       # faster-whisper ASR
│   │   ├── tts_service.py               # Edge TTS
│   │   ├── omni_session.py              # MiniCPM-o 会话管理
│   │   ├── downloader.py                # HF 模型下载
│   │   ├── hardware.py                  # GPU/内存检测
│   │   └── backends/
│   │       ├── base.py                  # Backend 抽象
│   │       ├── ollama.py
│   │       ├── llama_server.py
│   │       ├── llama_omni.py
│   │       └── openai_compat.py
│   │
│   └── prompts/                         # System prompts (新增)
│       └── setup_guide.md               # 诞生仪式引导 prompt
│
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                      # 路由 + 初始化检测
│       ├── index.css
│       ├── api/
│       │   └── client.ts               # API client (fetch wrappers)
│       ├── pages/
│       │   ├── Assistant.tsx            # 助理主界面 — / (新增)
│       │   ├── Setup.tsx                # 诞生仪式 — /setup (新增)
│       │   ├── showcase/
│       │   │   ├── Omni.tsx             # /showcase/omni (迁移)
│       │   │   └── Realtime.tsx         # /showcase/realtime (迁移)
│       │   └── studio/
│       │       ├── Playground.tsx       # /studio/chat (重命名自 Chat.tsx)
│       │       ├── Models.tsx           # /studio/models (迁移)
│       │       ├── System.tsx           # /studio/system (迁移)
│       │       └── Settings.tsx         # /studio/settings (扩展)
│       └── components/
│           ├── Layout.tsx               # 三层导航栏
│           ├── OrbVisualizer.tsx         # 光球声波可视化 (新增)
│           └── ConversationList.tsx      # 对话历史面板 (新增)
│
├── docs/
│   ├── think.md                         # 战略思考
│   ├── design.md                        # 本文件
│   └── startup-guide.md                 # 部署启动指南
│
└── tests/
    ├── test_memory_manager.py           # (新增)
    └── test_memory_tool.py              # (新增)
```

---

## 13. SSE Streaming Proxy

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
                timeout=None,
            ) as resp:
                async for chunk in resp.aiter_bytes():
                    yield chunk

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
```

---

## 14. Dependencies

### Python (pyproject.toml)

```
fastapi
uvicorn[standard]
httpx               # async HTTP (backend proxy)
huggingface-hub     # model search & download
aiosqlite           # async SQLite
pydantic-settings   # config management
psutil              # system monitoring
websockets          # WebSocket support
numpy

[optional: realtime]
faster-whisper>=1.0  # ASR
edge-tts             # TTS
```

### Frontend (package.json)

```
react, react-dom, react-router-dom
tailwindcss
lucide-react             # icons
typescript, vite
```

---

## 15. Key Flows

### 15.1 First Run (诞生仪式)

```
用户首次运行 pineastudio
  │
  ├─ ~/.pineastudio/ 创建 (config.toml, 空 DB)
  ├─ BackendManager.auto_discover() → 检测 Ollama / llama-server
  ├─ FastAPI 启动在 :8000
  │
  ├─ 浏览器打开 → App.tsx
  ├─ GET /api/memory/status → { initialized: false }
  ├─ 重定向到 /setup
  │
  ├─ 全屏仪式界面 → 光球呼吸动画
  ├─ 用户点击 [开始] → 请求麦克风 → WS /ws/realtime (mode=setup)
  ├─ 5-8 轮语音对话 (ASR → Ollama → TTS)
  │   ├─ AI: "你希望我叫什么名字？"
  │   ├─ AI: "你平时做什么工作？"
  │   ├─ AI: "我用三种风格说同一句话，你听哪个舒服……"
  │   └─ AI (新人格): "很高兴认识你，[用户名]。"
  │
  ├─ 前端: POST /api/setup/finalize
  ├─ 后端: LLM 提取 → 生成 SOUL.md + USER.md + 空 MEMORY.md
  └─ 跳转主页 → AI 带着人格开始工作
```

### 15.2 Assistant — Text Mode (助理主界面)

```
用户打开 PineaStudio → 助理主界面 /
  │
  ├─ 看到 Pine 的光球/头像 + "有什么我可以帮你的？"
  ├─ 在输入框打字发送消息
  │
  ├─ Frontend: POST /v1/chat/completions
  │     body: { model: <default_model>, messages: [...], stream: true }
  │     (模型从 Settings 中的默认助理模型获取，用户不选择)
  │
  ├─ proxy.py:
  │     1. memory_manager.build_system_prompt() → 读 SOUL+USER+MEMORY+today
  │     2. messages.insert(0, { role: "system", content: memory_prompt })
  │     3. 代理到默认后端
  │
  ├─ SSE chunks → 前端渲染 (Pine 用 SOUL.md 人格说话)
  │
  └─ 对话结束后 (异步):
        summarize_conversation() → 存入 memory_episodes
```

### 15.3 Assistant — Voice Mode (助理主界面语音)

```
用户在助理主界面按住 🎤
  │
  ├─ WS /ws/realtime (mode=chat，同一个页面内)
  ├─ 光球切换为语音脉动模式
  ├─ 录音 → 音频帧发送到 WS
  │
  ├─ run_turn():
  │     1. ASR (faster-whisper) → 转写文本 → 显示在对话区
  │     2. system_prompt = memory_manager.build_system_prompt()
  │     3. Ollama streaming (with system_prompt + history)
  │     4. extract_sentences() → TTS → 音频帧回传
  │
  ├─ 前端播放语音 + 文字同步显示
  └─ 光球随 AI 语音扩散脉动
```

### 15.4 Playground — Model Testing (工作台)

```
开发者打开 /studio/chat
  │
  ├─ 选择任意模型 (ollama-local/qwen3:8b 等)
  ├─ 调节参数 (temperature, max_tokens, system prompt)
  ├─ 发送消息 → 流式回复 (不注入记忆，原始模型输出)
  └─ 用于测试模型能力，不影响助理状态
```

### 15.5 Model Download

```
用户搜索 "Qwen3 8B GGUF" → 点击下载
  │
  ├─ POST /api/hub/download
  ├─ 检查 HF cache / 磁盘空间
  ├─ huggingface_hub.hf_hub_download() → 进度推送 via /ws/downloads
  ├─ 创建 symlink: ~/.pineastudio/models/xxx.gguf → HF cache
  └─ 模型出现在聚合列表
```

---

## 16. Development Phases

### Phase 1 — Core MVP ✅ 已完成

多后端管理 + Chat Playground。

| # | Task | Status |
|---|------|--------|
| 1 | 项目脚手架 (FastAPI + React + Vite) | ✅ |
| 2 | 配置系统 (config.toml) | ✅ |
| 3 | Backend 抽象 + BackendManager | ✅ |
| 4 | Ollama / llama-server / OpenAI-compat 后端 | ✅ |
| 5 | OpenAI 兼容代理 /v1/* + SSE streaming | ✅ |
| 6 | 模型聚合 API + HF 搜索下载 | ✅ |
| 7 | Chat UI (流式输出、Thinking 折叠、模型切换) | ✅ |
| 8 | 对话历史持久化 (SQLite) | ✅ |
| 9 | 系统监控 (GPU/RAM/Disk) | ✅ |
| 10 | HTTPS / 局域网访问 | ✅ |

### Phase 2 — MiniCPM-o Omni + Realtime ✅ 已完成

全双工语音 + ASR→LLM→TTS 管线。

| # | Task | Status |
|---|------|--------|
| 1 | OmniServerBackend (llama.cpp-omni 管理) | ✅ |
| 2 | Omni 语音对话 UI (全双工 + 摄像头) | ✅ |
| 3 | Realtime 语音管线 (faster-whisper → Ollama → Edge TTS) | ✅ |
| 4 | Realtime 语音对话 UI | ✅ |

### Phase 3 — 记忆 + 诞生仪式 + UI 重构 ← 当前阶段

让助理"诞生"并"认识"你。把 UI 从"工具面板"变成"助理界面"。

**记忆系统（后端骨架）**：

| # | Task | 说明 | 状态 |
|---|------|------|------|
| M1 | memory/ 目录 + 三文件结构 | MemoryManager 基础操作 | 🔨 |
| M2 | prompt_builder | 读三文件 → 冻结快照 → system prompt | 🔨 |
| M3 | memory tool | add / replace / remove + 字符上限 | 🔨 |
| M4 | 助理对话接入记忆 | /v1/chat/completions 注入记忆 prompt | 🔨 |
| M5 | Realtime 接入记忆 | run_turn() 动态 system prompt | 🔨 |
| M6 | Omni 接入记忆 | omni_init() 注入记忆 prompt | 🔨 |
| M7 | 对话结束异步摘要 | → memory_episodes 表 | 🔨 |
| M8 | finalize_setup() | 对话 → LLM 提取 → SOUL.md + USER.md | 🔨 |

**诞生仪式**：

| # | Task | 说明 | 状态 |
|---|------|------|------|
| S1 | /setup 页面骨架 | 全屏沉浸布局 + 光球 | 🔨 |
| S2 | OrbVisualizer 声波可视化 | WebAudio API | 🔨 |
| S3 | Realtime 管线对接 setup 模式 | /ws/realtime + mode=setup | 🔨 |
| S4 | 引导 prompt + 试衣间 | LLM 自适应引导 | 🔨 |
| S5 | 字幕显示 | 半透明实时字幕 | 🔨 |
| S6 | 文字降级 | 无麦克风时退化为文字输入 | 🔨 |
| S7 | 首次检测 + 路由 | SOUL.md 不存在 → /setup | 🔨 |
| S8 | 动画打磨 | 转场、色调、音效 | 🔨 |

**UI 重构**：

| # | Task | 说明 | 状态 |
|---|------|------|------|
| U1 | Assistant.tsx 助理主界面 | 文字+语音统一入口，带记忆，默认落地页 | 🔨 |
| U2 | 三层导航 Layout | 助理 / 展示台(下拉) / 工作台(下拉) | 🔨 |
| U3 | 页面迁移 | Omni→showcase/, Realtime→showcase/, Chat→studio/Playground | 🔨 |
| U4 | ConversationList 组件 | 助理界面左侧对话历史面板 | 🔨 |
| U5 | 助理语音内嵌 | 输入框 🎤 按钮，按住说话，复用 Realtime 管线 | 🔨 |
| U6 | Settings 扩展 | 默认助理模型选择 + 记忆管理 + 重新初始化 | 🔨 |

### Phase 4+ — 以后再说

| 方向 | 说明 | 前提 |
|------|------|------|
| 生图 | stable-diffusion.cpp | 记忆系统稳定后 |
| 主动性 | 晨间播报 / 日程提醒 / 空闲关怀 | 记忆 + APScheduler |
| 知识编译 | knowledge/ 目录 + 每日编译 | 记忆积累到一定量 |
| 语音唤醒 | "Hey Pine" 本地检测 | 仪式完成后 |
| 工具调用 | 天气 / 日历 / 搜索 | 记忆系统稳定后 |

---

## 17. Decisions Log

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | 不自己做推理 | llama-server / Ollama 已足够好，聚合是更高的价值 |
| 2 | FastAPI + React | Python ML 生态好; React build 后零依赖 |
| 3 | 多后端同时运行 | 用户可能 Ollama + llama-server 共存 |
| 4 | `backend_id/model_name` 路由 | 简单明确, 避免模型名冲突 |
| 5 | SQLite (not JSON) | 需要 query 能力 |
| 6 | symlink 而非拷贝模型文件 | 避免重复存储 |
| 7 | 各后端模型存储各自管理 | Ollama 的模型不碰 |
| 8 | 只支持 Ubuntu/Linux | 减少跨平台开发成本 |
| 9 | Markdown 文件做记忆 | 人可读、可 git、LLM 直接读取 (借鉴 Hermes Agent) |
| 10 | 冻结快照注入 system prompt | 保护 prefix cache (借鉴 Hermes Agent) |
| 11 | memory tool 用子串匹配 | LLM 擅长子串匹配，不擅长数行号 (借鉴 Hermes Agent) |
| 12 | SOUL.md 替代 persona.yaml | 与 MEMORY.md/USER.md 格式统一，LLM 读 Markdown 更自然 |
| 13 | 不用 Agent 框架 | Hermes/PenguinAI/Vision-Agent 三个项目都自建循环 |
| 14 | 诞生仪式复用 Realtime 管线 | 不新建 WebSocket，只加 mode=setup |
| 15 | 记忆预算硬上限 | MEMORY.md ~2200 chars, USER.md ~1375 chars, 适配 8K 窗口 |
| 16 | 三层 UI 导航 | 助理(主) / 展示台(showcase) / 工作台(studio)，用户 95% 时间在助理界面 |
| 17 | 助理界面不暴露模型选择 | 用哪个模型由 Settings 中"默认助理模型"决定，降低认知负荷 |
| 18 | Omni/Realtime 定位为 Showcase | 技术能力演示，不是主要对话入口 |
| 19 | Chat 重命名为 Playground | 明确其用途是模型测试，不是日常对话 |

---

## 18. Non-Goals (明确不做)

- 自研推理引擎
- 模型训练/微调
- 用户认证/多用户系统
- 跨平台 (Windows/macOS)
- Docker 作为唯一部署方式
- Agent 框架 (LangChain/AutoGen/CrewAI)
- 重量级向量数据库 (ChromaDB/Weaviate)
- 云端依赖 (所有功能必须纯本地可用)

---

*Created: 2026-04-10*
*Updated: 2026-04-13 — 记忆系统 + 诞生仪式 + UI 三层导航重构*
