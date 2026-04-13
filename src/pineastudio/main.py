from __future__ import annotations

import argparse
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse

from pineastudio.config import load_settings, Settings
from pineastudio.db import Database
from pineastudio.services.backend_manager import BackendManager
from pineastudio.services.memory_manager import MemoryManager
from pineastudio.services.preferences import Preferences

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("pineastudio")

_db: Database | None = None
_manager: BackendManager | None = None
_settings: Settings | None = None
_memory: MemoryManager | None = None
_prefs: Preferences | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _db, _manager, _settings, _memory, _prefs
    _settings = load_settings()
    logger.info("Data directory: %s", _settings.data_dir)

    _db = Database(_settings.db_path)
    await _db.connect()

    _prefs = Preferences(_settings.data_dir)
    logger.info("Preferences loaded")

    from pineastudio.services.tts_service import configure_voices
    configure_voices(
        zh=_prefs.get("tts_voice_zh", ""),
        en=_prefs.get("tts_voice_en", ""),
    )

    _memory = MemoryManager(_settings.data_dir)
    _memory.ensure_dirs()
    logger.info("Memory initialized (initialized=%s)", _memory.is_initialized())

    _manager = BackendManager(_db)
    await _manager.auto_discover(models_dir=str(_settings.models_dir))

    _init_routers(_manager, _db, _settings, _memory, _prefs)

    backends = _manager.all_backends()
    if backends:
        logger.info("Active backends: %s", ", ".join(b.id for b in backends))
    else:
        logger.info("No backends detected. Add one via the UI or API.")

    yield

    await _manager.shutdown()
    await _db.close()


def create_app() -> FastAPI:
    app = FastAPI(
        title="PineaStudio",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from pineastudio.routers import backends, conversations, hub, memory, models, omni, proxy, realtime, settings as settings_router, setup, system

    app.include_router(proxy.router)
    app.include_router(backends.router)
    app.include_router(models.router)
    app.include_router(hub.router)
    app.include_router(system.router)
    app.include_router(conversations.router)
    app.include_router(omni.router)
    app.include_router(realtime.router)
    app.include_router(memory.router)
    app.include_router(setup.router)
    app.include_router(settings_router.router)

    _mount_frontend(app)

    return app


def _init_routers(manager: BackendManager, db: Database, settings: Settings,
                   mm: MemoryManager | None = None,
                   prefs: Preferences | None = None) -> None:
    from pineastudio.routers import backends, conversations, hub, memory, models, omni, proxy, realtime, settings as settings_router, setup
    proxy.init_proxy(manager, mm)
    backends.init_backends_router(manager)
    models.init_models_router(manager)
    hub.init_hub_router(db, settings)
    conversations.init_conversations_router(db)
    omni.init_omni_router(manager)
    if mm:
        memory.init_memory_router(mm)
        setup.init_setup_router(mm)
        realtime.init_realtime_memory(mm)
    if prefs:
        settings_router.init_settings_router(prefs)
        realtime.init_realtime_prefs(prefs)


def _mount_frontend(app: FastAPI) -> None:
    """Serve the React SPA if the build directory exists."""
    from pathlib import Path

    # Check both dev and installed locations
    candidates = [
        Path(__file__).parent.parent.parent / "frontend" / "dist",
        Path(__file__).parent / "static",
    ]
    for dist_dir in candidates:
        if dist_dir.is_dir() and (dist_dir / "index.html").exists():
            app.mount("/assets", StaticFiles(directory=dist_dir / "assets"), name="assets")

            @app.get("/{path:path}")
            async def serve_spa(path: str):
                file_path = dist_dir / path
                if file_path.is_file():
                    return FileResponse(file_path)
                return FileResponse(dist_dir / "index.html")

            logger.info("Serving frontend from %s", dist_dir)
            return

    @app.get("/")
    async def no_frontend():
        return {
            "message": "PineaStudio API is running. Frontend not built yet.",
            "docs": "/docs",
            "api": {
                "backends": "/api/backends",
                "models": "/api/models",
                "system": "/api/system/info",
                "hub_search": "/api/hub/search?q=qwen+gguf",
                "openai_models": "/v1/models",
            },
        }


app = create_app()


def _ensure_ssl_cert(cert_dir: Path) -> tuple[Path, Path]:
    """Generate a self-signed cert if none exists. Returns (certfile, keyfile)."""
    cert_file = cert_dir / "cert.pem"
    key_file = cert_dir / "key.pem"
    if cert_file.exists() and key_file.exists():
        return cert_file, key_file

    cert_dir.mkdir(parents=True, exist_ok=True)
    import subprocess
    logger.info("Generating self-signed SSL certificate...")
    subprocess.run([
        "openssl", "req", "-x509", "-newkey", "rsa:2048",
        "-keyout", str(key_file), "-out", str(cert_file),
        "-days", "365", "-nodes",
        "-subj", "/CN=PineaStudio/O=PineaStudio",
    ], check=True, capture_output=True)
    logger.info("SSL certificate generated at %s", cert_dir)
    return cert_file, key_file


def cli() -> None:
    parser = argparse.ArgumentParser(description="PineaStudio")
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--ssl", action="store_true",
                        help="Enable HTTPS with self-signed cert (required for mic/camera on non-localhost)")
    args = parser.parse_args()

    settings = load_settings()
    host = args.host or settings.host
    port = args.port or settings.port

    ssl_kwargs: dict = {}
    scheme = "http"
    if args.ssl:
        from pathlib import Path as P
        cert_dir = P(settings.data_dir) / "ssl"
        cert_file, key_file = _ensure_ssl_cert(cert_dir)
        ssl_kwargs = {
            "ssl_certfile": str(cert_file),
            "ssl_keyfile": str(key_file),
        }
        scheme = "https"

    if not args.no_browser:
        _open_browser_later(host, port, scheme)

    uvicorn.run(
        "pineastudio.main:app",
        host=host,
        port=port,
        log_level="info",
        **ssl_kwargs,
    )


def _open_browser_later(host: str, port: int, scheme: str = "http") -> None:
    import threading
    import time
    import webbrowser

    def _open():
        time.sleep(1.5)
        url = f"{scheme}://{'localhost' if host == '0.0.0.0' else host}:{port}"
        webbrowser.open(url)

    threading.Thread(target=_open, daemon=True).start()


if __name__ == "__main__":
    cli()
