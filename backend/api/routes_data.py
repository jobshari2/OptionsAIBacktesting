"""
Data API routes — expiry listing, option chain, index/futures data.
"""
from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from backend.data_engine import DataLoader, ExpiryDiscovery, DataJoiner
from backend.analytics.greeks import GreeksCalculator
from backend.logger import logger
from backend.config import config
from backend.analytics.oi_analyzer import OIAnalyzer
from pydantic import BaseModel

class ConfigUpdateRequest(BaseModel):
    use_unified: bool

class OptionQueryItem(BaseModel):
    id: str
    timestamp: str 
    strike: int
    right: str  # 'CE' or 'PE'

class BacktestOptionQuery(BaseModel):
    expiry: str
    queries: list[OptionQueryItem]
    use_unified: Optional[bool] = None

router = APIRouter(prefix="/api/data", tags=["Data"])

# Shared instances
data_loader = DataLoader()
expiry_discovery = ExpiryDiscovery()

@router.get("/config")
async def get_config():
    """Get active data configuration."""
    return {"use_unified": config.data.use_unified}

@router.post("/config")
async def update_config(req: ConfigUpdateRequest):
    """Update active data configuration dynamically."""
    config.data.use_unified = req.use_unified
    logger.info(f"Updated global data config: use_unified={config.data.use_unified}")
    data_loader.clear_cache()
    expiry_discovery.clear_cache()
    return {"message": "Config updated", "use_unified": config.data.use_unified}


@router.get("/expiries")
async def list_expiries(
    start_date: Optional[str] = Query(None, description="Start date DD/MM/YYYY"),
    end_date: Optional[str] = Query(None, description="End date DD/MM/YYYY"),
):
    """List all available expiry dates."""
    logger.info(f"Fetching expiries (start: {start_date}, end: {end_date})")
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
    use_unified: Optional[bool] = Query(None, description="Force use unified or individual files"),
):
    """Get historical option chain data for an expiry."""
    import time
    start_perf = time.perf_counter()
    
    logger.info(f"Fetching option chain for expiry={expiry}, timestamp={timestamp}, unified={use_unified}")
    try:
        df = data_loader.load_options(expiry, use_unified=use_unified)

        if df.schema.get("Date") == __import__("polars").Utf8:
            df = df.with_columns(
                __import__("polars").col("Date").str.to_datetime().alias("Date")
            )

        # Get unique timestamps for reference BEFORE filtering
        timestamps = df.select("Date").unique().sort("Date").to_series().to_list()

        # If specific timestamp, filter to that
        if timestamp:
            import polars as pl
            # The API assumes timestamp comes in as 'YYYY-MM-DD HH:MM:SS' or similar. 
            # We parse into datetime.
            # Using strict=False to handle potential time format variations
            try:
                target = pl.Series([timestamp]).str.to_datetime(strict=False)[0]
                df = df.filter(pl.col("Date") == target)
            except Exception as e:
                logger.warning(f"Failed to parse timestamp {timestamp}: {e}")

        # Strike range filter
        import polars as pl
        if strike_min:
            df = df.filter(pl.col("Strike") >= strike_min)
        if strike_max:
            df = df.filter(pl.col("Strike") <= strike_max)

        # If no specific timestamp, get the first one
        if not timestamp and len(timestamps) > 0:
            df = df.filter(pl.col("Date") == timestamps[0])

        records = df.sort(["Strike", "Right"]).to_dicts()

        # Convert datetime objects to strings
        for r in records:
            if "Date" in r and hasattr(r["Date"], "strftime"):
                r["Date"] = r["Date"].strftime("%d/%m/%Y %H:%M:%S")
            elif "Date" in r and hasattr(r["Date"], "isoformat"):
                r["Date"] = r["Date"].isoformat()

        str_timestamps = []
        for t in timestamps:
            if hasattr(t, "strftime"):
                str_timestamps.append(t.strftime("%d/%m/%Y %H:%M:%S"))
            elif hasattr(t, "isoformat"):
                str_timestamps.append(t.isoformat())
            else:
                str_timestamps.append(str(t))

        load_time_ms = round((time.perf_counter() - start_perf) * 1000, 2)
        
        return {
            "expiry": expiry,
            "total_records": len(records),
            "available_timestamps": len(timestamps),
            "timestamps": str_timestamps,
            "data": records,
            "load_time_ms": load_time_ms,
            "source_type": "unified" if use_unified or (use_unified is None and config.data.use_unified) else "individual"
        }
    except FileNotFoundError:
        logger.warning(f"Expiry '{expiry}' not found for option chain")
        raise HTTPException(status_code=404, detail=f"Expiry '{expiry}' not found")
    except Exception as e:
        logger.error(f"Error fetching option chain: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/index-data")
async def get_index_data(
    expiry: str = Query(..., description="Expiry folder name"),
    start_time: Optional[str] = Query(None, description="Start time HH:MM"),
    end_time: Optional[str] = Query(None, description="End time HH:MM"),
    use_unified: Optional[bool] = Query(None),
):
    """Get index (spot) data for an expiry."""
    import time
    start_perf = time.perf_counter()
    
    logger.info(f"Fetching index data for expiry={expiry}, start={start_time}, end={end_time}, unified={use_unified}")
    try:
        df = data_loader.load_index(expiry, start_time=start_time, end_time=end_time, use_unified=use_unified)
        records = df.to_dicts()

        for r in records:
            if "Date" in r and hasattr(r["Date"], "strftime"):
                r["Date"] = r["Date"].strftime("%d/%m/%Y %H:%M:%S")
            elif "Date" in r and hasattr(r["Date"], "isoformat"):
                r["Date"] = r["Date"].isoformat()

        load_time_ms = round((time.perf_counter() - start_perf) * 1000, 2)
        
        return {
            "expiry": expiry,
            "total_records": len(records),
            "data": records,
            "load_time_ms": load_time_ms,
            "source_type": "unified" if use_unified or (use_unified is None and config.data.use_unified) else "individual"
        }
    except FileNotFoundError:
        logger.warning(f"Expiry '{expiry}' not found for index data")
        raise HTTPException(status_code=404, detail=f"Expiry '{expiry}' not found")
    except Exception as e:
        logger.error(f"Error fetching index data: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/futures-data")
async def get_futures_data(
    expiry: str = Query(..., description="Expiry folder name"),
    start_time: Optional[str] = Query(None),
    end_time: Optional[str] = Query(None),
    use_unified: Optional[bool] = Query(None),
):
    """Get futures data for an expiry."""
    import time
    start_perf = time.perf_counter()
    
    logger.info(f"Fetching futures data for expiry={expiry}, start={start_time}, end={end_time}, unified={use_unified}")
    try:
        df = data_loader.load_futures(expiry, start_time=start_time, end_time=end_time, use_unified=use_unified)
        records = df.to_dicts()

        for r in records:
            if "Date" in r and hasattr(r["Date"], "strftime"):
                r["Date"] = r["Date"].strftime("%d/%m/%Y %H:%M:%S")
            elif "Date" in r and hasattr(r["Date"], "isoformat"):
                r["Date"] = r["Date"].isoformat()

        load_time_ms = round((time.perf_counter() - start_perf) * 1000, 2)
        
        return {
            "expiry": expiry,
            "total_records": len(records),
            "data": records,
            "load_time_ms": load_time_ms,
            "source_type": "unified" if use_unified or (use_unified is None and config.data.use_unified) else "individual"
        }
    except FileNotFoundError:
        logger.warning(f"Expiry '{expiry}' not found for futures data")
        raise HTTPException(status_code=404, detail=f"Expiry '{expiry}' not found")
    except Exception as e:
        logger.error(f"Error fetching futures data: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/oi-spikes")
async def get_oi_spikes(
    expiry: str = Query(..., description="Expiry folder name"),
    threshold: float = Query(0.5, description="OI Spike threshold (0.5 = 50%)"),
    vol_threshold: float = Query(0.5, description="Volume Spike threshold (0.5 = 50%)"),
    min_ltp: float = Query(0.0, description="Minimum LTP Filter"),
    use_unified: Optional[bool] = Query(None),
):
    """
    Detect sudden increases in OI or Volume for the entire expiry dataset.
    """
    import time
    start = time.time()
    logger.info(f"Detecting market spikes for expiry={expiry}, threshold={threshold}, vol_threshold={vol_threshold}, min_ltp={min_ltp}")
    try:
        # Load the entire options dataset
        load_start = time.time()
        df = data_loader.load_options(expiry, use_unified=use_unified)
        load_end = time.time()
        logger.info(f"Loaded {len(df)} rows in {load_end - load_start:.2f}s")
        
        if df.is_empty():
            return {"expiry": expiry, "total_spikes": 0, "spikes": [], "load_time_s": load_end - load_start}

        # Analyze spikes
        analyze_start = time.time()
        spikes = OIAnalyzer.detect_spikes(
            df, 
            oi_threshold=threshold, 
            vol_threshold=vol_threshold,
            min_ltp=min_ltp
        )
        analyze_end = time.time()
        logger.info(f"Analyzed spikes in {analyze_end - analyze_start:.2f}s, found {len(spikes)}")
        
        return {
            "expiry": expiry,
            "oi_threshold": threshold,
            "vol_threshold": vol_threshold,
            "min_ltp": min_ltp,
            "total_spikes": len(spikes),
            "spikes": spikes,
            "stats": {
                "rows_scanned": len(df),
                "load_time_s": round(load_end - load_start, 2),
                "analyze_time_s": round(analyze_end - analyze_start, 2),
                "total_time_s": round(time.time() - start, 2)
            }
        }
    except Exception as e:
        logger.error(f"Error calculating OI spikes: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/backtest-options")
async def get_backtest_options(req: BacktestOptionQuery):
    """
    High-performance endpoint to fetch exact option prices for a list of (timestamp, strike, type) queries.
    Used for frontend backtest simulations.
    """
    import time
    import polars as pl
    start = time.time()
    
    logger.info(f"Fetching option backtest data for expiry={req.expiry}, {len(req.queries)} queries")
    try:
        df = data_loader.load_options(req.expiry, use_unified=req.use_unified)
        if df.is_empty():
            return {"expiry": req.expiry, "results": {}, "time_ms": int((time.time() - start)*1000)}

        if df.schema.get("Date") == pl.Utf8:
            df = df.with_columns(pl.col("Date").str.to_datetime().alias("Date"))
            
        # 1. Parse dates robustly to a consistent string representation
        from datetime import datetime
        import dateutil.parser
        
        parsed_queries = []
        for q in req.queries:
            # Try to parse frontend formats (DD/MM/YYYY or ISO)
            dt = None
            for fmt in ["%d/%m/%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"]:
                try:
                    dt = datetime.strptime(q.timestamp, fmt)
                    break
                except ValueError:
                    pass
            if not dt:
                try:
                    dt = dateutil.parser.parse(q.timestamp)
                except:
                    dt = None
            
            ts_str = dt.strftime("%Y-%m-%d %H:%M:%S") if dt else q.timestamp
            parsed_queries.append({
                "id": q.id,
                "DateStr": ts_str,
                "Strike": q.strike,
                "Right": q.right
            })
            
        qdf = pl.DataFrame(parsed_queries)
        
        # 2. Add 'DateStr' to options df to ensure consistent string matching
        df = df.with_columns(pl.col("Date").dt.strftime("%Y-%m-%d %H:%M:%S").alias("DateStr"))
        
        # 3. Left join on matched string values and strikes
        res = qdf.join(df, on=["DateStr", "Strike", "Right"], how="left")
        
        records = res.select(["id", "Close"]).to_dicts()
        results = {r["id"]: r["Close"] for r in records if r["Close"] is not None}
        
        logger.info(f"Query DF Head: {qdf.head(2).to_dicts()}")
        logger.info(f"Options DF Head: {df.select(['Date', 'Strike', 'Right', 'Close']).head(2).to_dicts()}")
        logger.info(f"Matched {len(results)} out of {len(req.queries)}")
        
        return {
            "expiry": req.expiry,
            "total_queried": len(req.queries),
            "total_found": len(results),
            "results": results,
            "time_ms": int((time.time() - start)*1000)
        }
    except Exception as e:
        logger.error(f"Error in backtest-options bulk fetch: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/benchmark")
async def run_benchmark(count: int = Query(5)):
    """Run data loading benchmark."""
    from utils.benchmark_loader import DataBenchmark
    benchmark = DataBenchmark()
    return benchmark.run_benchmark(count)


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
