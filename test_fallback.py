import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.api.breeze.breeze_historical import BreezeHistoricalClient
from backend.api.breeze.auth import get_auth
import logging

logging.basicConfig(level=logging.DEBUG)

def test_fallback():
    auth = get_auth()
    client = BreezeHistoricalClient(auth)
    
    # Try fetching for an upcoming expiry (17-Mar-2026 is Tuesday)
    print("Testing option chain fallback...")
    try:
        chain = client.get_option_chain_quotes(
            stock_code="NIFTY",
            exchange_code="NFO",
            product_type="options",
            expiry_date="17-Mar-2026"  # Using exactly what the frontend sends
        )
        print(f"Returned {len(chain)} records.")
        if chain:
            print(chain[0])
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_fallback()
