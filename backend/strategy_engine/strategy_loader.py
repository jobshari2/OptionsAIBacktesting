"""
Strategy loader — loads and saves YAML strategy configurations.
"""
import yaml
from pathlib import Path

from backend.config import get_strategies_dir
from .base_strategy import Strategy


class StrategyLoader:
    """Loads and manages strategy YAML configurations."""

    def __init__(self, strategies_dir: str | Path | None = None):
        self.strategies_dir = Path(strategies_dir) if strategies_dir else get_strategies_dir()
        self.strategies_dir.mkdir(parents=True, exist_ok=True)

    def load_strategy(self, name: str) -> Strategy:
        """Load a strategy from a YAML file."""
        file_path = self.strategies_dir / f"{name}.yaml"
        if not file_path.exists():
            raise FileNotFoundError(f"Strategy file not found: {file_path}")

        with open(file_path, "r") as f:
            data = yaml.safe_load(f)

        return Strategy.from_dict(data)

    def save_strategy(self, strategy: Strategy) -> Path:
        """Save a strategy to a YAML file."""
        file_path = self.strategies_dir / f"{strategy.name}.yaml"
        data = strategy.to_dict()

        with open(file_path, "w") as f:
            yaml.dump(data, f, default_flow_style=False, sort_keys=False)

        return file_path

    def list_strategies(self) -> list[dict]:
        """List all available strategy files."""
        strategies = []
        for file_path in self.strategies_dir.glob("*.yaml"):
            try:
                with open(file_path, "r") as f:
                    data = yaml.safe_load(f)
                strategies.append({
                    "name": data.get("name", file_path.stem),
                    "description": data.get("description", ""),
                    "file": str(file_path),
                    "tags": data.get("tags", []),
                    "legs_count": len(data.get("legs", [])),
                })
            except Exception:
                continue
        return strategies

    def delete_strategy(self, name: str) -> bool:
        """Delete a strategy file."""
        file_path = self.strategies_dir / f"{name}.yaml"
        if file_path.exists():
            file_path.unlink()
            return True
        return False

    def load_all_strategies(self) -> list[Strategy]:
        """Load all strategies from the strategies directory."""
        strategies = []
        for file_path in self.strategies_dir.glob("*.yaml"):
            try:
                strategies.append(
                    self.load_strategy(file_path.stem)
                )
            except Exception:
                continue
        return strategies
