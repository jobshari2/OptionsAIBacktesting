"""
Diagnostic utility to identify and inspect folders where the merging 
process failed. It checks for the existence of 'NIFTY_Unified_1minute.parquet' 
and prints column headers of the source files for problematic expiries.

Usage:
    python utils/investigate_failures.py
"""
import os
import glob
import pandas as pd

source_base = r"D:\NSE Data\Options\NIFTY\parquet"
target_base = r"D:\NSE Data\Options\NIFTY\parquet_unified"

folders = sorted([f for f in glob.glob(os.path.join(source_base, "*")) if os.path.isdir(f)])

failures = []
for folder in folders:
    expiry = os.path.basename(folder)
    unified_file = os.path.join(target_base, expiry, "NIFTY_Unified_1minute.parquet")
    if not os.path.exists(unified_file):
        failures.append(expiry)

print(f"Total failures: {len(failures)}")
print(f"Failed expiries: {failures}")

for expiry in failures:
    print(f"\n--- Investigating {expiry} ---")
    source_folder = os.path.join(source_base, expiry)
    for f in os.listdir(source_folder):
        if f.endswith(".parquet"):
            try:
                df = pd.read_parquet(os.path.join(source_folder, f))
                print(f"File: {f}, Columns: {df.columns.tolist()}")
            except Exception as e:
                print(f"Error reading {f}: {e}")
