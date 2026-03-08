
import sys
import os
from datetime import datetime
from pathlib import Path

# Add project root to sys.path
sys.path.append(os.getcwd())

from backend.intelligence.meta_controller import MetaController
from backend.data_engine import ExpiryDiscovery
from backend.logger import logger

def verify():
    mc = MetaController()
    
    # Discovery expiries
    discovery = ExpiryDiscovery()
    all_expiries = discovery.discover_all()
    
    # Filter to a specific range or set of expiries for testing
    # Let's pick 02JAN2025
    test_expiry_folder = "02JAN2025"
    test_expiry_date = "02/01/2025"
    
    logger.info(f"Running verification for expiry: {test_expiry_folder}")
    
    # Run backtest for this single expiry
    result = mc.run_adaptive_backtest(
        selected_expiries=[test_expiry_folder],
        enable_adjustments=True
    )
    
    print(f"\nBacktest Result for {test_expiry_folder}:")
    print(f"Total Trades: {len(result.trades)}")
    print(f"Total PnL: {result.total_pnl:.2f}")
    
    for i, trade in enumerate(result.trades):
        print(f"\nTrade {i+1}:")
        print(f"  Entry: {trade.entry_time}")
        print(f"  Exit:  {trade.exit_time}")
        print(f"  PnL:   {trade.pnl:.2f}")
        print(f"  Exit Reason: {trade.exit_reason}")
        print(f"  Number of Legs: {len(trade.legs)}")
        
        # Check if trade spanned multiple days
        entry_dt = datetime.fromisoformat(trade.entry_time) if "T" in trade.entry_time else datetime.strptime(trade.entry_time, "%Y-%m-%d %H:%M:%S")
        exit_dt = datetime.fromisoformat(trade.exit_time) if "T" in trade.exit_time else datetime.strptime(trade.exit_time, "%Y-%m-%d %H:%M:%S")
        
        days_held = (exit_dt.date() - entry_dt.date()).days
        print(f"  Days Held: {days_held}")
        
        # Check if entry was within 7 days of expiry
        expiry_dt = datetime.strptime(test_expiry_date, "%d/%m/%Y")
        dte_at_entry = (expiry_dt.date() - entry_dt.date()).days
        print(f"  DTE at Entry: {dte_at_entry}")
        
        if dte_at_entry > 7:
            print("  WARNING: Trade entered with DTE > 7")
        if days_held > 0 :
            print("  SUCCESS: Trade held over multiple days")
            
        for j, leg in enumerate(trade.legs):
            print(f"    Leg {j+1}: {leg['direction']} {leg['strike']} {leg['right']} (Entry: {leg.get('entry_time', 'N/A')}, Exit: {leg.get('exit_time', 'N/A')})")

if __name__ == "__main__":
    verify()
