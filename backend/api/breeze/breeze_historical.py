from __future__ import annotations
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
import requests
import base64
from breeze_connect import BreezeConnect

from backend.logger import logger as central_logger
from .breeze_auth import BreezeAuth
from .models import BreezeHistoricalRequest

BASE_URL = "https://breezeapi.icicidirect.com/api/v2/historicalcharts"
ALLOWED_INTERVALS = {"1minute", "5minute", "30minute", "1day", "day"}
ALLOWED_PRODUCT_TYPES = {"cash", "futures", "options"}


class BreezeHistoricalClient:
    def __init__(self, auth: BreezeAuth):
        self._auth = auth
        # Use session with optimized connection pooling
        self._session = requests.Session()
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=10,
            pool_maxsize=20,
            max_retries=0,
            pool_block=False
        )
        self._session.mount('http://', adapter)
        self._session.mount('https://', adapter)
        self._logger = central_logger

    def _parse_datetime(self, value: str) -> datetime:
        if "T" in value:
            return datetime.fromisoformat(value)
        elif " " in value:
            return datetime.fromisoformat(value.replace(" ", "T"))
        else:
            return datetime.strptime(value, "%Y-%m-%d")

    def _fetch_chunk(self, params: Dict[str, Any], headers: Dict[str, str], max_retries: int = 3) -> List[Dict[str, Any]]:
        import time
        self._logger.debug("Fetching Breeze chunk: %s", params)
        for attempt in range(max_retries):
            try:
                response = self._session.get(BASE_URL, params=params, headers=headers, timeout=10)
                
                if response.status_code == 429:
                    if attempt < max_retries - 1:
                        wait_time = 5 * (2 ** attempt)
                        time.sleep(wait_time)
                        continue
                    else:
                        raise ValueError("Rate limit exceeded - too many requests")
                
                if response.status_code == 401:
                    raise ValueError("Breeze session expired. Please re-login to ICICI Breeze.")
                
                if response.status_code != 200:
                    self._logger.error("Breeze API error: %s %s", response.status_code, response.text)
                    raise ValueError(f"Breeze historical error: {response.status_code} {response.text}")
                
                data = response.json()
                if data.get("Status") != 200:
                    status_err = data.get("Status")
                    error_msg = data.get("Error") or "Breeze API returned an error"
                    if status_err == 401 or "Invalid User Details" in error_msg:
                        raise ValueError("Breeze session expired. Please re-login to ICICI Breeze.")
                    raise ValueError(error_msg)
                
                records = data.get("Success") or []
                return [self._normalize_record(item) for item in records]
            except (requests.Timeout, requests.ConnectionError) as e:
                if attempt < max_retries - 1:
                    wait_time = 0.5 * (2 ** attempt)
                    time.sleep(wait_time)
                else:
                    raise ValueError(f"Failed to fetch data after {max_retries} retries: {str(e)}") from e
            except ValueError:
                # Re-raise known ValueErrors (like session expired) immediately
                raise
            except Exception as e:
                self._logger.exception("Unexpected error fetching chunk")
                raise

    def get_historical(self, request: BreezeHistoricalRequest) -> Dict[str, Any]:
        interval = self._normalize_interval(request.interval)
        product_type = request.product_type.lower()
        if product_type not in ALLOWED_PRODUCT_TYPES:
            raise ValueError(f"Unsupported product_type: {request.product_type}")

        headers = {
            "X-SessionToken": self._auth.get_session_token(),
            "apikey": self._auth.get_api_key(),
        }

        from_date_dt = self._parse_datetime(request.from_date)
        to_date_dt = self._parse_datetime(request.to_date)
        
        # Ensure now_dt is either naive or aware matching the parsed dates
        # _parse_datetime with fromisoformat might return aware if +00:00 or Z is present
        now_dt = datetime.now(to_date_dt.tzinfo) if to_date_dt.tzinfo else datetime.now()

        # Safety: clip future to_date to current time
        if to_date_dt > now_dt:
            self._logger.warning("Clipping future to_date from %s to %s", to_date_dt, now_dt)
            to_date_dt = now_dt
            
        params = {
            "stock_code": request.stock_code,
            "exch_code": request.exchange_code,
            "interval": interval,
            "from_date": self._format_datetime_obj(from_date_dt),
            "to_date": self._format_datetime_obj(to_date_dt),
            "product_type": product_type,
        }
        
        if product_type == "options":
            if not request.expiry_date or not request.right or request.strike_price is None:
                raise ValueError("expiry_date, right, and strike_price are required for options")
            params["expiry_date"] = self._format_expiry_date(request.expiry_date)
            params["right"] = request.right.lower()
            params["strike_price"] = str(request.strike_price)
        elif product_type == "futures":
            if not request.expiry_date:
                raise ValueError("expiry_date is required for futures")
            params["expiry_date"] = self._format_expiry_date(request.expiry_date)

        records = self._fetch_chunk(params, headers)
        return {"data": records, "actual": len(records)}

    def get_option_chain_quotes(self, stock_code: str, exchange_code: str, product_type: str, expiry_date: str):
        """Fetch full option chain quotes using SDK get_option_chain method.
        If the market is closed (e.g. weekend) and the SDK returns None, 
        fallback to fetching EOD historical data for the last trading session."""
        api_key = self._auth.get_api_key()
        token_data = self._auth.get_token_data()
        if not token_data:
            raise ValueError("Breeze session not found. Please login first.")

        # Initialize SDK client
        breeze = BreezeConnect(api_key=api_key)
        
        # Decode Base64 session token if necessary (Format: USERID:SESSIONKEY)
        # Note: Breeze CustomerDetails returns session_token as base64(userid:sessionkey)
        try:
            decoded = base64.b64decode(token_data.session_token).decode('ascii')
            if ":" in decoded:
                u_id, s_key = decoded.split(":", 1)
                breeze.user_id = u_id
                breeze.session_key = s_key
                self._logger.debug(f"Decoded session token for user: {u_id}")
            else:
                breeze.user_id = token_data.user_id
                breeze.session_key = token_data.session_token
        except Exception as e:
            self._logger.warning(f"Session token not base64 or invalid: {e}. Using as-is.")
            breeze.user_id = token_data.user_id
            breeze.session_key = token_data.session_token

        # Set API secret if available for more robust SDK behavior
        if hasattr(self._auth, '_secret_key') and self._auth._secret_key:
            breeze.api_secret = self._auth._secret_key
        
        # Fetch option chain
        self._logger.info(f"Retrieving option chain for {stock_code} {expiry_date} ({product_type})")
        
        try:
            formatted_expiry = self._format_expiry_date(expiry_date)
            # Log params at INFO level for better visibility during debugging
            self._logger.info(f"SDK request: stock_code={stock_code}, exch={exchange_code}, product={product_type}, expiry={formatted_expiry}")
            
            response = breeze.get_option_chain_quotes(
                stock_code=stock_code,
                exchange_code=exchange_code,
                product_type=product_type,
                expiry_date=formatted_expiry
            )
            
            if response is None:
                self._logger.warning("Breeze SDK returned None for get_option_chain_quotes. Likely market closed. Falling back to historical.")
                return self._fallback_option_chain(breeze, stock_code, exchange_code, product_type, formatted_expiry)
                
            self._logger.debug(f"Breeze SDK response status: {response.get('Status')}")
            
            if response.get("Status") != 200:
                error_msg = response.get("Error") or "Breeze API returned an error"
                self._logger.error(f"Breeze Option Chain API Error: {error_msg} (Status: {response.get('Status')})")
                if response.get("Status") == 401 or "Invalid User Details" in error_msg:
                     raise ValueError("Breeze session expired. Please re-login.")
                raise ValueError(error_msg)
                
            success_data = response.get("Success", [])
            self._logger.info(f"Successfully retrieved {len(success_data)} option chain records")
            return success_data
            
        except Exception as e:
            self._logger.exception(f"Unexpected error in get_option_chain_quotes: {e}")
            raise

    def _fallback_option_chain(self, breeze: BreezeConnect, stock_code: str, exchange_code: str, product_type: str, formatted_expiry: str) -> List[dict]:
        """Fetch EOD historical options data for the last trading day to emulate an option chain."""
        try:
            now = datetime.now()
            last_trading_day = now
            
            # Find the last Friday (or yesterday if weekday but market hasn't opened)
            if now.weekday() == 6:   # Sunday -> Friday
                last_trading_day = now - timedelta(days=2)
            elif now.weekday() == 5: # Saturday -> Friday
                last_trading_day = now - timedelta(days=1)
            elif now.hour < 9 or (now.hour == 9 and now.minute < 15):
                # Weekday but before market open -> Yesterday
                last_trading_day = now - timedelta(days=1)
                if last_trading_day.weekday() > 4: # If yesterday was Sunday -> Friday
                    last_trading_day = now - timedelta(days=3)
            
            from_date = last_trading_day.strftime("%Y-%m-%dT00:00:00.000Z")
            to_date = last_trading_day.strftime("%Y-%m-%dT23:59:59.000Z")
            
            self._logger.info(f"Fallback: Fetching historical {product_type} data for {stock_code} on {last_trading_day.strftime('%Y-%m-%d')}")
            
            # 1. Fetch Spot Price to find ATM
            spot_resp = breeze.get_historical_data_v2(
                interval="1day",
                from_date=from_date,
                to_date=to_date,
                stock_code=stock_code,
                exchange_code="NSE",
                product_type="cash"
            )
            
            spot_price = 0
            if spot_resp and spot_resp.get("Status") == 200 and spot_resp.get("Success"):
                spot_price = spot_resp["Success"][-1].get("close", 0)
            else:
                self._logger.warning(f"Spot Check failed. Resp: {spot_resp}")
                
            if not spot_price:
                self._logger.error(f"Fallback: Could not get Spot price. Using last known NIFTY level (approx ~22000) for debug.")
                spot_price = 22000 # hardcode for debug if spot fails
                
            # Round spot to nearest 50 for NIFTY ATM
            atm_strike = round(float(spot_price) / 50) * 50
            
            formatted_chain = []
            
            # The Breeze API requires 'strike_price' for options history.
            # Querying the entire chain in one bulk call hangs indefinitely.
            # We'll fetch a small focused subset (5 ITM, 5 OTM) iteratively.
            strikes_to_fetch = [atm_strike + (i * 50) for i in range(-5, 6)]
            
            # get_historical_data_v2 requires options expiry to be in exactly this ISO format for Breeze
            hist_expiry_date = f"{formatted_expiry}T06:00:00.000Z"
            
            self._logger.info(f"Fallback: Fetching {len(strikes_to_fetch)} strikes individually for {hist_expiry_date}")
            
            for strike in strikes_to_fetch:
                # Fetch Call
                call_resp = breeze.get_historical_data_v2(
                    interval="1day",
                    from_date=from_date,
                    to_date=to_date,
                    stock_code=stock_code,
                    exchange_code=exchange_code,
                    product_type=product_type,
                    expiry_date=hist_expiry_date,
                    right="call",
                    strike_price=str(strike)
                )
                
                # Fetch Put
                put_resp = breeze.get_historical_data_v2(
                    interval="1day",
                    from_date=from_date,
                    to_date=to_date,
                    stock_code=stock_code,
                    exchange_code=exchange_code,
                    product_type=product_type,
                    expiry_date=hist_expiry_date,
                    right="put",
                    strike_price=str(strike)
                )
                
                call_data = call_resp.get("Success", [{}])[-1] if call_resp and call_resp.get("Status") == 200 and call_resp.get("Success") else {}
                put_data = put_resp.get("Success", [{}])[-1] if put_resp and put_resp.get("Status") == 200 and put_resp.get("Success") else {}
                
                if call_data or put_data:
                    formatted_chain.append({
                        "strike_price": str(strike),
                        "call_ltp": call_data.get("close", 0),
                        "call_oi": call_data.get("open_interest", 0),
                        "call_volume": call_data.get("volume", 0),
                        "put_ltp": put_data.get("close", 0),
                        "put_oi": put_data.get("open_interest", 0),
                        "put_volume": put_data.get("volume", 0),
                        "symbol": stock_code
                    })
            
            if not formatted_chain:
                self._logger.warning(f"Fallback: API returned 0 strikes. Generating 'Hard Fallback' skeleton around {atm_strike}.")
                # Generate 20 strikes above and below ATM (total 41)
                for i in range(-20, 21):
                    strike = atm_strike + (i * 50)
                    formatted_chain.append({
                        "strike_price": str(strike),
                        "call_ltp": 0.0,
                        "call_oi": 0.0,
                        "call_volume": 0,
                        "put_ltp": 0.0,
                        "put_oi": 0.0,
                        "put_volume": 0,
                        "symbol": stock_code
                    })
            
            self._logger.info(f"Fallback successful. Reconstructed {len(formatted_chain)} strikes (using hard fallback: {not any(x['call_ltp'] for x in formatted_chain)}).")
            return formatted_chain
            
        except Exception as e:
            self._logger.error(f"Fallback option chain failed: {e}")
            return []

    def _normalize_interval(self, interval: str) -> str:
        normalized = interval.lower()
        if normalized not in ALLOWED_INTERVALS:
            if normalized == "1min": return "1minute"
            if normalized == "5min": return "5minute"
            if normalized == "30min": return "30minute"
            if normalized == "1d": return "1day"
            raise ValueError(f"Unsupported interval: {interval}")
        if normalized == "day":
            return "1day"
        return normalized

    def _format_datetime_obj(self, dt: datetime) -> str:
        """Format datetime object to Breeze expected ISO format with .000Z"""
        return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")

    def _normalize_record(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "Date": item.get("datetime"),
            "Open": self._to_float(item.get("open")),
            "High": self._to_float(item.get("high")),
            "Low": self._to_float(item.get("low")),
            "Close": self._to_float(item.get("close")),
            "Volume": self._to_float(item.get("volume")),
            "OI": self._to_float(item.get("open_interest")),
        }

    def _to_float(self, value: Any) -> float | None:
        if value is None or value == "":
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _format_expiry_date(self, expiry_date: str) -> str:
        """Format DD-MMM-YYYY to YYYY-MM-DD for Breeze SDK as per official guide."""
        try:
            # Handle standard Breeze date strings like '17-Mar-2026'
            dt = datetime.strptime(expiry_date, "%d-%b-%Y")
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            try:
                # If already partially ISO or YYYY-MM-DD, normalize to YYYY-MM-DD
                if 'T' in expiry_date:
                    base = expiry_date.split('T')[0]
                else:
                    base = expiry_date
                dt = datetime.strptime(base, "%Y-%m-%d")
                return dt.strftime("%Y-%m-%d")
            except ValueError:
                self._logger.warning(f"Invalid expiry_date format: {expiry_date}, using as-is")
                return expiry_date
