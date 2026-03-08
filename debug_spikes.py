import polars as pl
from backend.data_engine.loader import DataLoader
from backend.analytics.oi_analyzer import OIAnalyzer
import time
import os

def test_spikes(expiry="27JAN2026"):
    loader = DataLoader()
    print(f"Testing for {expiry}...")
    
    # Try to load the data
    try:
        start = time.time()
        df = loader.load_options(expiry, use_unified=True)
        print(f"Loaded {len(df)} rows in {time.time() - start:.2f}s")
        
        if df.is_empty():
            print("No data found for this expiry.")
            return

        print("Analyzing spikes (Threshold=0.5)...")
        start = time.time()
        spikes = OIAnalyzer.detect_spikes(df, 0.5, 0.5)
        print(f"Found {len(spikes)} spikes in {time.time() - start:.2f}s")
        
        if len(spikes) > 0:
            print(f"First 3 spikes sample:")
            for i in range(min(3, len(spikes))):
                print(f"  {spikes[i]}")
    except Exception as e:
        print(f"Error during test: {e}")

if __name__ == "__main__":
    # Check what expiries are available
    loader = DataLoader()
    try:
        from backend.data_engine.expiry_discovery import ExpiryDiscovery
        disco = ExpiryDiscovery()
        expiries = disco.get_available_expiries()
        if expiries:
            target = expiries[0]['folder']
            print(f"Found expiry: {target}")
            test_spikes(target)
        else:
            print("No expiries found.")
    except Exception as e:
        print(f"Discovery error: {e}")
        # fallback
        test_spikes()
