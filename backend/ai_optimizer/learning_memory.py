"""
AI Learning Memory — stores and retrieves learning history, strategy evolution,
and parameter changes across optimization runs.
"""
import json
from pathlib import Path
from datetime import datetime
from typing import Optional

from backend.config import get_ai_learning_dir


class LearningMemory:
    """Manages AI learning history and strategy evolution."""

    def __init__(self, base_dir: Path | None = None):
        self.base_dir = base_dir or get_ai_learning_dir()
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.history_file = self.base_dir / "learning_history.json"
        self.evolution_file = self.base_dir / "strategy_evolution.json"
        self.params_file = self.base_dir / "parameter_changes.json"

    def _load_json(self, file_path: Path) -> list:
        """Load JSON file, create if doesn't exist."""
        if file_path.exists():
            with open(file_path, "r") as f:
                return json.load(f)
        return []

    def _save_json(self, file_path: Path, data: list):
        """Save data to JSON file."""
        with open(file_path, "w") as f:
            json.dump(data, f, indent=2, default=str)

    def record_run(
        self,
        strategy_name: str,
        expiry: str,
        parameters: dict,
        results: dict,
        market_conditions: dict | None = None,
        improvements: dict | None = None,
    ):
        """
        Record a single optimization run.
        """
        history = self._load_json(self.history_file)

        entry = {
            "timestamp": datetime.now().isoformat(),
            "strategy_name": strategy_name,
            "expiry": expiry,
            "parameters": parameters,
            "results": results,
            "market_conditions": market_conditions or {},
            "improvements": improvements or {},
            "run_number": len(history) + 1,
        }

        history.append(entry)
        self._save_json(self.history_file, history)

    def record_parameter_change(
        self,
        strategy_name: str,
        parameter_name: str,
        old_value: float,
        new_value: float,
        reason: str,
        impact: dict | None = None,
    ):
        """Record a parameter change decision."""
        changes = self._load_json(self.params_file)

        change = {
            "timestamp": datetime.now().isoformat(),
            "strategy_name": strategy_name,
            "parameter": parameter_name,
            "previous_value": old_value,
            "new_value": new_value,
            "reason": reason,
            "impact": impact or {},
        }

        changes.append(change)
        self._save_json(self.params_file, changes)

    def record_strategy_evolution(
        self,
        strategy_name: str,
        generation: int,
        parameters: dict,
        fitness: float,
        notes: str = "",
    ):
        """Record strategy evolution step."""
        evolution = self._load_json(self.evolution_file)

        entry = {
            "timestamp": datetime.now().isoformat(),
            "strategy_name": strategy_name,
            "generation": generation,
            "parameters": parameters,
            "fitness": fitness,
            "notes": notes,
        }

        evolution.append(entry)
        self._save_json(self.evolution_file, evolution)

    def get_learning_history(
        self,
        strategy_name: str | None = None,
        limit: int = 100,
    ) -> list[dict]:
        """Get learning history, optionally filtered by strategy."""
        history = self._load_json(self.history_file)

        if strategy_name:
            history = [h for h in history if h["strategy_name"] == strategy_name]

        return history[-limit:]

    def get_parameter_changes(
        self,
        strategy_name: str | None = None,
    ) -> list[dict]:
        """Get parameter change history."""
        changes = self._load_json(self.params_file)

        if strategy_name:
            changes = [c for c in changes if c["strategy_name"] == strategy_name]

        return changes

    def get_strategy_evolution(
        self,
        strategy_name: str | None = None,
    ) -> list[dict]:
        """Get strategy evolution history."""
        evolution = self._load_json(self.evolution_file)

        if strategy_name:
            evolution = [e for e in evolution if e["strategy_name"] == strategy_name]

        return evolution

    def get_best_parameters(self, strategy_name: str) -> dict | None:
        """Get the best performing parameters for a strategy."""
        history = self.get_learning_history(strategy_name)
        if not history:
            return None

        # Find the run with the best Sharpe ratio
        best = max(
            history,
            key=lambda h: h.get("results", {}).get("sharpe_ratio", float("-inf")),
        )
        return best.get("parameters")

    def get_suggestions(self, strategy_name: str) -> dict:
        """Get AI-suggested parameter improvements based on history."""
        history = self.get_learning_history(strategy_name)
        changes = self.get_parameter_changes(strategy_name)

        if not history:
            return {"suggestions": [], "confidence": 0.0}

        # Analyze trends in parameter changes
        suggestions = []
        if len(history) >= 3:
            recent = history[-3:]
            pnls = [r.get("results", {}).get("total_pnl", 0) for r in recent]

            if all(p < 0 for p in pnls):
                suggestions.append({
                    "type": "reduce_risk",
                    "message": "Recent runs show consistent losses. Consider widening stop-loss or reducing position size.",
                    "priority": "high",
                })
            elif all(p > 0 for p in pnls):
                suggestions.append({
                    "type": "scale_up",
                    "message": "Strategy is performing consistently well. Consider gradual position sizing increase.",
                    "priority": "medium",
                })

        return {
            "strategy": strategy_name,
            "suggestions": suggestions,
            "total_runs": len(history),
            "best_params": self.get_best_parameters(strategy_name),
        }
