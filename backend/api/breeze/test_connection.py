import sys
import os
from pathlib import Path

# Add the directory containing the project to sys.path
# If the root is d:\Projects\OptionsAIBacktesting2\OptionsAIBacktesting
# we need to add that path.
root = Path(__file__).resolve().parent.parent.parent.parent
sys.path.append(str(root))

from backend.api.breeze.routes_breeze import get_auth, get_token_store
from backend.config import config

def test_login_url():
    print("Testing Breeze Login URL generation...")
    # Mock some keys for testing
    config.breeze.app_key = "test_app_key"
    
    store = get_token_store()
    auth = get_auth(store)
    
    try:
        url = auth.get_login_url()
        print(f"Generated URL: {url}")
        if "test_app_key" in url:
            print("SUCCESS: URL contains app_key")
        else:
            print("FAILURE: URL missing app_key")
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    test_login_url()
