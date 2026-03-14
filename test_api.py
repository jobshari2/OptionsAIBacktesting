import requests
import json

payload = {
    "expiry": "02May2024",
    "queries": [
        {
            "id": "entry_0",
            "timestamp": "02/05/2024 09:16:00",
            "strike": 22650,
            "right": "CE"
        },
        {
            "id": "entry_1",
            "timestamp": "2024-05-02 09:17:00",
            "strike": 22650,
            "right": "PE"
        }
    ],
    "use_unified": True
}

try:
    r = requests.post("http://localhost:8000/api/data/backtest-options", json=payload)
    print("STATUS:", r.status_code)
    print("RESPONSE:", json.dumps(r.json(), indent=2))
except Exception as e:
    print("Error:", e)
