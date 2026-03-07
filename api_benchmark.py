import requests
import time
import json
import sys

BASE_URL = "http://localhost:8000"

def time_request(method, url, **kwargs):
    start = time.time()
    try:
        response = requests.request(method, f"{BASE_URL}{url}", **kwargs)
        duration = time.time() - start
        
        try:
            data = response.json()
        except:
            data = response.text
            
        return data, duration, response.status_code
    except requests.exceptions.RequestException as e:
        duration = time.time() - start
        return str(e), duration, None

def print_result(method, url, duration, status, extra=""):
    color = "\033[92m" if status and 200 <= status < 300 else "\033[91m"
    reset = "\033[0m"
    status_str = f"{color}{status}{reset}" if status else f"{color}FAILED{reset}"
    print(f"[{method} {url}] Status: {status_str} | Time: {duration:.4f}s {extra}")

def run_benchmarks():
    print("==========================================")
    print("      API BEHCHMARK & TEST SUITE          ")
    print("==========================================")
    print(f"Target: {BASE_URL}\n")

    # 1. Test Server Health
    res, dur, status = time_request("GET", "/api/health")
    print_result("GET", "/api/health", dur, status)
    if status != 200:
        print("Backend is not reachable. Ensure the server is running.")
        sys.exit(1)

    # 2. Data APIs
    print("\n--- DATA APIs ---")
    res, dur, status = time_request("GET", "/api/data/expiries", params={"start_date": "01/01/2024", "end_date": "31/12/2026"})
    print_result("GET", "/api/data/expiries", dur, status)
    
    expiry = None
    if isinstance(res, dict) and "expiries" in res and len(res["expiries"]) > 0:
        expiry = res["expiries"][-1]["folder"] # Use the latest available expiry
        print(f"  -> Selected historical expiry for tests: {expiry}")
    else:
        print("  -> Could not fetch an expiry folder. Further data API tests might fail.")
        if isinstance(res, dict) and "detail" in res:
             print(f"     Error: {res['detail']}")

    if expiry:
        res, dur, status = time_request("GET", "/api/data/option-chain", params={"expiry": expiry})
        print_result("GET", "/api/data/option-chain", dur, status, f"({len(res.get('data', [])) if isinstance(res, dict) else 0} records)")

        res, dur, status = time_request("GET", "/api/data/index-data", params={"expiry": expiry})
        print_result("GET", "/api/data/index-data", dur, status, f"({len(res.get('data', [])) if isinstance(res, dict) else 0} records)")

        res, dur, status = time_request("GET", "/api/data/futures-data", params={"expiry": expiry})
        print_result("GET", "/api/data/futures-data", dur, status, f"({len(res.get('data', [])) if isinstance(res, dict) else 0} records)")

    # 3. Strategy APIs
    print("\n--- STRATEGY APIs ---")
    res, dur, status = time_request("GET", "/api/strategies/templates")
    print_result("GET", "/api/strategies/templates", dur, status, f"({len(res.get('templates', [])) if isinstance(res, dict) else 0} templates)")
    
    res, dur, status = time_request("GET", "/api/strategies/")
    print_result("GET", "/api/strategies/", dur, status)

    # 4. Analytics APIs
    print("\n--- ANALYTICS APIs ---")
    greeks_payload = {
        "spot_price": 22000,
        "strike": 22000,
        "time_to_expiry": 0.015,
        "risk_free_rate": 0.065,
        "volatility": 0.15,
        "option_type": "CE"
    }
    res, dur, status = time_request("POST", "/api/analytics/greeks", json=greeks_payload)
    print_result("POST", "/api/analytics/greeks", dur, status)

    iv_payload = {
        "market_price": 105,
        "spot_price": 22000,
        "strike": 22000,
        "time_to_expiry": 0.015,
        "risk_free_rate": 0.065,
        "option_type": "CE"
    }
    res, dur, status = time_request("POST", "/api/analytics/implied-volatility", json=iv_payload)
    print_result("POST", "/api/analytics/implied-volatility", dur, status)

    payoff_payload = {
        "spot_price": 22000,
        "lot_size": 25,
        "range_pct": 5.0,
        "legs": [
            {"strike": 22000, "right": "CE", "direction": "sell", "entry_price": 100, "quantity": 1},
            {"strike": 22000, "right": "PE", "direction": "sell", "entry_price": 100, "quantity": 1}
        ]
    }
    res, dur, status = time_request("POST", "/api/analytics/payoff", json=payoff_payload)
    print_result("POST", "/api/analytics/payoff", dur, status)

    # 5. Backtest Workflow
    print("\n--- BACKTEST WORKFLOW ---")
    bt_payload = {
        "strategy_name": "short_straddle",
        "start_date": "01/01/2024",
        "end_date": "10/01/2024", # Small 10-day window for speed test
        "initial_capital": 1000000
    }
    print(f"Triggering Backtest: {bt_payload['strategy_name']} from {bt_payload['start_date']} to {bt_payload['end_date']}...")
    res, dur, status = time_request("POST", "/api/backtest/run", json=bt_payload)
    print_result("POST", "/api/backtest/run", dur, status)

    if isinstance(res, dict) and "run_id" in res:
        run_id = res["run_id"]
        print(f"  -> Run ID initialized: {run_id}. Waiting for completion...")
        
        test_start_time = time.time()
        completed = False
        
        # Poll up to 60 seconds
        for i in range(60):
            stat_res, stat_dur, stat_status = time_request("GET", f"/api/backtest/status/{run_id}")
            if isinstance(stat_res, dict):
                if stat_res.get("status") == "completed":
                    bt_total_time = time.time() - test_start_time
                    print(f"  -> Backtest SUCCESS in {bt_total_time:.2f}s!")
                    completed = True
                    break
                elif stat_res.get("status") == "error":
                    print(f"  -> Backtest FAILED: {stat_res.get('error')}")
                    break
                elif i % 5 == 0:
                    current = stat_res.get('current_expiry', '...')
                    comp = stat_res.get('completed', 0)
                    tot = stat_res.get('total', 0)
                    print(f"     [Status]: {comp}/{tot} expiries completed. Currently on {current}")
            
            time.sleep(1)
            
        if completed:
            res, dur, status = time_request("GET", f"/api/backtest/results/{run_id}")
            metrics = res.get('metrics', {}) if isinstance(res, dict) else {}
            print_result("GET", f"/api/backtest/results/{run_id}", dur, status, f"(PnL: {res.get('total_pnl', 'N/A')} | Trades: {res.get('total_trades', 'N/A')})")
            
            res, dur, status = time_request("GET", f"/api/backtest/trades/{run_id}")
            print_result("GET", f"/api/backtest/trades/{run_id}", dur, status)
            
            res, dur, status = time_request("GET", f"/api/analytics/metrics/{run_id}")
            print_result("GET", f"/api/analytics/metrics/{run_id}", dur, status)

    print("\n==========================================")
    print("           BENCHMARK COMPLETED            ")
    print("==========================================")

if __name__ == "__main__":
    run_benchmarks()
