import os
import base64
from breeze_connect import BreezeConnect
from dotenv import load_dotenv

load_dotenv()

def debug_breeze():
    app_key = os.getenv("BREEZE_APP_KEY")
    secret_key = os.getenv("BREEZE_SECRET_KEY")
    # Using the session token from the user's previous logs or .env if present
    # For now, let's just inspect the class methods
    
    breeze = BreezeConnect(api_key=app_key)
    methods = [m for m in dir(breeze) if not m.startswith("_")]
    print("Methods:", ", ".join(sorted(methods)))

    if "get_option_chain_quotes" in methods:
        print("get_option_chain_quotes is available.")
    else:
        print("get_option_chain_quotes is NOT available.")
        
    if "get_option_chain" in methods:
        print("get_option_chain is available.")
    else:
        print("get_option_chain is NOT available.")
        
if __name__ == "__main__":
    debug_breeze()
