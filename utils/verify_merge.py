"""
Verification utility to inspect the contents of a unified parquet file.
Prints schema types, sample data, and instrument counts to ensure the 
merging process was accurate.

Usage:
    python utils/verify_merge.py
    (Modify 'target_path' variable inside the script to point to different expiries)
"""
import pandas as pd
import os

target_path = r"D:\NSE Data\Options\NIFTY\parquet_unified\21JAN2021\NIFTY_Unified_1minute.parquet"

if os.path.exists(target_path):
    df = pd.read_parquet(target_path)
    print(f"Columns: {df.columns.tolist()}")
    print(f"Sample data:\n{df.head(5).to_string()}")
    print(f"Instrument Counts:\n{df['InstrumentType'].value_counts()}")
    print(f"Schema Types:\n{df.dtypes}")
else:
    print(f"File not found: {target_path}")
