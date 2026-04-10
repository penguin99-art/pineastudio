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
        echo "  ✗ Ollama 启动失败，请检查: systemctl status ollama"
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
        if [ "$i" -eq 60 ]; then
            echo "  ⚠ 模型加载超时 (60s)，请查看 /tmp/llama-server-omni.log"
        fi
    done
fi

# ── 3. 启动 PineaStudio ──
echo ""
echo "[3/3] 启动 PineaStudio..."
if curl -sfk https://localhost:8000/ > /dev/null 2>&1; then
    echo "  ✓ PineaStudio 已运行 (port 8000)"
else
    cd /home/pineapi/penguin/pineastudio
    source .venv/bin/activate

    nohup pineastudio --no-browser --port 8000 --ssl \
        > /tmp/pineastudio.log 2>&1 &

    echo "  → PineaStudio PID: $!"
    sleep 3

    if curl -sfk https://localhost:8000/ > /dev/null 2>&1; then
        echo "  ✓ PineaStudio 已启动"
    else
        echo "  → 启动中，请稍等片刻后访问"
    fi
fi

# ── 结果 ──
echo ""
echo "=========================================="
echo "  启动完成！"
echo ""
echo "  本机访问：  https://localhost:8000"
LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -n "$LAN_IP" ]; then
    echo "  局域网访问：https://${LAN_IP}:8000"
fi
echo ""
echo "  日志文件："
echo "    Ollama:       journalctl -u ollama -f"
echo "    llama-server: tail -f /tmp/llama-server-omni.log"
echo "    PineaStudio:  tail -f /tmp/pineastudio.log"
echo "=========================================="
