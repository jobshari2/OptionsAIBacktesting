"""
Performance benchmarking utility for comparing Unified vs Individual file loading.
"""
import time
import random
import statistics
from pathlib import Path
from typing import Dict, List, Any

from backend.data_engine.loader import DataLoader
from backend.data_engine.expiry_discovery import ExpiryDiscovery
from backend.config import config
from backend.logger import logger

class DataBenchmark:
    def __init__(self):
        self.loader = DataLoader()
        self.discovery = ExpiryDiscovery()
        
    def run_benchmark(self, num_tests: int = 5) -> Dict[str, Any]:
        """
        Runs performance tests comparing unified and individual loading.
        """
        all_expiries = self.discovery.get_expiry_folders()
        if not all_expiries:
            return {"error": "No expiries found"}
            
        # Select random expiries
        test_expiries = random.sample(all_expiries, min(num_tests, len(all_expiries)))
        
        results = []
        
        for expiry in test_expiries:
            # 1. Benchmark Individual Loading
            self.loader.clear_cache()
            start_sep = time.perf_counter()
            # Load all 3 components
            self.loader.load_options(expiry, use_unified=False)
            self.loader.load_index(expiry, use_unified=False)
            self.loader.load_futures(expiry, use_unified=False)
            sep_time = (time.perf_counter() - start_sep) * 1000
            
            # 2. Benchmark Unified Loading
            self.loader.clear_cache()
            start_uni = time.perf_counter()
            # In unified, load_all_for_expiry is optimized to read once
            self.loader.load_all_for_expiry(expiry, use_unified=True)
            uni_time = (time.perf_counter() - start_uni) * 1000
            
            improvement = ((sep_time - uni_time) / sep_time) * 100 if sep_time > 0 else 0
            
            results.append({
                "expiry": expiry,
                "individual_ms": round(sep_time, 2),
                "unified_ms": round(uni_time, 2),
                "improvement_pct": round(improvement, 2)
            })
            
        avg_sep = statistics.mean([r["individual_ms"] for r in results])
        avg_uni = statistics.mean([r["unified_ms"] for r in results])
        avg_improvement = ((avg_sep - avg_uni) / avg_sep) * 100 if avg_sep > 0 else 0
        
        return {
            "num_tests": len(results),
            "averages": {
                "individual_ms": round(avg_sep, 2),
                "unified_ms": round(avg_uni, 2),
                "improvement_pct": round(avg_improvement, 2)
            },
            "details": results
        }

if __name__ == "__main__":
    benchmark = DataBenchmark()
    print("Running benchmark...")
    res = benchmark.run_benchmark(5)
    import json
    print(json.dumps(res, indent=2))
