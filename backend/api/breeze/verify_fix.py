import sys
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add project root to sys.path
root = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(root))

from backend.api.breeze.breeze_historical import BreezeHistoricalClient
from backend.api.breeze.models import BreezeHistoricalRequest

def test_option_chain_request():
    print("Testing Option Chain Request Construction...")
    mock_auth = MagicMock()
    mock_auth.get_session_token.return_value = "test_session"
    mock_auth.get_api_key.return_value = "test_key"
    
    client = BreezeHistoricalClient(mock_auth)
    client._session = MagicMock()
    
    # Mock a successful response
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"Status": 200, "Success": [{"strike_price": "19000"}]}
    client._session.get.return_value = mock_response
    
    try:
        res = client.get_option_chain_quotes("NIFTY", "NFO", "options", "16-Mar-2026")
        print(f"SUCCESS: Received {len(res)} quotes")
        
        # Verify URL and params
        args, kwargs = client._session.get.call_args
        url = args[0]
        params = kwargs.get('params')
        
        print(f"URL: {url}")
        print(f"Params: {params}")
        
        if url == "https://breezeapi.icicidirect.com/api/v2/optionchain":
            print("SUCCESS: Correct URL used")
        else:
            print(f"FAILURE: Wrong URL {url}")
            
        if params.get("expiry_date") == "2026-03-16":
            print("SUCCESS: Expiry date formatted correctly")
        else:
             print(f"FAILURE: Expiry date format wrong: {params.get('expiry_date')}")
            
    except Exception as e:
        print(f"ERROR: {e}")

def test_401_handling():
    print("\nTesting 401 Session Expiry Handling...")
    mock_auth = MagicMock()
    client = BreezeHistoricalClient(mock_auth)
    client._session = MagicMock()
    
    mock_response = MagicMock()
    mock_response.status_code = 401
    mock_response.text = '{"Error":"Invalid User Details","Status":401}'
    client._session.get.return_value = mock_response
    
    try:
        client.get_option_chain_quotes("NIFTY", "NFO", "options", "16-Mar-2026")
        print("FAILURE: Should have raised ValueError for 401")
    except ValueError as e:
        print(f"SUCCESS: Caught expected error: {e}")
        if "session expired" in str(e).lower():
            print("SUCCESS: Error message is descriptive")
        else:
            print(f"FAILURE: Error message could be better: {e}")

if __name__ == "__main__":
    test_option_chain_request()
    test_401_handling()
