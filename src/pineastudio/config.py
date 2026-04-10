from __future__ import annotations

import tomllib
from pathlib import Path
from pydantic_settings import BaseSettings


DEFAULT_DATA_DIR = Path.home() / ".pineastudio"


class Settings(BaseSettings):
    host: str = "127.0.0.1"
    port: int = 8000
    data_dir: Path = DEFAULT_DATA_DIR
    models_dir: Path = DEFAULT_DATA_DIR / "models"
    models_omni_dir: Path = DEFAULT_DATA_DIR / "models-omni"
    bin_dir: Path = DEFAULT_DATA_DIR / "bin"
    log_dir: Path = DEFAULT_DATA_DIR / "logs"
    db_path: Path = DEFAULT_DATA_DIR / "pineastudio.db"
    hf_token: str = ""
    open_browser: bool = True

    def ensure_dirs(self) -> None:
        for d in (self.data_dir, self.models_dir, self.models_omni_dir,
                  self.bin_dir, self.log_dir):
            d.mkdir(parents=True, exist_ok=True)


def load_settings() -> Settings:
    """Load settings from config.toml if it exists, else use defaults."""
    config_path = DEFAULT_DATA_DIR / "config.toml"
    overrides: dict = {}

    if config_path.exists():
        with open(config_path, "rb") as f:
            data = tomllib.load(f)

        server = data.get("server", {})
        if "host" in server:
            overrides["host"] = server["host"]
        if "port" in server:
            overrides["port"] = server["port"]

        storage = data.get("storage", {})
        if "models_dir" in storage:
            overrides["models_dir"] = Path(storage["models_dir"]).expanduser()
        if "models_omni_dir" in storage:
            overrides["models_omni_dir"] = Path(storage["models_omni_dir"]).expanduser()

        hf = data.get("huggingface", {})
        if "token" in hf:
            overrides["hf_token"] = hf["token"]

    settings = Settings(**overrides)
    settings.ensure_dirs()

    if not config_path.exists():
        _write_default_config(config_path, settings)

    return settings


def _write_default_config(path: Path, s: Settings) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"""\
[server]
host = "{s.host}"
port = {s.port}

[storage]
models_dir = "{s.models_dir}"
models_omni_dir = "{s.models_omni_dir}"

[huggingface]
# Uncomment and set your token for gated models (e.g. Llama)
# token = "hf_..."
""")
