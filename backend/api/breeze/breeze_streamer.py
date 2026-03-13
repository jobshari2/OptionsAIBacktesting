import logging
import threading
from typing import Dict, List, Optional, Any, Callable
from breeze_connect import BreezeConnect
from .breeze_auth import BreezeAuth

logger = logging.getLogger(__name__)

class BreezeStreamer:
    """
    Manages Breeze WebSocket connection and streams ticks.
    """
    def __init__(self, auth: BreezeAuth):
        self._auth = auth
        self._breeze: Optional[BreezeConnect] = None
        self._is_connected = False
        self._latest_ticks: Dict[str, Any] = {}
        self._subscribers: List[Callable[[Any], None]] = []
        self._lock = threading.Lock()

    def connect(self):
        if self._is_connected:
            return

        api_key = self._auth.get_api_key()
        session_token = self._auth.get_session_token()
        
        self._breeze = BreezeConnect(api_key=api_key)
        # Assuming secret is in config but not explicitly needed for ws_connect if session is already active?
        # Actually generate_session is needed to set the internal session token
        # This might be tricky if we don't have the secret key here or if session is already active elsewhere.
        # But looking at SDK docs, breeze.generate_session(api_secret=api_secret, session_token=session_token) is required.
        
        # We need the secret key from config.
        from backend.config import config
        self._breeze.generate_session(api_secret=config.breeze.secret_key, session_token=session_token)

        def on_ticks(ticks):
            self._handle_tick(ticks)

        self._breeze.on_ticks = on_ticks
        self._breeze.ws_connect()
        self._is_connected = True
        logger.info("Breeze Streamer connected to WebSocket")

    def disconnect(self):
        if self._breeze and self._is_connected:
            self._breeze.ws_disconnect()
            self._is_connected = False
            logger.info("Breeze Streamer disconnected")

    def subscribe(self, stock_tokens: List[str]):
        if not self._is_connected:
            self.connect()
        
        if self._breeze:
            for token in stock_tokens:
                if (token == 'NIFTY' or token == 'BANKNIFTY' or token == 'CNXIT'):
                    self._breeze.subscribe_feeds(stock_token=token, exchange_code="NSE")
                else:
                    self._breeze.subscribe_feeds(stock_token=token)
            logger.info(f"Subscribed to tokens: {stock_tokens}")

    def subscribe_ohlc(self, stock_tokens: List[str], interval: str = "1minute"):
        if not self._is_connected:
            self.connect()
        
        if self._breeze:
            for token in stock_tokens:
                # Handle indices vs others if needed, but subscribe_ohlc is usually same
                self._breeze.subscribe_ohlc_averages(stock_code=token, exchange_code="NSE", interval=interval)
            logger.info(f"Subscribed to OHLC for tokens: {stock_tokens}")

    def unsubscribe(self, stock_tokens: List[str]):
        if self._breeze and self._is_connected:
            self._breeze.unsubscribe_feeds(stock_token=stock_tokens)
            logger.info(f"Unsubscribed from tokens: {stock_tokens}")

    def add_callback(self, callback: Callable[[Any], None]):
        self._subscribers.append(callback)

    def remove_callback(self, callback: Callable[[Any], None]):
        if callback in self._subscribers:
            self._subscribers.remove(callback)

    def _handle_tick(self, tick: Any):
        symbol = tick.get("symbol") or tick.get("stock_token")
        if symbol:
            with self._lock:
                self._latest_ticks[symbol] = tick
        
        # Notify subscribers
        for callback in self._subscribers:
            try:
                callback(tick)
            except Exception as e:
                logger.error(f"Error in tick callback: {e}")

    def get_latest_tick(self, symbol: str) -> Optional[Any]:
        with self._lock:
            return self._latest_ticks.get(symbol)

    def get_all_latest(self) -> Dict[str, Any]:
        with self._lock:
            return dict(self._latest_ticks)
