from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List
import requests

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
        self._logger = logging.getLogger(__name__)

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
                
                if response.status_code != 200:
                    raise ValueError(f"Breeze historical error: {response.status_code} {response.text}")
                
                data = response.json()
                if data.get("Status") != 200:
                    raise ValueError(data.get("Error") or "Breeze API returned an error")
                
                records = data.get("Success") or []
                return [self._normalize_record(item) for item in records]
            except (requests.Timeout, requests.ConnectionError) as e:
                if attempt < max_retries - 1:
                    wait_time = 0.5 * (2 ** attempt)
                    time.sleep(wait_time)
                else:
                    raise ValueError(f"Failed to fetch data after {max_retries} retries: {str(e)}") from e
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

        params = {
            "stock_code": request.stock_code,
            "exch_code": request.exchange_code,
            "interval": interval,
            "from_date": self._format_datetime(request.from_date),
            "to_date": self._format_datetime(request.to_date),
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
        """Fetch full option chain quotes (meta and tokens)"""
        breeze = self.auth.get_breeze()
        if not breeze:
            raise ValueError("Breeze not authenticated")
            
        res = breeze.get_option_chain_quotes(
            stock_code=stock_code,
            exchange_code=exchange_code,
            product_type=product_type,
            expiry_date=expiry_date
        )
        
        if res.get("Status") != 200:
            raise ValueError(f"Breeze API Error: {res.get('Error', 'Unknown error')}")
            
        return res.get("Success", [])

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

    def _format_datetime(self, value: str) -> str:
        if not value:
            raise ValueError("from_date and to_date are required")
        try:
            if "T" in value:
                dt = datetime.fromisoformat(value)
            elif " " in value:
                dt = datetime.fromisoformat(value.replace(" ", "T"))
            else:
                dt = datetime.strptime(value, "%Y-%m-%d")
        except ValueError as exc:
            raise ValueError(f"Invalid datetime format: {value}") from exc
        return dt.isoformat()

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
        try:
            dt = datetime.strptime(expiry_date, "%d-%b-%Y")
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            try:
                datetime.strptime(expiry_date, "%Y-%m-%d")
                return expiry_date
            except ValueError:
                raise ValueError(f"Invalid expiry_date format: {expiry_date}")
