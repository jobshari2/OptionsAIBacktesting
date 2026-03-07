"""
Data API routes — expiry listing, option chain, index/futures data.
"""
from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from backend.data_engine import DataLoader, ExpiryDiscovery, DataJoiner
from backend.analytics.greeks import GreeksCalculator

router = APIRouter(prefix="/api/data", tags=["Data"])

# Shared instances
data_loader = DataLoader()
expiry_discovery = ExpiryDiscovery()


@router.get("/expiries")
async def list_expiries(
    start_date: Optional[str] = Query(None, description="Start date YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="End date YYYY-MM-DD"),
):
    """List all available expiry dates."""
    try:
        if start_date or end_date:
            expiries = expiry_discovery.filter_by_date_range(start_date, end_date)
        else:
            expiries = expiry_discovery.discover_all()

        return {
            "total": len(expiries),
            "expiries": [
                {"folder": e["folder_name"], "date": e["date_str"]}
                for e in expiries
            ],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/option-chain")
async def get_option_chain(
    expiry: str = Query(..., description="Expiry folder name"),
    timestamp: Optional[str] = Query(None, description="Specific timestamp"),
    strike_min: Optional[int] = Query(None),
    strike_max: Optional[int] = Query(None),
):
    """Get historical option chain data for an expiry."""
    try:
        df = data_loader.load_options(expiry)

        if df.schema.get("Date") == __import__("polars").Utf8:
            df = df.with_columns(
                __import__("polars").col("Date").str.to_datetime().alias("Date")
            )

        # If specific timestamp, filter to that
        if timestamp:
            import polars as pl
            target = pl.Series([timestamp]).str.to_datetime()[0]
            df = df.filter(pl.col("Date") == target)

        # Strike range filter
        import polars as pl
        if strike_min:
            df = df.filter(pl.col("Strike") >= strike_min)
        if strike_max:
            df = df.filter(pl.col("Strike") <= strike_max)

        # Get unique timestamps for reference
        timestamps = df.select("Date").unique().sort("Date").to_series().to_list()

        # If no specific timestamp, get the first one
        if not timestamp and len(timestamps) > 0:
            df = df.filter(pl.col("Date") == timestamps[0])

        records = df.sort(["Strike", "Right"]).to_dicts()

        # Convert datetime objects to strings
        for r in records:
            if "Date" in r and hasattr(r["Date"], "isoformat"):
                r["Date"] = r["Date"].isoformat()

        return {
            "expiry": expiry,
            "total_records": len(records),
            "available_timestamps": len(timestamps),
            "data": records,
        }
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Expiry '{expiry}' not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/index-data")
async def get_index_data(
    expiry: str = Query(..., description="Expiry folder name"),
    start_time: Optional[str] = Query(None, description="Start time HH:MM"),
    end_time: Optional[str] = Query(None, description="End time HH:MM"),
):
    """Get index (spot) data for an expiry."""
    try:
        df = data_loader.load_index(expiry, start_time=start_time, end_time=end_time)
        records = df.to_dicts()

        for r in records:
            if "Date" in r and hasattr(r["Date"], "isoformat"):
                r["Date"] = r["Date"].isoformat()

        return {
            "expiry": expiry,
            "total_records": len(records),
            "data": records,
        }
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Expiry '{expiry}' not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/futures-data")
async def get_futures_data(
    expiry: str = Query(..., description="Expiry folder name"),
    start_time: Optional[str] = Query(None),
    end_time: Optional[str] = Query(None),
):
    """Get futures data for an expiry."""
    try:
        df = data_loader.load_futures(expiry, start_time=start_time, end_time=end_time)
        records = df.to_dicts()

        for r in records:
            if "Date" in r and hasattr(r["Date"], "isoformat"):
                r["Date"] = r["Date"].isoformat()

        return {
            "expiry": expiry,
            "total_records": len(records),
            "data": records,
        }
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Expiry '{expiry}' not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/cache-info")
async def get_cache_info():
    """Get data cache status."""
    return data_loader.cache_info


@router.post("/clear-cache")
async def clear_cache():
    """Clear data cache."""
    data_loader.clear_cache()
    expiry_discovery.clear_cache()
    return {"message": "Cache cleared"}
