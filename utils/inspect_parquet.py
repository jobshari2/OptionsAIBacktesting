"""
Utility to inspect the schema of NIFTY parquet files.
This script reads the first available folder in the dataset and prints 
column names, data types, and a sample row for Futures, Index, and Options data.

Usage:
    python utils/inspect_parquet.py
"""
import pandas as pd
import glob
import os

# Using absolute path to avoid ambiguity
base_path = r"D:\NSE Data\Options\NIFTY\parquet"
folders = sorted([f for f in glob.glob(os.path.join(base_path, "*")) if os.path.isdir(f)])

if folders:
    folder = folders[0]
    print(f"Inspecting folder: {folder}")
    
    files = {
        "Futures": "NIFTY_FUTURES_1minute.parquet",
        "Index": "NIFTY_Index_1minute.parquet",
        "Options": "NIFTY_Options_1minute.parquet"
    }
    
    for label, filename in files.items():
        filepath = os.path.join(folder, filename)
        if os.path.exists(filepath):
            try:
                df = pd.read_parquet(filepath)
                print(f"\n<<< {label} START >>>")
                print(f"Columns: {df.columns.tolist()}")
                print(f"Dtypes: \n{df.dtypes}")
                print(f"Row count: {len(df)}")
                print(f"Sample:\n{df.head(1).to_string()}")
                print(f"<<< {label} END >>>")
            except Exception as e:
                print(f"Error reading {label}: {e}")
        else:
            print(f"File not found: {filepath}")
else:
    print("No folders found.")
