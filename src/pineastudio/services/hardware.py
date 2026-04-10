from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import psutil

from pineastudio.schemas import GpuInfo, SystemInfo


def get_system_info() -> SystemInfo:
    mem = psutil.virtual_memory()
    disk = shutil.disk_usage(str(Path.home()))
    return SystemInfo(
        cpu_count=psutil.cpu_count() or 1,
        memory_total_mb=mem.total // (1024 * 1024),
        memory_used_mb=mem.used // (1024 * 1024),
        disk_total_gb=round(disk.total / (1024 ** 3), 1),
        disk_free_gb=round(disk.free / (1024 ** 3), 1),
        gpus=_get_gpu_info(),
    )


def _get_gpu_info() -> list[GpuInfo]:
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=index,name,memory.total,memory.used,memory.free,utilization.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            return []
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return []

    def _safe_int(val: str) -> int:
        try:
            return int(val)
        except (ValueError, TypeError):
            return 0

    gpus: list[GpuInfo] = []
    for line in result.stdout.strip().split("\n"):
        if not line.strip():
            continue
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 6:
            continue
        gpus.append(GpuInfo(
            index=_safe_int(parts[0]),
            name=parts[1],
            memory_total_mb=_safe_int(parts[2]),
            memory_used_mb=_safe_int(parts[3]),
            memory_free_mb=_safe_int(parts[4]),
            utilization_pct=_safe_int(parts[5]),
        ))
    return gpus
