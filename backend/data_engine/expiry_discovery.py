"""
Expiry discovery — scans parquet directory for expiry folders and parses dates.
"""
import os
from datetime import datetime
from pathlib import Path
from functools import lru_cache

from backend.config import config


class ExpiryDiscovery:
    """Discovers and manages expiry folders from the data directory."""

    def __init__(self, base_path: str | None = None):
        self.base_path = Path(base_path or config.data.base_path)

    @lru_cache(maxsize=1)
    def discover_all(self) -> list[dict]:
        """
        Scan the base directory for expiry folders.
        Returns a sorted list of dicts: {folder_name, date, path}.
        """
        expiries = []
        if not self.base_path.exists():
            return expiries

        for entry in os.scandir(self.base_path):
            if entry.is_dir():
                parsed = self._parse_expiry_name(entry.name)
                if parsed:
                    expiries.append({
                        "folder_name": entry.name,
                        "date": parsed,
                        "date_str": parsed.strftime("%Y-%m-%d"),
                        "path": str(entry.path),
                    })

        expiries.sort(key=lambda x: x["date"])
        return expiries

    def get_expiry_folders(self) -> list[str]:
        """Get sorted list of expiry folder names."""
        return [e["folder_name"] for e in self.discover_all()]

    def get_expiry_dates(self) -> list[str]:
        """Get sorted list of expiry dates as YYYY-MM-DD strings."""
        return [e["date_str"] for e in self.discover_all()]

    def get_expiry_path(self, folder_name: str) -> Path | None:
        """Get the path for a specific expiry folder."""
        path = self.base_path / folder_name
        return path if path.exists() else None

    def filter_by_date_range(
        self,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> list[dict]:
        """
        Filter expiries by date range (YYYY-MM-DD format).
        """
        all_expiries = self.discover_all()
        result = all_expiries

        if start_date:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            result = [e for e in result if e["date"] >= start_dt]

        if end_date:
            end_dt = datetime.strptime(end_date, "%Y-%m-%d")
            result = [e for e in result if e["date"] <= end_dt]

        return result

    def get_nearest_expiry(self, target_date: str) -> dict | None:
        """Find the nearest expiry to a given date."""
        target = datetime.strptime(target_date, "%Y-%m-%d")
        all_expiries = self.discover_all()
        if not all_expiries:
            return None

        return min(all_expiries, key=lambda e: abs((e["date"] - target).days))

    @staticmethod
    def _parse_expiry_name(name: str) -> datetime | None:
        """Parse expiry folder name like '02JAN2025' into datetime."""
        try:
            return datetime.strptime(name, "%d%b%Y")
        except ValueError:
            return None

    def clear_cache(self):
        """Clear the discovery cache."""
        self.discover_all.cache_clear()
