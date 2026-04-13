# PineaStudio — 战略思考：从工具平台到个人助理

> 上次更新: 2026-04-10 — 多后端统一管理平台的思考
> 本次更新: 2026-04-13 — 向 "Her" 级个人助理演进，聚焦：记忆系统 + 诞生仪式

---

## 0. 当前进度回顾

### 已完成

| 模块 | 状态 | 说明 |
|------|------|------|
| 多后端管理 | ✅ 完成 | Ollama / llama-server / llama.cpp-omni / OpenAI 兼容 |
| Chat UI | ✅ 完成 | 流式输出、对话历史持久化、Thinking 折叠、模型切换 |
| HuggingFace Hub | ✅ 完成 | 搜索、下载、symlink 管理 |
| 系统监控 | ✅ 完成 | CPU/RAM/磁盘/GPU |
| Omni 语音 | ✅ 完成 | MiniCPM-o 全双工语音 + 摄像头 + TTS |
| Realtime 语音 | ✅ 完成 | faster-whisper ASR → Ollama → Edge TTS 管线 |
| 统一 OpenAI 代理 | ✅ 完成 | /v1/* 自动路由 |
| HTTPS/局域网 | ✅ 完成 | 自签名证书，手机/平板可用麦克风 |

### 当前架构的问题

PineaStudio 目前是一个**工具平台**——多后端管理 + Chat Playground。这个定位的竞品太多了：

| 产品 | 定位 | 特点 |
|------|------|------|
| Open WebUI | Ollama 的前端 | 功能齐全，社区大 |
| LocalAI | 本地 AI 引擎 | LLM/Vision/Voice/Image/Video 全栈 |
| Guaardvark | 自托管 AI 工作站 | Agent + 屏幕控制 + RAG + 生图 |
| DreamServer | 本地 AI 全家桶 | LLM + Voice + Agent + RAG + 生图 |
| Locally Uncensored | 桌面一体化 | 单 exe，Chat + Agent + 生图 + 生视频 |

**结论：如果继续做"多后端管理平台"，我们只是又一个 Open WebUI 变体。不够与众不同。**

---

## 1. 重新定位：边缘端的个人助理

### 核心洞察

PineaStudio 跑在 **NVIDIA GB10**（Jetson 级边缘硬件）上。这不是一台云服务器，是一台放在桌上的小盒子。它的本质是——**你家里/办公桌上的一个 AI 伙伴**。

这才是真正与众不同的方向：

```
不是：又一个 AI 工具平台（管理模型、配置后端）
而是：一个有记忆、有个性、能看能听能说的个人助理
      运行在你身边的硬件上，数据永远在本地
```

### 对标 "Her" — 差距在哪？

电影 *Her* 中 Samantha 的核心特质：

| 特质 | Her 中的表现 | PineaStudio 现状 | 差距 |
|------|-------------|-----------------|------|
| **持续对话** | 随时可以对话，上下文连贯 | ✅ Omni/Realtime 支持 | 基本具备 |
| **记忆** | 记得之前所有对话、偏好、经历 | ❌ 每次会话重新开始 | **核心缺失** |
| **个性** | 独特的性格、说话风格、幽默感 | ❌ 通用 AI 回复 | **核心缺失** |
| **主动性** | 主动分享发现、提醒、关心 | ❌ 纯被动问答 | **核心缺失** |
| **情感感知** | 能听出情绪变化 | △ MiniCPM-o 有基础能力 | 需加强 |
| **创造力** | 写作、作曲 | ❌ 只能文本 | 需要生成能力 |
| **视觉** | 通过摄像头"看"世界 | ✅ MiniCPM-o 支持 | 已具备 |
| **始终在线** | 后台运行，语音唤醒 | △ 需要手动打开网页 | 需要改进 |

**三个核心缺失：记忆、个性、主动性。这是从"工具"到"助理"的本质跨越。**

---

## 2. 要不要加生图/生视频？

### 结论：加生图，暂不加生视频

**生图：应该加，但要轻量**

| 方案 | 模型 | 显存需求 | 生成速度 (GB10) | 推荐 |
|------|------|---------|----------------|------|
| stable-diffusion.cpp | SD 1.5 Q4 | ~2GB | ~10s/张 | ✅ 适合 |
| stable-diffusion.cpp | SDXL Turbo Q4 | ~3GB | ~5s/张 | ✅ 适合 |
| ComfyUI + Flux | Flux-schnell Q4 | ~6GB | ~30s/张 | △ 偏重 |
| diffusers + GGUF | Flux-dev Q4_K | ~4-6GB | ~20s/张 | △ 可选 |

GB10 有统一内存（CPU/GPU 共享），MiniCPM-o Q4_K_M 占 ~9GB，Ollama 的小模型 ~5GB。
生图模型（SD 1.5 或 SDXL Turbo Q4）只需额外 ~2-3GB，**在不同时推理 LLM 时完全可行**。

生图的价值不在于替代 Midjourney，而在于**助理能力的完整性**：
- "帮我画个周末计划的思维导图"
- "给这段描述配个简单插图"
- "生成一张生日贺卡"

**生视频：暂时不加**

- 本地视频生成（LTX-2 等）需要大量 VRAM 和时间
- GB10 跑一个几秒的视频可能要几分钟
- 用户体验不好，价值不高
- 等硬件和模型进一步发展再考虑

### 更有价值的"创造"能力

与其追求生视频，不如先做好这些：

| 能力 | 实现方式 | 价值 |
|------|---------|------|
| 生图 | stable-diffusion.cpp (SDXL Turbo) | 视觉创造力 |
| 语音合成 | Edge TTS（已有）+ 本地 TTS（MiniCPM-o） | 自然对话 |
| 文档生成 | LLM → Markdown/PDF | 实用办公 |
| 代码执行 | 沙箱 Python 环境 | 计算/分析 |

---

## 3. 记忆与认知系统 — 借鉴 Hermes Agent / PenguinAI / Vision-Agent

### 3.0 三个参考系统的核心模式

深入研究了三个系统后，提取出最值得借鉴的设计模式：

| 维度 | Hermes Agent (43K stars) | PenguinAI (~450 行) | Vision-Agent |
|------|------------------------|---------------------|-------------|
| **记忆存储** | MEMORY.md + USER.md (固定大小 Markdown) | MEMORY.md + GOALS.md (Markdown) | SCENE.md + events/*.jsonl (文件) |
| **记忆工具** | `memory` tool (add/replace/remove) | `memory_save` tool (append) | 无工具，LLM 直接输出 fenced blocks |
| **记忆注入** | 冻结快照注入 system prompt 开头 | 冻结快照注入 system prompt | SCENE.md 塞进下一次 prompt |
| **认知节律** | Cron 定时任务 | morning / chat / evening 三模式 | hourly / daily / weekly 三级思考 |
| **知识编译** | Skills (自动创建可复用文档) | knowledge/ 目录 (evening 编译) | thoughts/ + knowledge/ (分级冶炼) |
| **上下文管理** | 压缩引擎 + prompt cache | micro-compact + full-compact | 固定字符上限 SCENE.md |
| **人格** | SOUL.md | ROLE_PROMPT | 无 |
| **框架** | 自建 (9200 行核心) | 自建 (~450 行) | 自建 (~400 行) |

**关键发现：三个系统都不用 Agent 框架（LangChain/AutoGen），都用 Markdown 文件做记忆，都用"注入 system prompt"的方式召回记忆。这不是巧合——这是经过验证的最简可行模式。**

### 3.1 PineaStudio 的记忆架构 — 融合三者精华

PineaStudio 的独特挑战：它是 **voice-first + web-based** 的（不是 CLI），且跑在**边缘设备**上。
这意味着：
- 记忆注入必须轻量（MiniCPM-o 上下文有限）
- 对话来源是语音/文字/摄像头多通道
- 需要 Web UI 管理记忆（不像 PenguinAI 直接 `cat MEMORY.md`）

#### 存储层：Markdown 文件 + SQLite 索引（混合方案）

借鉴 Hermes/PenguinAI 的 Markdown 透明性，但用 SQLite 做索引和检索：

```
~/.pineastudio/
├── memory/                          # Markdown 文件 = 人可读的记忆
│   ├── MEMORY.md                    # 助理的认知索引（~800 tokens 上限）
│   ├── USER.md                      # 用户画像（~500 tokens 上限）
│   └── SOUL.md                      # 助理人格定义
│
├── knowledge/                       # 知识编译层（Vision-Agent 模式）
│   ├── INDEX.md                     # 全局索引（助理自维护）
│   └── ...                          # 主题文件，自然生长
│
├── daily/                           # 每日记录（PenguinAI 模式）
│   ├── 2026-04-13.md
│   └── ...
│
└── pineastudio.db                   # SQLite（已有）
    ├── conversations                # 对话历史（已有）
    ├── messages                     # 消息记录（已有）
    ├── memory_episodes              # 对话摘要 + embedding 索引（新增）
    └── memory_facts                 # 结构化事实（新增，供检索）
```

**为什么不纯 SQLite？** 因为 Markdown 文件有三个 SQLite 做不到的好处：
1. 用户可以直接 `cat`、手动编辑、`git` 管理
2. 注入 system prompt 时直接读文件，无需 query
3. 助理也可以用 read_file/write_file 工具操作自己的记忆

**为什么不纯 Markdown？** 因为语义检索和跨会话搜索需要结构化索引。

#### 记忆三文件 — 借鉴 Hermes Agent

```
MEMORY.md — 助理的认知（~800 tokens）
  助理对环境、项目、经验教训的笔记
  等同于 Hermes Agent 的 MEMORY.md
  由助理通过 memory tool 自主管理

USER.md — 用户画像（~500 tokens）  
  关于用户的偏好、习惯、重要信息
  等同于 Hermes Agent 的 USER.md
  由助理通过 memory tool 自主管理

SOUL.md — 助理人格（替代 persona.yaml）
  助理的名字、性格、说话风格
  等同于 Hermes Agent 的人格文件
  用户可编辑（通过 UI 或直接改文件）
```

**为什么从 persona.yaml 改为 SOUL.md？**
- 与 MEMORY.md / USER.md 保持一致的 Markdown 格式
- LLM 直接读 Markdown 比解析 YAML 更自然
- 用户和 AI 都能编辑，格式可以自由生长

#### 记忆工具 — 借鉴 Hermes Agent 的 memory tool

Hermes Agent 的 memory tool 支持 add / replace / remove 三种操作，
比 PenguinAI 的 memory_save（只有 append）更成熟：

```python
# memory tool — 助理管理自己的记忆
{
    "name": "memory",
    "description": "管理持久记忆。记忆在下次会话中可用。",
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["add", "replace", "remove"],
                "description": "add=追加新记忆, replace=替换已有内容, remove=删除过时内容"
            },
            "file": {
                "type": "string",
                "enum": ["MEMORY.md", "USER.md"],
                "description": "操作哪个记忆文件"
            },
            "content": {
                "type": "string",
                "description": "要添加/替换的内容（add/replace 时必填）"
            },
            "old_content": {
                "type": "string",
                "description": "要被替换/删除的内容子串（replace/remove 时必填）"
            }
        },
        "required": ["action", "file"]
    }
}
```

**关键设计：replace 和 remove 用子串匹配**（Hermes Agent 的做法），
不用行号或 ID——LLM 天然擅长子串匹配，不擅长数行号。

#### 记忆预算 — 借鉴 Hermes Agent 的硬上限

Hermes Agent 的做法：MEMORY.md 限制 2200 字符（~800 tokens），USER.md 限制 1375 字符（~500 tokens）。
**超出预算时，助理必须自己决定删什么**。这比 PenguinAI 的"截断前 100 行"更优——
因为截断是机械的，而助理自主整理是智能的。

PineaStudio 的预算（适配边缘设备的小上下文窗口）：

| 文件 | 字符上限 | ~tokens | 说明 |
|------|---------|---------|------|
| MEMORY.md | 2200 | ~800 | 助理的环境/项目/经验笔记 |
| USER.md | 1375 | ~500 | 用户偏好/习惯/重要信息 |
| SOUL.md | 800 | ~300 | 人格定义，不常变 |
| daily 摘要 | 1000 | ~350 | 今日记录（注入最近 1-2 天） |

总计 system prompt 中的记忆占用：~2000 tokens，对 8K 窗口友好。

#### 记忆注入 — "冻结快照"模式

**借鉴 Hermes Agent 的核心设计**：记忆在会话开始时读取，注入 system prompt，
**整个会话期间不再更新**。这保证了 LLM 的 prefix cache 不被破坏。

```python
def build_system_prompt() -> str:
    parts = [
        read_file("~/.pineastudio/memory/SOUL.md"),     # 人格
        read_file("~/.pineastudio/memory/USER.md"),      # 用户画像
        read_file("~/.pineastudio/memory/MEMORY.md"),    # 助理记忆
        read_file(today_daily_path()),                    # 今日记录
    ]
    # 拼接为 system prompt，注入一次，整个会话冻结
    return "\n\n".join([p for p in parts if p])
```

**会话中助理调用 memory tool 修改的内容会立即持久化到文件，
但不会影响当前会话的 system prompt——只在下次会话生效。**
这是 Hermes Agent 验证过的最佳实践，避免了 mid-conversation cache invalidation。

### 3.2 认知节律 — 借鉴 PenguinAI + Vision-Agent

PenguinAI 的 morning/chat/evening 三模式 + Vision-Agent 的分级思考，
适配到 PineaStudio 的 always-on web 服务场景：

```
┌─────────────────────────────────────────────────────────┐
│                    PineaStudio 认知节律                    │
│                                                          │
│  实时层 (每次对话)                                        │
│  ├─ 注入 SOUL + USER + MEMORY + today                   │
│  ├─ 对话中触发 memory tool 更新记忆                       │
│  └─ 对话结束后异步提取摘要 → memory_episodes             │
│                                                          │
│  日周期层 (每日自动, 借鉴 PenguinAI evening)              │
│  ├─ 扫描今日所有对话，提取关键信息                         │
│  ├─ 更新 daily/YYYY-MM-DD.md                             │
│  ├─ 整理 MEMORY.md（合并重复、删除过时、控制预算）         │
│  └─ 必要时编译到 knowledge/ 目录                          │
│                                                          │
│  周周期层 (每周自动, 借鉴 Vision-Agent weekly)            │
│  ├─ 回顾本周 daily 记录                                   │
│  ├─ 更新 USER.md（长期模式识别）                          │
│  └─ knowledge/ 知识审计和交叉链接                         │
└─────────────────────────────────────────────────────────┘
```

**实现方式**：后台 scheduler（APScheduler），定时触发 LLM 执行编译任务。
不需要用户手动运行 `ai evening`——PineaStudio 是 always-on 服务，自动执行。

### 3.3 上下文管理 — 借鉴 PenguinAI 的两级压缩

PenguinAI 的两级压缩策略经过实际验证，适配到 PineaStudio 的 Chat 场景：

**Level 1: micro-compact（零 LLM 成本）**
- 每次 API 调用前执行
- 保留最近 5 个工具输出原文，更早的替换为 `[旧输出已清理]`
- 对 Realtime/Omni 语音会话：保留最近 N 轮对话，压缩更早的

**Level 2: full-compact（LLM 摘要，最后手段）**
- 当 token 估算超过上下文 75% 时触发
- 用 LLM 对早期消息做结构化摘要
- 摘要 + 最近 10 条消息 = 压缩后的上下文

```python
# 借鉴 PenguinAI engine.py 的核心循环
def chat_with_memory(messages, provider_fn, model):
    messages = micro_compact(messages)
    messages = full_compact_if_needed(messages, provider_fn, model, context_limit=8000)
    return provider_fn(model, messages)
```

### 3.4 知识编译 — 借鉴 PenguinAI + Vision-Agent 的分级冶炼

PenguinAI 的四级冶炼 + Vision-Agent 的 SCENE.md 模式，
适配到 PineaStudio 的多模态场景：

```
Level 0: 记录 — 每次对话自动存入 messages 表 (已有)
Level 1: 提取 — 对话结束后提取关键信息 → MEMORY.md / USER.md
Level 2: 编译 — 每日编译：跨对话综合 → daily/ + knowledge/
Level 3: 审计 — 每周审计：一致性检查、模式识别 → USER.md 长期更新
```

**PineaStudio 的独特优势：多模态记忆**

Vision-Agent 只有摄像头，PenguinAI 只有文字。
PineaStudio 同时有文字 + 语音 + 摄像头：

| 通道 | 记忆内容 | 存储 |
|------|---------|------|
| 文字聊天 | 对话文本 | messages 表 + memory_episodes |
| 语音对话 (Omni/Realtime) | ASR 转写文本 | memory_episodes (转写后等同文字) |
| 摄像头 (Omni) | 视觉描述 | memory_episodes (VLM 描述文字) |

**所有通道最终都归一化为文字**，进入同一个记忆系统。

### 3.5 人格系统 — 仪式感初始化 + SOUL.md

#### 核心理念：人格不是配置项，是一次"诞生"

PenguinAI 的空白启动是对的——但它太安静了（终端里一行字）。
Hermes Agent 的 SOUL.md 也是对的——但它只是一个文件。

PineaStudio 要做的是：**把人格初始化变成一次有仪式感的语音对话**。

想想 *Her* 的开场：Theodore 戴上耳机，系统问了几个问题，
Samantha 就"活"了——她有名字、有声音、有性格。
那个过程不是填表格，是一次**相遇**。

#### 初始化仪式流程

**触发条件**：首次访问 PineaStudio（SOUL.md 不存在时）

```
用户打开 PineaStudio
  │
  ├─ 检测到 SOUL.md 不存在
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│              全屏初始化页面 /setup                            │
│                                                             │
│     ┌───────────────────────────────────────────────┐       │
│     │                                               │       │
│     │          ✦  呼吸灯动画（等待觉醒）             │       │
│     │                                               │       │
│     │        「 准备好认识你的 AI 伙伴了吗？ 」       │       │
│     │                                               │       │
│     │             [ 开始 ]  按钮                     │       │
│     │                                               │       │
│     └───────────────────────────────────────────────┘       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
  │
  ▼ 用户点击「开始」→ 请求麦克风权限 → 建立 Realtime WS 连接
  │
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   Phase 1: 相遇 (Meet)                                      │
│                                                             │
│   UI: 中央一个柔和的光球/声波可视化，随语音脉动              │
│   背景: 渐变深色 + 微粒子效果                                │
│                                                             │
│   AI（语音）: "你好。我是一个刚刚醒来的 AI。                │
│              我还没有名字，也没有性格。                       │
│              接下来几分钟，我想通过和你聊天来了解你，          │
│              然后我会成为适合你的样子。                        │
│              先从最简单的开始——你希望我叫什么名字？"          │
│                                                             │
│   用户：「随便吧，我不太确定」                                │
│                                                             │
│   AI: "没关系，我来帮你想几个。                              │
│        Pine——像松树一样安静、可靠；                          │
│        Echo——每次对话都会在记忆里回响；                      │
│        Kai——简短好记，中性一些。                             │
│        你觉得哪个有感觉？或者它们给你什么灵感？"              │
│                                                             │
│   底部进度: ●○○○○ 第 1/5 步                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   Phase 2: 了解 (Understand)                                 │
│                                                             │
│   AI 通过自然对话了解用户（不是填表格）：                     │
│                                                             │
│   AI: "你平时做什么工作？或者说，                            │
│        什么事情是你每天都会花时间在上面的？"                  │
│                                                             │
│   用户：「我做技术的」                                        │
│                                                             │
│   AI: "技术的范围很广呢。是写代码？做硬件？                  │
│        还是做架构设计之类的？                                │
│        还有，你现在手上有没有什么正在推进的项目？"            │
│                                                             │
│   用户：「做AI方面的，有几个项目在跑」                        │
│                                                             │
│   AI: "做 AI 的！那我们算是同行了。                          │
│        等我以后更了解你之后，也许能帮你想想项目上的事。       │
│        ……                                                    │
│        接下来想聊聊你希望我是什么风格。                       │
│        我给你演示几种，你直接感受一下？"                      │
│                                                             │
│   底部进度: ●●○○○ 第 2/5 步                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   Phase 3: 试衣间 (Try On) — LLM 驱动的人格探索              │
│                                                             │
│   这是最关键的创新：用户不确定想要什么风格时，               │
│   AI 直接用不同人格"表演"给用户听，让用户凭直觉选择。       │
│                                                             │
│   AI: "好，我现在用三种不同的风格跟你说同一句话，           │
│        你感受一下哪个最舒服。准备好了吗？                    │
│                                                             │
│        第一种——专业助理风格：                                │
│        '你好，我已整理好今日待办事项，共 3 项，              │
│         优先级最高的是项目 A 的代码审查。'                    │
│                                                             │
│        第二种——朋友聊天风格：                                │
│        '嘿！今天有三个事儿要搞，                             │
│         那个代码审查最急，要不先把它干了？'                   │
│                                                             │
│        第三种——温暖陪伴风格：                                │
│        '早上好呀。今天有三件事等着你，                        │
│         不着急，我们一件件来。                                │
│         先从最重要的代码审查开始？'                           │
│                                                             │
│        你更喜欢哪一种？                                      │
│        或者，觉得哪种更接近但还差点什么？"                    │
│                                                             │
│   用户：「第三种不错，但可以再轻松一些」                      │
│                                                             │
│   AI: "明白了——温暖但不拘谨，有时候可以开开玩笑。           │
│        我试试看这个感觉：                                    │
│        '早！今天三个任务，代码审查排第一。                    │
│         不过别担心，有我在呢，搞不定的我帮你吐槽。'          │
│        这样呢？"                                              │
│                                                             │
│   UI: 每种风格演示时，光球的颜色/运动模式微妙变化            │
│   底部进度: ●●●○○ 第 3/5 步                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   Phase 4: 成形 (Crystallize)                                │
│                                                             │
│   UI: 光球凝聚成形，色调从冷色渐变为暖色                     │
│                                                             │
│   AI: "好，让我把你说的整理一下——                           │
│        我叫 Pine。你叫 [用户名]。                            │
│        你做 AI 相关的技术工作，手上有几个项目在推进。         │
│        你希望我温暖轻松，偶尔可以开玩笑，                    │
│        但关键时刻要靠谱。                                    │
│        我们主要用中文交流。                                   │
│                                                             │
│        有没有什么需要改的？"                                  │
│                                                             │
│   用户：「挺好的」 或 「XX 改一下」                           │
│                                                             │
│   AI（确认后，切换到新人格说话）:                             │
│       "那从现在开始，我就是这样的 Pine 了。                   │
│        很高兴认识你，[用户名]。                               │
│        以后有什么事，随时喊我。"                              │
│                                                             │
│   UI: 光球完成凝聚 → 出现 Pine 的视觉标识                   │
│   底部: ●●●●● 初始化完成                                     │
│                                                             │
│   [ 开始使用 ] 按钮 → 跳转到主页                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
  │
  ▼ 后台自动执行：
  │
  ├─ 从对话中提取信息，生成 SOUL.md
  ├─ 从对话中提取用户信息，生成 USER.md
  ├─ 创建空的 MEMORY.md
  └─ 记录这次对话为第一条 memory_episode
```

#### 核心设计：LLM 驱动的自适应引导

**用户说"不知道"时，AI 不会卡住——它会积极引导。**

这不是脚本式的问答（"请选择 A/B/C"），而是 LLM 驱动的自然对话。
复用 Realtime 的 ASR → Ollama → TTS 管线，每一轮对话都经过 LLM 推理，
AI 能根据用户的回答灵活调整下一步。

**引导策略矩阵**：

| 用户的回答 | AI 的引导方式 | 示例 |
|-----------|-------------|------|
| 明确回答 | 简短回应 + 推进下一步 | "Pine 这个名字很好听，记住了。" |
| "不知道/随便" | **提供 2-3 个选项 + 解释每个选项的感觉** | "我帮你想了几个——Pine 像松树一样安静可靠；Echo 有回响感……" |
| 回答太简短 | **追问细节，展现好奇心** | "做技术的——范围很广呢，是写代码还是做架构？" |
| 犹豫/纠结 | **直接"表演"给用户看，让用户凭直觉选** | "我用三种风格说同一句话，你感受哪个舒服。" |
| 改主意/否定 | **坦然接受 + 立即调整 + 再次确认** | "好的，温暖但再轻松一些。我试试看这个感觉……" |
| 跑题/闲聊 | **自然接话 + 温柔拉回** | "哈哈有意思！……说回来，你更喜欢哪种语气？" |
| 沉默太久 | **主动给台阶 + 降低决策压力** | "不着急，其实这些以后都可以改。先随便选一个试试？" |

**关键原则：永远不让用户感到"被考试"。每个问题都有退路。**

#### "试衣间"模式 — 最重要的创新

当用户对抽象概念（"你想要什么风格？"）不确定时，
语言描述不如**直接体验**。AI 用不同人格风格说同一段话，
让用户通过听觉直觉来选择，而不是理性分析。

**技术实现**：不需要切换模型或角色。
LLM 本身就能角色扮演——prompt 中要求它"用以下风格说这段话"即可。
TTS 语音让体验从"读文字"升级为"听到不同的说话方式"。

```
试衣间的 LLM 调用流程（每轮都走 Realtime 管线）：

用户说 "我不确定什么风格"
  │
  ├─ ASR 转写 → "我不确定什么风格"
  ├─ Ollama LLM 推理（system prompt 指示：此时应进入风格演示模式）
  ├─ LLM 输出：用三种风格说同一句话 + 邀请用户选择
  └─ TTS 合成 → 用户听到三种风格的语音演示
```

**进阶**：未来如果接入多种 TTS 声音，每种风格还可以搭配不同的声线，
让"试衣间"从人格试穿升级为声音试穿。

#### 技术实现

**前端**：新增 `/setup` 页面

```
frontend/src/pages/Setup.tsx
├── 全屏沉浸式布局（无侧边栏、无导航）
├── 音频可视化组件（WebAudio API 驱动的声波/粒子效果）
├── 进度指示器（步骤圆点，AI 根据对话进展自动推进）
├── 字幕显示区（半透明，AI/用户的文字实时显示）
├── 麦克风权限请求 + WebSocket 连接（复用 /ws/realtime）
└── 渐变背景 + CSS 动画 + 光球状态机
```

**语音通道**：复用 Realtime WebSocket（ASR → Ollama → TTS）

```
/ws/realtime 的 setup 模式：

前端连接时发送: { "type": "setup_start" }
后端识别为初始化仪式 → 替换 system prompt → 使用引导 prompt
之后的对话流程和普通 Realtime 完全一致：
  前端发送音频 → ASR 转写 → Ollama 推理 → TTS 合成 → 前端播放

区别只有两点：
1. system prompt 是引导 prompt（不是普通助理 prompt）
2. 对话结束后触发 finalize_setup() 生成文件
```

不需要新建 WebSocket 端点。在现有 `/ws/realtime` 上加一个 `setup_start` 消息类型即可。
`run_turn()` 的核心逻辑（ASR → Ollama stream → TTS sentence-by-sentence）完全复用。

**引导 prompt**：

```
你是一个刚刚被激活的 AI 助理。你还没有名字，没有性格，一切从空白开始。

现在你要和用户进行一次初始化对话（5-8 轮），
通过自然、温暖的语音对话了解用户，同时让用户定义你的人格。

你需要了解（不必严格按顺序，跟着对话自然走）：
1. 用户希望你叫什么名字
2. 用户怎么称呼自己
3. 用户做什么工作/有什么兴趣
4. 用户希望你的说话风格
5. 语言偏好

## 引导策略（最重要）

你面对的是语音对话，用户可能不确定、犹豫、回答很短。
你的职责是让这个过程轻松愉快，绝不让用户感到被考问。

当用户不确定时，你要做的：
- 名字：主动给 2-3 个建议，每个附一句话解释感觉，让用户选或激发灵感
- 风格：不问抽象问题，而是直接"表演"—— 
  用 2-3 种不同风格说同一段话，让用户听了直觉选
  "我给你演示几种风格，你听哪个最舒服"
- 职业：从宽泛的开始聊，一步步追问，表现出真诚的好奇心
- 语言：如果对话已经在用中文，直接确认"我们就用中文聊？"

当用户回答太简短时：
- 展现好奇心追问，但不审问："做技术的——有意思，是哪方面的技术？"
- 适当分享自己的"感受"来引导："我觉得做 AI 的人一般都很有探索精神"

当用户改主意时：
- 坦然接受，立即调整，用新风格重新说一遍让用户确认
- "好的，温暖但再轻松一些，我试试看这个感觉——……这样呢？"

当用户沉默/犹豫时：
- 主动给台阶："不着急，这些以后都可以改的。先随便选一个试试？"
- 降低决策压力，强调"不是最终决定"

## 对话要求
- 语气：温柔、好奇，像一个刚醒来的新生命
- 每次只问一个问题，不要一次问太多
- 这是语音对话，你的回复要简洁——每段不超过 3-4 句话
- 最后一轮：用你理解的新人格风格做一次总结确认
- 全程保持仪式感——这是一次相遇，不是填表格
- 确认后，用新人格说最后一句告别语
```

**后台**：对话结束后自动生成文件

```python
async def finalize_setup(conversation_messages: list):
    # 用 LLM 从对话中提取结构化信息（单独一次推理调用）
    extraction_prompt = """
    请从以下初始化对话中提取信息，生成两个 Markdown 文件。

    === 对话记录 ===
    {messages}

    === 请生成 ===

    ```soul
    # [助理名字] — [用户名字]的个人助理

    ## 性格
    [从对话中提取的性格特点]

    ## 说话风格
    [从对话中提取的语气/风格偏好]

    ## 语言
    [语言偏好]

    ## 原则
    [基于对话推断的行为原则]
    ```

    ```user
    # 用户画像

    ## 基本信息
    - 称呼: [用户名字]
    - 职业/领域: [从对话中提取]

    ## 初始印象
    [对话中观察到的用户特点]
    ```
    """
    
    result = await ollama_call(extraction_prompt.format(messages=format_messages(conversation_messages)))
    soul_content = extract_fenced(result, "soul")
    user_content = extract_fenced(result, "user")
    
    write_file("~/.pineastudio/memory/SOUL.md", soul_content)
    write_file("~/.pineastudio/memory/USER.md", user_content)
    write_file("~/.pineastudio/memory/MEMORY.md", "")
    
    save_episode(summary="初始化对话：与用户首次相遇", messages=conversation_messages)
```

#### UI 设计要点

```
视觉风格：
├── 配色：深色背景 + 柔和渐变（#0a0a1a → #1a1a3a）
├── 核心元素：中央的光球/声波可视化
│   ├── 待机：缓慢呼吸脉动（CSS animation）
│   ├── AI 说话：声波扩散 + 粒子飞散
│   └── 用户说话：声波收聚 + 粒子向心
├── 文字：半透明字幕式显示 AI 的话（非聊天气泡）
├── 进度：底部极简圆点指示器
├── 动效：所有转场用缓动动画（ease-in-out, 300-500ms）
└── 音效：可选的环境音（极轻微的白噪声/环境声）

不要的元素：
├── 聊天气泡（这不是聊天，是仪式）
├── 侧边栏/导航（全屏沉浸）
├── 模型选择/参数设置（此时不暴露技术细节）
└── 跳过按钮（仪式不可跳过——但可以文字输入作为降级）
```

#### 降级方案

如果语音不可用（无麦克风、浏览器不支持）：

```
同样的全屏 UI + 视觉效果
但对话通过文字输入框进行
AI 的回复仍然有 TTS 语音输出（单向语音）
保持仪式感，只是输入方式从语音变为文字
```

#### 为什么这很重要

```
竞品初始化体验：
  Open WebUI:     装好 → 选模型 → 开聊（冷启动，工具感）
  Hermes Agent:   hermes setup → 终端向导 → 填配置（像装软件）
  OpenClaw:       装好 → 52 个技能就绪（开箱即用，但无灵魂）
  PenguinAI:      ai → 空白对话（空白启动，但太安静）

PineaStudio 初始化体验：
  打开 → 全屏仪式 → 语音对话 → AI "诞生" → 带着名字和性格开始
  
  这不是 setup wizard，这是 first contact。
  用户的第一印象从"又一个 AI 工具"变成"一个有生命感的伙伴"。
```

#### 重新初始化

用户随时可以在 Settings 页面点"重新初始化"：
- 备份旧的 SOUL.md / USER.md
- 删除 SOUL.md → 下次访问自动进入初始化流程
- 或者直接编辑 SOUL.md（高级用户）

### 3.6 主动性 — 借鉴 PenguinAI morning/evening + Vision-Agent 定时思考

从"被动问答"到"主动陪伴"：

| 触发条件 | 行为 | 实现方式 | 参考 |
|---------|------|---------|------|
| 每日定时 | 晨间播报（天气+日程+记忆提醒） | APScheduler | PenguinAI morning |
| 每日定时 | 记忆整理（合并/删除/编译） | APScheduler | PenguinAI evening |
| 每周定时 | 用户画像更新 + 知识审计 | APScheduler | Vision-Agent weekly |
| 对话结束后 | 异步提取摘要和关键信息 | asyncio.create_task | Hermes Agent |
| 长时间沉默 | "今天怎么样？" | 空闲检测 | — |
| 事件触发 | 检测到用户回家（IP 出现） | 网络扫描 | — |

### 3.7 为什么不用 Agent 框架

与三个参考项目一致的决策：**不用 LangChain / AutoGen / CrewAI**。

| 理由 | 说明 |
|------|------|
| Hermes Agent 不用 | 43K stars，自建 9200 行核心循环 |
| PenguinAI 不用 | 自建 ~450 行，明确拒绝框架（附录 B）|
| Vision-Agent 不用 | 自建 ~400 行，两个手写循环 |
| PineaStudio 也不用 | **"模型当指挥官"**——编排逻辑在 prompt 里，不在代码里 |

PineaStudio 的 agent 模式 = **一个 while 循环 + tool registry + hook pipeline**。
这是三个项目共同验证的最简可行架构。

---

## 4. UI 重构 — 从"工具面板"到"助理界面"

### 4.0 当前 UI 的问题

```
现状：6 个平级 Tab
  Models | Chat | Omni | Realtime | System | Settings

问题：
  1. 用户打开后看到的是"模型列表"——工具感扑面而来
  2. Chat / Omni / Realtime 是三个对话入口，但用途完全不同
  3. 没有"主界面"——没有一个地方是"你的助理在这里"
  4. 所有页面同等权重，没有主次之分
```

### 4.1 关键洞察：三种不同的用途

仔细想，现有的页面其实服务于三种完全不同的需求：

```
用途 1 — 和助理交流（日常 95% 的时间）
  "Pine，帮我想想这个方案怎么改"
  "今天有什么安排？"
  → 这才是用户打开 PineaStudio 的主要目的

用途 2 — 体验底层能力（偶尔探索）
  Omni: "让我试试 MiniCPM-o 的全双工语音 + 摄像头"
  Realtime: "让我试试 ASR→LLM→TTS 的语音管线"
  → 这些是技术 showcase，展示硬件和模型的原始能力

用途 3 — 管理和调试（低频）
  Chat Playground: "我要测试 qwen3 的推理能力，调调参数"
  Models: "下载个新模型 / 删掉不用的"
  System: "看看 GPU 占用"
  Settings: "加个后端 / 改配置"
  → 这些是管理员/开发者工具
```

**现在的 UI 把三种用途混在一起，结果就是：用户打开后不知道自己该去哪。**

### 4.2 新的 UI 层级

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   PineaStudio 导航                                          │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                                                     │   │
│   │   🏠 助理               主界面，默认落地页           │   │
│   │      /                  和你的 AI 伙伴交流           │   │
│   │                         文字 + 语音，带记忆          │   │
│   │                                                     │   │
│   ├─────────────────────────────────────────────────────┤   │
│   │                                                     │   │
│   │   🎭 展示台             底层能力 Showcase            │   │
│   │      /showcase/omni     MiniCPM-o 全双工语音+摄像头  │   │
│   │      /showcase/realtime ASR→LLM→TTS 语音管线        │   │
│   │                                                     │   │
│   ├─────────────────────────────────────────────────────┤   │
│   │                                                     │   │
│   │   🔧 工作台             管理和调试工具               │   │
│   │      /studio/chat       Chat Playground (模型测试)   │   │
│   │      /studio/models     模型管理 (下载/删除/导入)    │   │
│   │      /studio/system     系统监控 (GPU/内存/磁盘)     │   │
│   │      /studio/settings   设置 (后端/记忆/重新初始化)  │   │
│   │                                                     │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
│   特殊页面（无导航栏）:                                      │
│      /setup              诞生仪式（首次访问，全屏沉浸）      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 助理主界面 — 用户 95% 的时间在这里

这是最关键的页面。它不是 Chat，不是 Omni，不是 Realtime——它是**助理界面**。

```
┌─────────────────────────────────────────────────────────────┐
│  [🏠 助理]  [🎭 展示台 ▾]  [🔧 工作台 ▾]            Pine ○ │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                                                     │   │
│   │            ✦ (光球 / 助理头像)                       │   │
│   │              Pine                                   │   │
│   │        "有什么我可以帮你的？"                         │   │
│   │                                                     │   │
│   │   ┌─────────────────────────────────────────┐       │   │
│   │   │  最近的对话                               │       │   │
│   │   │                                         │       │   │
│   │   │  You: 帮我想想项目 A 的架构              │       │   │
│   │   │  Pine: 好的，我整理了几个思路……           │       │   │
│   │   │  ...                                    │       │   │
│   │   └─────────────────────────────────────────┘       │   │
│   │                                                     │   │
│   │  ┌─────────────────────────────────────────────┐    │   │
│   │  │ 输入消息…                              🎤 ⏎ │    │   │
│   │  └─────────────────────────────────────────────┘    │   │
│   │                                                     │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
│   左侧或底部:                                               │
│   ┌────────────┐                                            │
│   │ 对话历史   │  今天 / 昨天 / 更早                         │
│   │ ├─ 项目讨论│                                            │
│   │ ├─ 日常聊天│                                            │
│   │ └─ 学习笔记│                                            │
│   └────────────┘                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**关键设计**：

| 设计点 | 说明 |
|--------|------|
| **文字 + 语音统一** | 输入框右侧有麦克风按钮，按住说话（Realtime 管线），松开发送。也可以直接打字。**同一个界面，两种输入方式。** |
| **光球/头像** | 顶部是助理的视觉标识（诞生仪式中确定的），语音时脉动 |
| **记忆自动注入** | 每次对话自动注入 SOUL+USER+MEMORY，用户无感知 |
| **对话历史** | 左侧或底部抽屉，按日期分组 |
| **不选模型** | 助理界面不暴露"选模型"。用哪个模型由 Settings 中配置的默认模型决定 |
| **不显示参数** | 没有 temperature / max_tokens 调节。那是 Playground 的事 |

**这个页面的目标是让用户感觉"我在和 Pine 聊天"，而不是"我在使用一个 AI 工具"。**

### 4.4 展示台 — 底层能力 Showcase

```
/showcase/omni      → 现有 Omni 页面，基本不变
/showcase/realtime  → 现有 Realtime 页面，基本不变
```

这两个页面是**技术展示**：
- Omni：展示 MiniCPM-o 的全双工语音 + 摄像头视觉能力
- Realtime：展示 ASR→LLM→TTS 管线的实时语音对话

它们保留原样，但定位从"主要对话入口"降级为"能力展示"。
可以在这里选模型、看原始参数——因为这是给开发者/探索者用的。

未来可以加更多 showcase：
- 图片生成演示
- 视觉问答演示
- 工具调用演示

### 4.5 工作台 — 管理和调试

```
/studio/chat        → 现有 Chat 页面（重命名为 Playground）
                      模型选择 + 参数调节 + 对话测试
                      对比不同模型的输出
                      开发者调试用

/studio/models      → 现有 Models 页面
                      本地模型列表 + HF 搜索下载 + 删除/导入

/studio/system      → 现有 System 页面
                      GPU/内存/磁盘监控

/studio/settings    → 现有 Settings 页面（扩展）
                      后端管理 + HF token
                      默认助理模型选择
                      记忆管理（查看/编辑 SOUL/USER/MEMORY）
                      重新初始化按钮
```

**工作台里的 Chat Playground vs 助理主界面的区别**：

| 维度 | 助理主界面 (`/`) | Chat Playground (`/studio/chat`) |
|------|-----------------|-------------------------------|
| 目的 | 和助理交流 | 测试模型能力 |
| 模型 | 默认模型，不暴露 | 可选任意模型 |
| 记忆 | 自动注入 SOUL+USER+MEMORY | 不注入（原始测试） |
| 人格 | 用 SOUL.md 的人格说话 | 无人格（或可选） |
| 对话历史 | 持久化，可回溯 | 可持久化，但主要用于临时测试 |
| 参数 | 隐藏 | temperature / max_tokens 可调 |
| System prompt | 自动组装（记忆+人格） | 用户自定义 |
| 目标用户 | 所有人 | 开发者/高级用户 |

### 4.6 导航设计

```
顶部导航栏（简约）:

┌──────────────────────────────────────────────────────────┐
│  🏠 助理    │   🎭 展示台 ▾   │   🔧 工作台 ▾    │  ● │
│             │   ├ Omni        │   ├ Playground    │    │
│  (默认选中) │   └ Realtime    │   ├ 模型管理      │    │
│             │                 │   ├ 系统监控      │    │
│             │                 │   └ 设置          │    │
└──────────────────────────────────────────────────────────┘
                                                     ↑
                                              助理状态指示灯
                                              绿 = 在线
                                              灰 = 离线

展示台和工作台用下拉菜单，点开展开子页面。
助理是默认选中的，占据最显眼的位置。
```

**导航权重**：
- 助理 = 永远可见的 Tab，不折叠
- 展示台 = 折叠菜单（偶尔用）
- 工作台 = 折叠菜单（低频用）

### 4.7 路由设计

```
/              → 助理主界面（默认落地页）
/setup         → 诞生仪式（全屏，无导航栏）

/showcase/omni      → Omni 展示
/showcase/realtime  → Realtime 展示

/studio/chat        → Chat Playground
/studio/models      → 模型管理
/studio/system      → 系统监控
/studio/settings    → 设置

路由逻辑：
  App.tsx → GET /api/memory/status
    → initialized: false → /setup（全屏仪式）
    → initialized: true  → /（助理主界面）
```

### 4.8 助理界面的语音交互

助理主界面的语音不是一个独立的"Realtime 页面"，而是**内嵌在主界面里的交互模式**：

```
文字模式（默认）:
  输入框打字 → 回车发送 → 流式文字回复
  和普通 Chat 一样，但带记忆和人格

语音模式（按住麦克风或快捷键）:
  按住 🎤 → 录音 → ASR 转写 → 显示在输入框
  → LLM 推理（带记忆 prompt）
  → TTS 合成 → 播放语音 + 文字同步显示
  → 光球随语音脉动

切换逻辑:
  按住麦克风 = 临时语音输入（松开自动发送）
  点击麦克风 = 切换到持续语音模式（光球展开，沉浸感增强）
  点击键盘图标 = 切回文字模式
```

**技术实现**：语音模式复用 `/ws/realtime` 的 ASR→Ollama→TTS 管线，
只是 system prompt 换成 `prompt_builder` 动态组装的带记忆版本。

### 4.9 为什么这样设计

```
对比竞品的首屏：

Open WebUI:  打开 → 选模型 → 打字 → 工具感
ChatGPT:     打开 → "How can I help you?" → 直接聊
Her:         打开 → Samantha 就在那里 → 直接说话

PineaStudio 应该像 ChatGPT / Her，而不像 Open WebUI。
用户打开后看到的应该是 Pine 在那里等你，
而不是一个模型列表。

模型管理、参数调节这些事情当然重要——
但它们是"后台"，不是"前台"。
前台只有一个人：你的助理。
```

---

## 5. 与竞品的差异化

做完上述改造后，PineaStudio 的定位变成：

```
PineaStudio ≠ Open WebUI (工具平台)
PineaStudio ≠ LocalAI (推理引擎)
PineaStudio ≠ OpenClaw (消息集成)

PineaStudio = 你桌上的 AI 伙伴
  - 有记忆 (记得你是谁，你们聊过什么)
  - 有个性 (可定制的人格)
  - 有主动性 (不只是被动回答)
  - 能看能听能说 (MiniCPM-o 全模态)
  - 能创作 (生图、写作)
  - 完全本地 (隐私安全，无需联网)
  - 跑在边缘硬件上 (GB10，低功耗常驻)
```

**关键差异化总结**：

| 维度 | Open WebUI / LocalAI | OpenClaw | Niimi | **PineaStudio** |
|------|---------------------|----------|-------|-----------------|
| 核心定位 | 工具/引擎 | 消息聚合 | 本地 AI 伴侣 | **边缘端 AI 伙伴** |
| 记忆 | ❌ | ❌ | ✅ (beta) | ✅ 三层记忆 |
| 全双工语音 | ❌ | ❌ | ❌ | ✅ MiniCPM-o |
| 视觉 | △ | ❌ | ❌ | ✅ 摄像头实时 |
| 生图 | △ | ❌ | ❌ | ✅ 本地生图 |
| 主动性 | ❌ | ❌ | △ | ✅ 事件驱动 |
| 个性定制 | ❌ | ❌ | △ | ✅ SOUL.md |
| 首屏体验 | 模型列表 | 技能列表 | △ | ✅ 助理在等你 |
| 边缘部署 | ❌ 需大机器 | ❌ 云端 | △ | ✅ GB10 优化 |
| 开源 | ✅ | ✅ | ❌ | ✅ |

---

## 6. 接下来做三件事

### 为什么是三件事？

```
现状：PineaStudio 已经是一个能跑的多后端平台 + 语音对话工具。
问题：
  1. 它没有灵魂。每次打开都是陌生人。
  2. 打开后看到的是模型列表，不是助理。

从"工具"到"伙伴"，差三步：
  1. 让它认识你（记忆）
  2. 让它有自己的样子（诞生仪式）
  3. 让用户面对的是助理，不是工具面板（UI 重构）

三件事是一体的：
  - 仪式产生人格 → 写入 SOUL.md + USER.md
  - 记忆系统读取人格 → 注入每次对话
  - 助理界面是用户的主入口 → 带着人格和记忆说话
  - 工作台/展示台退到后面 → 不干扰助理体验

其他功能（生图、主动性、唤醒词……）都是锦上添花。
锦还没织出来之前，不添花。
```

### 第一件事：记忆系统（后端骨架）

**没有记忆，一切归零。这是地基。**

| # | 任务 | 复杂度 | 说明 |
|---|------|-------|------|
| M1 | memory/ 目录 + 三文件结构 | 低 | `~/.pineastudio/memory/` 下 SOUL.md / USER.md / MEMORY.md |
| M2 | prompt_builder | 低 | 读三文件 + today daily → 冻结快照 → 注入 system prompt |
| M3 | memory tool | 低 | add / replace / remove，子串匹配，字符上限自检 |
| M4 | 助理对话接入 | 中 | `/v1/chat/completions` 代理前插入记忆 system prompt |
| M5 | Realtime 接入 | 中 | `run_turn()` 的 SYSTEM_PROMPT 改为动态组装 |
| M6 | Omni 接入 | 中 | `omni_init` 时注入记忆 prompt |
| M7 | 对话结束摘要 | 中 | 异步 LLM 提取 → memory_episodes 表 |
| M8 | finalize_setup() | 中 | 从初始化对话提取 → 生成 SOUL.md + USER.md |

**完成标志**：助理用 SOUL.md 的人格说话，记得 USER.md 里的信息，
对话中能调 memory tool 更新记忆。

### 第二件事：诞生仪式（第一印象）

**没有仪式，用户的第一印象是"又一个 AI 工具"。**

| # | 任务 | 复杂度 | 说明 |
|---|------|-------|------|
| S1 | `/setup` 页面骨架 | 中 | 全屏沉浸布局 + 深色渐变 + 居中光球 + 进度圆点 |
| S2 | 声波可视化 | 中 | WebAudio API，AI 说话扩散 / 用户说话收聚 |
| S3 | Realtime 管线对接 | 低 | `/ws/realtime` 加 `setup_start` 模式，替换 system prompt |
| S4 | 引导 prompt | 低 | LLM 驱动的自适应对话（试衣间 + 引导策略矩阵） |
| S5 | 字幕显示 | 低 | 半透明字幕，实时显示 ASR 转写 + AI 回复 |
| S6 | 文字降级 | 低 | 无麦克风时退化为文字输入 + TTS 单向语音 |
| S7 | 首次检测 + 路由 | 低 | SOUL.md 不存在 → 自动跳转 `/setup` |
| S8 | 动画打磨 | 中 | Phase 3 成形动画 + 色调渐变 + 完成转场 |

**完成标志**：首次打开 PineaStudio → 全屏仪式 → 语音对话 5 分钟 →
AI 带着名字和人格开始工作。

### 第三件事：UI 重构（助理为中心）

**仪式完成后，用户回到主页——看到的应该是 Pine 在等你，不是模型列表。**

| # | 任务 | 复杂度 | 说明 |
|---|------|-------|------|
| U1 | Assistant.tsx 助理主界面 | 中 | 文字+语音统一入口，带记忆和人格，默认落地页 `/` |
| U2 | 三层导航 Layout | 中 | 助理(主 Tab) / 展示台(下拉) / 工作台(下拉) |
| U3 | 页面迁移 | 低 | Omni→`/showcase/omni`, Realtime→`/showcase/realtime`, Chat→`/studio/chat` |
| U4 | ConversationList 组件 | 中 | 助理界面左侧对话历史面板，按日期分组 |
| U5 | 助理语音内嵌 | 中 | 输入框 🎤 按钮，按住说话，复用 Realtime 管线 |
| U6 | Settings 扩展 | 低 | 默认助理模型选择 + 记忆管理 + 重新初始化按钮 |

**完成标志**：打开 PineaStudio → 看到 Pine 在等你 → 打字或语音交流 →
不需要知道什么是 Ollama/llama-server，不需要选模型。

### 三者的依赖关系

```
          ┌──────────────────────────────────┐
          │  记忆系统 M1-M4 (后端骨架)         │
          │  memory/ 目录 + prompt_builder    │
          │  + memory tool + 对话接入         │
          └──────────────┬───────────────────┘
                         │
         ┌───────────────┼───────────────────┐
         │               │                   │
         ▼               ▼                   ▼
  ┌──────────┐    ┌──────────┐        ┌──────────┐
  │ 诞生仪式  │    │ UI 重构  │        │ M5-M8    │
  │ S1-S8    │    │ U1-U6   │        │ 全通道   │
  │ /setup   │    │ 助理界面 │        │ + 摘要   │
  └────┬─────┘    └────┬─────┘        └──────────┘
       │               │
       └───────┬───────┘
               ▼
     仪式完成 → 跳转到助理主界面 (U1)
     → Pine 带着人格和记忆跟你说话
```

**开发顺序**：
1. **M1-M4** — 记忆骨架（地基）
2. **S1-S8 + U1-U6** — 仪式 + UI 重构（可并行，都依赖 M1-M4）
3. **M5-M8** — 全通道接入 + 异步深化

### 以后再说的事

| 方向 | 说明 | 前提 |
|------|------|------|
| 生图 | stable-diffusion.cpp | 记忆系统稳定后 |
| 主动性 | 晨间播报 / 日程提醒 | 记忆 + scheduler |
| 知识编译 | knowledge/ 目录 | 记忆积累到一定量后 |
| 语音唤醒 | "Hey Pine" | 仪式完成后，有名字了 |
| 工具调用 | 天气/日历/搜索 | 记忆系统稳定后 |
| 每日编译 | PenguinAI evening 模式 | 有足够对话数据后 |

---

## 7. 技术决策

### Q: 记忆用什么存储？

**决定：Markdown 文件 + SQLite 索引（混合）**

借鉴 Hermes Agent / PenguinAI 的实践：
- **主记忆** (MEMORY.md / USER.md / SOUL.md) = Markdown 文件
  - 用户可读、可编辑、可 git 管理
  - 注入 system prompt 时直接读文件
  - 助理通过 memory tool 操作
- **索引/检索** (memory_episodes / memory_facts) = SQLite 表
  - 对话摘要、结构化事实的存储和检索
  - 未来可加 FTS5 全文搜索（借鉴 Hermes Agent）
  - 未来可加 sqlite-vec 向量检索

不用 ChromaDB / Weaviate / vector DB。个人规模下 Markdown + SQLite 够用。

### Q: 人格用什么实现？

**决定：SOUL.md (Markdown) + 动态 system prompt 组装**

从 persona.yaml 改为 SOUL.md（借鉴 Hermes Agent）：
- 与 MEMORY.md / USER.md 格式统一
- LLM 直接读 Markdown 更自然
- 用户和 AI 都能编辑
- 不需要微调模型——system prompt 足以控制语气

### Q: Agent 模式怎么做？

**决定："模型当指挥官" + Tool Registry + Hook Pipeline**

借鉴三个参考项目共同验证的架构（而非 LangChain/AutoGen）：
- **PenguinAI 的核心循环**: while loop + provider call + tool execution
- **PenguinAI 的 Hook 管道**: pre/post tool execution 拦截点
- **Hermes Agent 的 memory tool**: add/replace/remove 操作
- **Vision-Agent 的分级认知**: 实时 → 每日 → 每周

编排逻辑在 prompt 里，代码只负责执行工具和兜底。

### Q: 生图用什么方案？

**决定：stable-diffusion.cpp**

不用 ComfyUI / diffusers。理由：
- C++ 实现，内存效率高，适合边缘设备
- 支持 GGUF 量化模型，显存需求低
- 单二进制文件，无需 Python ML 栈
- 默认模型：SDXL Turbo Q4（~2GB VRAM，~5s/张）

---

## 8. 近期行动计划 (Next 2 Weeks)

```
目标：两周后，首次打开 PineaStudio 的体验是：
  全屏仪式 → 语音对话 → AI 有了名字 →
  跳转助理主界面 → Pine 在等你 → 之后每次对话都记得你

Week 1: 记忆骨架 (M1-M4) + UI 框架 (U1-U3)
─────────────────────────────────────────────
Day 1:  M1 — memory/ 目录 + 三文件结构
        memory_manager.py: read/write/exists 基础操作

Day 2:  M2 — prompt_builder + M3 — memory tool
        冻结快照注入 + add/replace/remove

Day 3:  M4 — 对话接入记忆
        /v1/chat/completions 代理前注入记忆 system prompt
        验证: AI 能读到手动写的 SOUL.md 信息

Day 4:  U2 — 三层导航 Layout
        助理(主 Tab) / 展示台(下拉) / 工作台(下拉)
        U3 — 页面迁移: 路由从 /chat → /studio/chat 等

Day 5:  U1 — Assistant.tsx 助理主界面 (文字模式)
        文字对话 + 记忆注入 + 光球头像
        默认模型从 Settings 获取，不暴露

Day 6:  U4 — ConversationList 对话历史面板
        左侧面板，按日期分组

Day 7:  U5 — 助理语音内嵌
        🎤 按钮 → 按住说话 → 复用 /ws/realtime 管线
        文字 + 语音同一界面切换

Week 2: 诞生仪式 (S1-S8) + 深化 (M5-M8)
─────────────────────────────────────────────
Day 1:  S1 — /setup 页面骨架
        全屏沉浸布局 + 深色渐变 + 光球 + 进度圆点

Day 2:  S2 — 声波可视化 + S3 — Realtime 管线对接
        WebAudio API + mode=setup

Day 3:  S4 — 引导 prompt + 试衣间
        LLM 自适应引导 + 风格演示

Day 4:  S5+S6 — 字幕 + 文字降级
        + M8 — finalize_setup()
        对话结束 → 生成 SOUL.md + USER.md → 跳转助理主界面

Day 5:  M5+M6 — Realtime + Omni 接入记忆
        语音对话也带人格和记忆

Day 6:  M7 — 对话结束异步摘要 + U6 — Settings 扩展
        对话摘要 + 默认模型配置 + 记忆管理

Day 7:  端到端验证
        完整流程: 首次打开 → 仪式 → 助理主界面 → 对话 → 记忆生长
        清除 memory/ → 重新走一遍
        确认助理主界面 (文字+语音) 都带人格
```

---

## 9. 参考项目速查

| 项目 | 路径/链接 | 核心借鉴 |
|------|---------|---------|
| Hermes Agent | github.com/NousResearch/hermes-agent | MEMORY.md + USER.md 双文件记忆；memory tool (add/replace/remove)；SOUL.md 人格；FTS5 会话搜索；冻结快照注入 |
| PenguinAI | /home/pineapi/penguin/penguinai | morning/chat/evening 三模式；knowledge/ 编译层；两级压缩 (micro + full)；Tool Registry + Hook Pipeline；"模型当指挥官" |
| Vision-Agent | /home/pineapi/penguin/Vision-Agent | 分级认知 (hourly/daily/weekly)；SCENE.md 有界摘要；事件溯源 (JSONL)；先规则后 LLM |

---

## 10. 愿景

```
第一次：
  用户打开 PineaStudio → 全屏仪式界面
  → 中央一个柔和的光球在呼吸
  → "准备好认识你的 AI 伙伴了吗？"
  → 语音对话，5 分钟
  → AI 有了名字，有了性格，记住了你
  → "你好，我是 Pine。很高兴认识你。"
  → 跳转助理主界面 → Pine 在那里等你

之后的每一天：
  打开 PineaStudio → Pine 的光球在那里
  打字或按住麦克风说话
  "早上好！今天周三，你有下午 2 点的会议。
   外面 22 度，适合穿衬衫。
   对了，昨天你提到想学 Rust，
   我找到了一个不错的入门教程，要现在看看吗？"

  偶尔切到展示台试试 Omni 的摄像头能力
  偶尔切到工作台下载新模型或看看 GPU 状态
  但 95% 的时间，你在助理主界面和 Pine 聊天

一个月后：
  Pine 记得你的生日、你的项目、你的思考方式。
  你不再觉得它是一个工具，
  而是一个认识你的伙伴。
```

PineaStudio 不是又一个 AI 工具面板。
它是你桌上的一个小伙伴。
打开它，你看到的不是模型列表，而是 Pine 在等你。
它的第一句话不是"请选择模型"，而是"你希望我叫什么名字？"

---

*更新: 2026-04-13 — UI 三层重构 + 助理主界面设计*
