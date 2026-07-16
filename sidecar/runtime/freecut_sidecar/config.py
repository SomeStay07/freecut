from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


DEFAULT_ALLOWED_ORIGINS = (
    "https://freecut.net",
    "https://www.freecut.net",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)


@dataclass(frozen=True)
class Settings:
    auth_token: str
    pairing_code: str
    allowed_origins: tuple[str, ...]
    data_dir: Path

    @classmethod
    def from_env(cls) -> "Settings":
        auth_token = os.environ.get("FREECUT_SIDECAR_TOKEN", "").strip()
        pairing_code = os.environ.get("FREECUT_SIDECAR_PAIRING_CODE", "").strip()
        if not auth_token or not pairing_code:
            raise RuntimeError("The companion must be started by FreeCut Local")

        configured_origins = os.environ.get("FREECUT_ALLOWED_ORIGINS", "")
        allowed_origins = (
            tuple(
                origin.strip()
                for origin in configured_origins.split(",")
                if origin.strip()
            )
            or DEFAULT_ALLOWED_ORIGINS
        )

        data_dir = Path(
            os.environ.get(
                "FREECUT_SIDECAR_DATA_DIR",
                Path.home() / ".freecut-local",
            )
        ).resolve()
        data_dir.mkdir(parents=True, exist_ok=True)

        return cls(
            auth_token=auth_token,
            pairing_code=pairing_code,
            allowed_origins=allowed_origins,
            data_dir=data_dir,
        )
