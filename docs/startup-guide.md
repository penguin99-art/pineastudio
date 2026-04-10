# PineaStudio 启动指南

本文档描述如何在机器开机后，完整启动 PineaStudio 及其依赖的所有后端服务。

**机器信息：**
- 主机名：`spark-d473`
- GPU：NVIDIA GB10
- Python：3.12
- 局域网 IP：`192.168.11.155`（Wi-Fi，可能变化）

---

## 目录

1. [服务总览](#1-服务总览)
2. [第一步：Ollama（自动启动）](#2-第一步ollama自动启动)
3. [第二步：llama-server-omni（MiniCPM-o）](#3-第二步llama-server-omniminicpm-o)
4. [第三步：PineaStudio](#4-第三步pineastudio)
5. [一键启动脚本](#5-一键启动脚本)
6. [验证服务状态](#6-验证服务状态)
7. [停止所有服务](#7-停止所有服务)
8. [常见问题](#8-常见问题)

---

## 1. 服务总览

| 服务 | 端口 | 用途 | 启动方式 |
|------|------|------|----------|
| Ollama | 11434 | LLM 推理（Gemma4、Qwen3 等） | systemd 自动启动 |
| llama-server-omni | 9060 | MiniCPM-o 4.5 全双工语音 | 手动启动 |
| PineaStudio | 8000 | 统一前端 + API 网关 | 手动启动 |

**服务依赖关系：**
```
Ollama (11434) ─────────────────┐
                                ├──► PineaStudio (8000)
llama-server-omni (9060) ───────┘
```

---

## 2. 第一步：Ollama（自动启动）

Ollama 已配置为 systemd 服务，**开机自动启动**，无需手动操作。

**验证状态：**
```bash
systemctl status ollama
```

如果未运行，手动启动：
```bash
sudo systemctl start ollama
```

**配置文件：** `/etc/systemd/system/ollama.service`
- 监听地址：`0.0.0.0:11434`（局域网可访问）
- 模型目录：`/home/pineapi/liuminglu/models/models`
- Flash Attention：已启用

**已安装的模型：**
```bash
ollama list
```

常用模型：`gemma4:e2b`（5B，Realtime 默认）、`gemma4:e4b`（8B）、`gemma4:26b`（26B）

**健康检查：**
```bash
curl http://localhost:11434/api/tags | python3 -m json.tool | head -5
```

---

## 3. 第二步：llama-server-omni（MiniCPM-o）

MiniCPM-o 4.5 的全双工语音能力依赖 `llama.cpp-omni` 编译的专用 `llama-server`。

**路径信息：**
| 项目 | 路径 |
|------|------|
| llama-server 二进制 | `/home/pineapi/gy/llama.cpp-omni/build/bin/llama-server` |
| 动态库目录 | `/home/pineapi/gy/llama.cpp-omni/build/bin/` |
| 模型文件（GGUF） | `/home/pineapi/gy/cases/edge-agent/models/MiniCPM-o-4_5-gguf/MiniCPM-o-4_5-Q4_K_M.gguf` |
| TTS 模型目录 | `.../MiniCPM-o-4_5-gguf/tts/` |
| Token2wav 模型目录 | `.../MiniCPM-o-4_5-gguf/token2wav-gguf/` |

**启动命令：**
```bash
MODEL_DIR="/home/pineapi/gy/cases/edge-agent/models/MiniCPM-o-4_5-gguf"
LIB_DIR="/home/pineapi/gy/llama.cpp-omni/build/bin"

LD_LIBRARY_PATH="$LIB_DIR:$LD_LIBRARY_PATH" $LIB_DIR/llama-server \
  --host 127.0.0.1 --port 9060 \
  --model "$MODEL_DIR/MiniCPM-o-4_5-Q4_K_M.gguf" \
  -ngl 99 -c 8192 \
  --repeat-penalty 1.05 --temp 0.7
```

> **注意：** 首次加载模型约需 30-60 秒（加载到 GPU）。

**健康检查：**
```bash
curl http://localhost:9060/health
# 期望返回：{"status":"ok"}
```

**后台运行（推荐）：**
```bash
MODEL_DIR="/home/pineapi/gy/cases/edge-agent/models/MiniCPM-o-4_5-gguf"
LIB_DIR="/home/pineapi/gy/llama.cpp-omni/build/bin"

nohup bash -c 'LD_LIBRARY_PATH="'"$LIB_DIR"':$LD_LIBRARY_PATH" '"$LIB_DIR"'/llama-server \
  --host 127.0.0.1 --port 9060 \
  --model "'"$MODEL_DIR"'/MiniCPM-o-4_5-Q4_K_M.gguf" \
  -ngl 99 -c 8192 \
  --repeat-penalty 1.05 --temp 0.7' \
  > /tmp/llama-server-omni.log 2>&1 &

echo "llama-server PID: $!"
```

---

## 4. 第三步：PineaStudio

**项目路径：** `/home/pineapi/penguin/pineastudio`

### 首次安装

```bash
cd /home/pineapi/penguin/pineastudio

# 创建虚拟环境
python3 -m venv .venv
source .venv/bin/activate

# 安装后端（含 Realtime 语音依赖）
pip install -e ".[realtime]"

# 构建前端
cd frontend && npm install && npm run build && cd ..
```

### 日常启动

```bash
cd /home/pineapi/penguin/pineastudio
source .venv/bin/activate
pineastudio --no-browser --port 8000 --ssl
```

参数说明：
| 参数 | 说明 |
|------|------|
| `--port 8000` | 监听端口 |
| `--ssl` | 启用 HTTPS（自签名证书），**麦克风/摄像头在非 localhost 访问时必须** |
| `--no-browser` | 不自动打开浏览器（服务器环境） |
| `--host 0.0.0.0` | 允许局域网访问（默认 127.0.0.1） |

**后台运行：**
```bash
cd /home/pineapi/penguin/pineastudio
source .venv/bin/activate
nohup pineastudio --no-browser --port 8000 --ssl > /tmp/pineastudio.log 2>&1 &
echo "PineaStudio PID: $!"
```

**访问地址：**
- 本机：`https://localhost:8000`
- 局域网：`https://192.168.11.155:8000`（首次需接受自签名证书）

### 页面功能

| 页面 | 路径 | 说明 |
|------|------|------|
| Chat | `/chat` | 文本对话，支持所有 Ollama 模型 |
| Omni | `/omni` | MiniCPM-o 全双工语音（需要 llama-server-omni） |
| Realtime | `/realtime` | ASR/LLM/TTS 语音对话（需要 Ollama + edge-tts） |
| Models | `/models` | 模型管理 |
| System | `/system` | 系统监控 |

---

## 5. 一键启动脚本

将以下内容保存为 `~/start-pineastudio.sh`：

```bash
#!/bin/bash
set -e

echo "=========================================="
echo "  PineaStudio 启动脚本"
echo "=========================================="

# ── 1. 检查 Ollama ──
echo ""
echo "[1/3] 检查 Ollama..."
if curl -sf http://localhost:11434/health > /dev/null 2>&1; then
    echo "  ✓ Ollama 已运行 (port 11434)"
else
    echo "  ✗ Ollama 未运行，尝试启动..."
    sudo systemctl start ollama
    sleep 2
    if curl -sf http://localhost:11434/health > /dev/null 2>&1; then
        echo "  ✓ Ollama 已启动"
    else
        echo "  ✗ Ollama 启动失败，请检查 systemctl status ollama"
        exit 1
    fi
fi

# ── 2. 启动 llama-server-omni ──
echo ""
echo "[2/3] 启动 llama-server-omni (MiniCPM-o)..."
if curl -sf http://localhost:9060/health > /dev/null 2>&1; then
    echo "  ✓ llama-server-omni 已运行 (port 9060)"
else
    MODEL_DIR="/home/pineapi/gy/cases/edge-agent/models/MiniCPM-o-4_5-gguf"
    LIB_DIR="/home/pineapi/gy/llama.cpp-omni/build/bin"

    LD_LIBRARY_PATH="$LIB_DIR:$LD_LIBRARY_PATH" \
    nohup "$LIB_DIR/llama-server" \
        --host 127.0.0.1 --port 9060 \
        --model "$MODEL_DIR/MiniCPM-o-4_5-Q4_K_M.gguf" \
        -ngl 99 -c 8192 \
        --repeat-penalty 1.05 --temp 0.7 \
        > /tmp/llama-server-omni.log 2>&1 &

    echo "  → llama-server PID: $!"
    echo "  → 等待模型加载..."

    for i in $(seq 1 60); do
        if curl -sf http://localhost:9060/health > /dev/null 2>&1; then
            echo "  ✓ llama-server-omni 已就绪 (${i}s)"
            break
        fi
        sleep 1
        if [ $i -eq 60 ]; then
            echo "  ⚠ 模型加载超时，请查看 /tmp/llama-server-omni.log"
        fi
    done
fi

# ── 3. 启动 PineaStudio ──
echo ""
echo "[3/3] 启动 PineaStudio..."
if curl -sfk https://localhost:8000/api/omni/status > /dev/null 2>&1; then
    echo "  ✓ PineaStudio 已运行 (port 8000)"
else
    cd /home/pineapi/penguin/pineastudio
    source .venv/bin/activate

    nohup pineastudio --no-browser --port 8000 --ssl \
        > /tmp/pineastudio.log 2>&1 &

    echo "  → PineaStudio PID: $!"
    sleep 2

    if curl -sfk https://localhost:8000/ > /dev/null 2>&1; then
        echo "  ✓ PineaStudio 已启动"
    else
        echo "  → 启动中，请稍等..."
    fi
fi

# ── 结果 ──
echo ""
echo "=========================================="
echo "  启动完成！"
echo ""
echo "  本机访问：  https://localhost:8000"
echo "  局域网访问：https://$(hostname -I | awk '{print $1}'):8000"
echo ""
echo "  日志文件："
echo "    Ollama:       journalctl -u ollama -f"
echo "    llama-server: tail -f /tmp/llama-server-omni.log"
echo "    PineaStudio:  tail -f /tmp/pineastudio.log"
echo "=========================================="
```

**安装和使用：**
```bash
# 保存脚本
chmod +x ~/start-pineastudio.sh

# 开机后执行
~/start-pineastudio.sh
```

---

## 6. 验证服务状态

一行检查所有服务：
```bash
echo "Ollama:       $(curl -sf http://localhost:11434/health && echo OK || echo DOWN)"
echo "llama-server: $(curl -sf http://localhost:9060/health && echo OK || echo DOWN)"
echo "PineaStudio:  $(curl -sfk https://localhost:8000/ > /dev/null && echo OK || echo DOWN)"
```

---

## 7. 停止所有服务

```bash
# 停止 PineaStudio
kill $(lsof -ti:8000) 2>/dev/null && echo "PineaStudio stopped"

# 停止 llama-server-omni
kill $(lsof -ti:9060) 2>/dev/null && echo "llama-server stopped"

# 停止 Ollama（通常不需要）
# sudo systemctl stop ollama
```

---

## 8. 常见问题

### Q: 局域网手机/平板无法使用麦克风
浏览器要求 HTTPS 安全上下文才能访问麦克风/摄像头。确保使用 `--ssl` 参数启动 PineaStudio，访问时使用 `https://` 前缀。首次访问需在浏览器中接受自签名证书警告。

### Q: Omni 页面显示 "No omni backend"
llama-server-omni 尚未启动或未就绪。运行：
```bash
curl http://localhost:9060/health
```
如果返回错误，参照第二步启动 llama-server。

### Q: Realtime 页面 ASR 识别不准确
faster-whisper 默认使用 `base` 模型。首次使用会自动下载（~150MB）。可在代码中调整为 `small` 或 `medium` 获得更高精度（但更慢）。

### Q: 端口被占用
```bash
# 查看谁占用了端口
lsof -i:8000
lsof -i:9060

# 强制释放
kill $(lsof -ti:8000)
```

### Q: GPU 显存不足
MiniCPM-o 和 Ollama 模型共享 GPU 显存。如果同时运行大模型，可能 OOM。建议：
- Omni 通话结束后，llama-server 会保持运行但空闲
- 使用较小的 Ollama 模型（如 `gemma4:e2b` 5B）
- 查看显存使用：`nvidia-smi`
