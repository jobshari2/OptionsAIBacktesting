"""
Core utility to merge NIFTY Index, Futures, and Options data into a single 
unified parquet file per expiry. 

Features:
- Normalizes column names (e.g., 'timestamp' -> 'Date', 'ltp' -> 'Close').
- Adds 'InstrumentType' metadata (INDEX, FUTURES, OPTION).
- Ensures consistent schema across all processed files.
- Skips already processed folders.

Usage:
    python utils/merge_expiry_data.py [optional_limit]
    Example: python utils/merge_expiry_data.py 5  # Merge first 5 expiries
"""
import pandas as pd
import glob
import os
import shutil
from pathlib import Path

def merge_expiry(source_folder, target_base_folder):
    expiry_name = os.path.basename(source_folder)
    target_folder = os.path.join(target_base_folder, expiry_name)
    merged_path = os.path.join(target_folder, "NIFTY_Unified_1minute.parquet")
    
    if os.path.exists(merged_path):
        return True, f"Skipped {expiry_name} (exists)"
        
    os.makedirs(target_folder, exist_ok=True)
    
    file_map = {
        "INDEX": "NIFTY_Index_1minute.parquet",
        "FUTURES": "NIFTY_FUTURES_1minute.parquet",
        "OPTION": "NIFTY_Options_1minute.parquet"
    }
    
    expiry_dfs = []
    
    # Normalization mapping
    column_mapping = {
        'timestamp': 'Date',
        'ltp': 'Close',
        'oi': 'OI',
        'option_type': 'Right',
        'strike': 'Strike'
    }
    
    for dtype, fname in file_map.items():
        fpath = os.path.join(source_folder, fname)
        if os.path.exists(fpath):
            try:
                df = pd.read_parquet(fpath)
                
                # Normalize column names
                df.rename(columns=column_mapping, inplace=True)
                
                df['InstrumentType'] = dtype
                
                # Standardize columns for merging
                if 'Strike' not in df.columns:
                    df['Strike'] = None
                if 'Right' not in df.columns:
                    df['Right'] = None
                
                # Ensure OI is float (sometimes its NaN/Int)
                if 'OI' in df.columns:
                    df['OI'] = df['OI'].astype(float)
                
                expiry_dfs.append(df)
            except Exception as e:
                print(f"Error reading {fname} in {expiry_name}: {e}")
    
    if expiry_dfs:
        try:
            merged_path = os.path.join(target_folder, "NIFTY_Unified_1minute.parquet")
            final_df = pd.concat(expiry_dfs, ignore_index=True)
            
            # Ensure Date is datetime
            if not pd.api.types.is_datetime64_any_dtype(final_df['Date']):
                final_df['Date'] = pd.to_datetime(final_df['Date'])
                
            final_df.to_parquet(merged_path, compression='snappy')
            return True, f"Merged {expiry_name}"
        except Exception as e:
            return False, f"Failed to merge {expiry_name}: {e}"
    return False, f"No files found in {expiry_name}"

def main(limit=None):
    source_base = r"D:\NSE Data\Options\NIFTY\parquet"
    target_base = r"D:\NSE Data\Options\NIFTY\parquet_unified"
    
    folders = sorted([f for f in glob.glob(os.path.join(source_base, "*")) if os.path.isdir(f)])
    
    if limit:
        folders = folders[:limit]
        print(f"Running on subset of {limit} folders...")

    success_count = 0
    fail_count = 0
    
    for folder in folders:
        success, msg = merge_expiry(folder, target_base)
        if success:
            success_count += 1
            print(f"[SUCCESS] {msg}")
        else:
            fail_count += 1
            print(f"[FAILED] {msg}")
            
    print(f"\nFinal Status: {success_count} succeeded, {fail_count} failed.")

if __name__ == "__main__":
    # First run with a small limit for verification
    import sys
    limit_arg = int(sys.argv[1]) if len(sys.argv) > 1 else None
    main(limit=limit_arg)
