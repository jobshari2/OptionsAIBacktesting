from __future__ import annotations

import json
from pathlib import Path
from typing import Optional
from .models import BreezeTokenData


class BreezeTokenStore:
    def __init__(self, file_path: Path):
        self._file_path = file_path

    def load(self) -> Optional[BreezeTokenData]:
        if not self._file_path.exists():
            return None
        raw = self._file_path.read_text(encoding="utf-8")
        if not raw.strip():
            return None
        try:
            data = json.loads(raw)
            return BreezeTokenData.model_validate(data)
        except Exception:
            return None

    def save(self, token_data: BreezeTokenData) -> None:
        self._file_path.parent.mkdir(parents=True, exist_ok=True)
        payload = token_data.model_dump(mode="json")
        self._file_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def clear(self) -> None:
        if self._file_path.exists():
            self._file_path.unlink()
