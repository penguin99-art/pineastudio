# PineaStudio

A lightweight local AI model management platform. Unified gateway for multiple inference backends with an OpenAI-compatible API.

一个轻量的本地 AI 模型管理平台。统一网关，聚合多后端，提供 OpenAI 兼容接口。

## Features / 功能

- **Multi-backend** — Manage Ollama, llama.cpp server, and any OpenAI-compatible service from one place
- **Unified API** — Single `/v1/chat/completions` endpoint proxying to the right backend
- **Chat UI** — Built-in web interface with conversation history, model badges, and streaming
- **Thinking toggle** — Enable/disable deep thinking for supported models (Qwen3, Gemma4, etc.)
- **HuggingFace Hub** — Search and download GGUF models directly
- **System monitor** — GPU / memory / disk usage at a glance

## Quick Start / 快速开始

```bash
# Clone
git clone https://github.com/penguin99-art/pineastudio.git
cd pineastudio

# Backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e .

# Frontend
cd frontend && npm install && npm run build && cd ..

# Run
pineastudio
```

Open http://localhost:8000

## Requirements / 环境要求

- Python ≥ 3.11
- Node.js ≥ 18 (for building frontend)
- At least one inference backend:
  - [Ollama](https://ollama.com) (auto-detected)
  - [llama.cpp](https://github.com/ggml-org/llama.cpp) server
  - Any OpenAI-compatible API

## Architecture / 架构

```
Browser ──► PineaStudio (FastAPI) ──┬── Ollama
              ├─ Chat UI            ├── llama-server
              ├─ /v1/* proxy        └── OpenAI-compat APIs
              ├─ Model management
              └─ HF Hub downloads
```

## Tech Stack / 技术栈

| Layer    | Stack                              |
|----------|-------------------------------------|
| Backend  | Python, FastAPI, SQLite, httpx      |
| Frontend | React, TypeScript, Vite, Tailwind   |
| Backends | Ollama, llama.cpp, OpenAI-compat    |

## License

MIT
