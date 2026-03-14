import logging
import threading
from typing import Dict, List, Optional, Any, Callable
import base64
import socketio
from datetime import datetime
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
        self._sio: Optional[socketio.Client] = None
        self._is_connected = False
        self._is_ohlcv_connected = False
        self._latest_ticks: Dict[str, Any] = {}
        self._subscribers: List[Callable[[Any], None]] = []
        self._lock = threading.Lock()

    def connect(self):
        if self._is_connected:
            return

        import base64
        api_key = self._auth.get_api_key()
        token_data = self._auth.get_token_data()
        if not token_data:
            raise ValueError("Breeze session not found. Please login first.")

        from backend.config import config
        self._breeze = BreezeConnect(api_key=api_key)
        
        # Decode Base64 session token (Format: USERID:TOKEN)
        try:
            decoded = base64.b64decode(token_data.session_token).decode('ascii')
            parts = decoded.split(":")
            if len(parts) != 2:
                raise ValueError("Invalid session token format after decoding")
            u_id, s_key = parts
        except Exception as e:
            logger.error(f"Failed to decode session token: {e}")
            raise ValueError(f"Failed to decode session token: {e}")

        # Manually set credentials to bypass generate_session which consumes api_session
        self._breeze.user_id = u_id
        self._breeze.session_key = s_key
        self._breeze.secret_key = config.breeze.secret_key
        
        # Initialize internal SDK state
        try:
            logger.info("Downloading stock script list from Breeze...")
            self._breeze.get_stock_script_list()
            logger.info("Stock script list downloaded successfully")
        except Exception as e:
            logger.warning(f"Failed to download stock script list: {e}. Some symbols might not work.")

        def on_ticks(ticks):
            self._handle_tick(ticks)

        self._breeze.on_ticks = on_ticks
        self._breeze.ws_connect()
        self._is_connected = True
        logger.info("Breeze Streamer connected to TBT WebSocket")
        
        # Connect to OHLCV Stream as well
        self._connect_ohlcv(u_id, s_key)

    def _connect_ohlcv(self, user_id: str, session_token: str):
        """Connect to the high-performance Candle Data LIVE stream."""
        if self._is_ohlcv_connected:
            return
            
        try:
            self._sio = socketio.Client()
            auth = {"user": user_id, "token": session_token}
            
            # Use same headers as recommended in docs
            headers = {"User-Agent": "python-socketio[client]/socket"}
            
            @self._sio.on('connect')
            def on_connect():
                self._is_ohlcv_connected = True
                logger.info("Breeze Streamer connected to OHLCV WebSocket")

            @self._sio.on('disconnect')
            def on_disconnect():
                self._is_ohlcv_connected = False
                logger.warning("Breeze Streamer disconnected from OHLCV WebSocket")

            # Handle different intervals
            def handle_candle_tick(ticks, interval):
                self._handle_candle_tick(ticks, interval)

            @self._sio.on('1SEC')
            def on_1sec(ticks): handle_candle_tick(ticks, '1SEC')

            @self._sio.on('1MIN')
            def on_1min(ticks): handle_candle_tick(ticks, '1MIN')

            @self._sio.on('5MIN')
            def on_5min(ticks): handle_candle_tick(ticks, '5MIN')

            @self._sio.on('30MIN')
            def on_30min(ticks): handle_candle_tick(ticks, '30MIN')

            # Socket.IO connect() is blocking. Run it in a background thread
            # so we don't hang the FastAPI event loop or the main streamer thread.
            def connect_thread():
                try:
                    logger.info(f"Connecting to Breeze OHLCV stream for user {user_id}...")
                    self._sio.connect(
                        "https://breezeapi.icicidirect.com/", 
                        socketio_path='ohlcvstream', 
                        headers=headers, 
                        auth=auth, 
                        transports="websocket", 
                        wait_timeout=10 # Increased timeout for reliability
                    )
                except Exception as e:
                    logger.error(f"Socket.IO connection thread failed: {e}")

            t = threading.Thread(target=connect_thread, daemon=True)
            t.start()
            logger.info("Started background thread for OHLCV connection")
        except Exception as e:
            logger.error(f"Failed to initiate OHLCV stream: {e}")

    def disconnect(self):
        if self._breeze and self._is_connected:
            self._breeze.ws_disconnect()
            self._is_connected = False
            
        if self._sio and self._is_ohlcv_connected:
            self._sio.disconnect()
            self._is_ohlcv_connected = False
            
        logger.info("Breeze Streamers disconnected")

    def subscribe(self, stock_tokens: List[str]):
        if not self._is_connected:
            self.connect()
        
        if self._breeze:
            for token in stock_tokens:
                if (token == 'NIFTY' or token == 'BANKNIFTY' or token == 'CNXIT'):
                    # For indices, also subscribe to OHLCV stream (1MIN for chart, 1SEC for LTP)
                    # Resolve to numeric token if possible
                    token_id = self._breeze.get_stock_token("NSE", token, "")
                    if token_id:
                        self._subscribe_ohlcv([token_id], "1MIN")
                        self._subscribe_ohlcv([token_id], "1SEC")
                    
                    self._breeze.subscribe_feeds(stock_token=token, exchange_code="NSE")
                else:
                    self._breeze.subscribe_feeds(stock_token=token)
            logger.info(f"Subscribed to tokens: {stock_tokens}")

    def _subscribe_ohlcv(self, script_codes: List[str], interval: str = "1MIN"):
        """Join a specific channel in the OHLCV stream."""
        if not self._is_ohlcv_connected:
            logger.warning("Cannot subscribe to OHLCV: Socket not connected")
            return
            
        if self._sio:
            # Note: script_codes here are tokens/names, but ohlcvstream might need scrip IDs.
            # Breeze SDK usually maps them. If we pass list of strings like ["4.1!1594"], it works.
            # For now, we'll try to use the raw tokens the frontend sends or map them.
            # Nifty is often 1.1!500209 or similar.
            self._sio.emit('join', script_codes)
            logger.debug(f"Joined OHLCV channel {interval} for {script_codes}")

    def subscribe_options(self, subscriptions: List[Dict[str, Any]]):
        """Subscribe to individual option strikes with full parameters.
        
        Each subscription dict should have:
        - stock_code: e.g. 'NIFTY'
        - exchange_code: e.g. 'NFO'
        - product_type: e.g. 'options'
        - expiry_date: e.g. '2026-03-20'
        - strike_price: e.g. '22500'
        - right: e.g. 'call' or 'put'
        """
        if not self._is_connected:
            self.connect()
        
        if self._breeze:
            for sub in subscriptions:
                try:
                    # 1. Subscribe to TBT feed via SDK for LTP
                    self._breeze.subscribe_feeds(
                        stock_code=sub.get('stock_code', 'NIFTY'),
                        exchange_code=sub.get('exchange_code', 'NFO'),
                        product_type=sub.get('product_type', 'options'),
                        expiry_date=sub.get('expiry_date', ''),
                        strike_price=sub.get('strike_price', ''),
                        right=sub.get('right', ''),
                        get_exchange_quotes=True,
                        get_market_depth=False,
                    )
                    
                    # 2. Join 1SEC OHLCV stream for high-fidelity OI/Vol
                    # We need the numeric token for ohlcvstream join.
                    token = self._breeze.get_stock_token(
                        exchange_code=sub.get('exchange_code', 'NFO'),
                        stock_code=sub.get('stock_code', 'NIFTY'),
                        expiry_date=sub.get('expiry_date', ''),
                        strike_price=sub.get('strike_price', ''),
                        right=sub.get('right', '')
                    )
                    if token and self._is_ohlcv_connected:
                        # Format as Exchange.Token per Breeze docs if needed,
                        # but often just the token list works for 'join'.
                        self._subscribe_ohlcv([token], "1SEC")
                        
                except Exception as e:
                    logger.error(f"Failed to subscribe to option {sub}: {e}")
            logger.info(f"Subscribed to {len(subscriptions)} option strikes (TBT + OHLCV)")

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

    def _handle_candle_tick(self, ticks: Any, interval: str):
        """Parse comma-separated candle tick from /ohlcvstream and notify subscribers."""
        if not isinstance(ticks, str):
            return
            
        parts = ticks.split(',')
        if len(parts) < 8:
            return
            
        # Common format: Exchange, Symbol, ..., Date, Interval
        # For derivatives: NFO, NIFTY, 08-Dec-2022, 18700.0, CE, 120.5, 120.5, 120.5, 120.5, 2500, 7592550, 2022-12-02 14:10:14, 1SEC
        try:
            exchange = parts[0]
            if exchange == "NSE" or exchange == "BSE":
                # Equity format: NSE, NIFTY, O, H, L, C, V, DateTime, Interval
                # Indices might omit volume? Docs say NSE,NIFTY,18687.95,18687.95,18687.95,18687.95,0,2022-12-02 14:13:53,1SEC
                symbol = parts[1]
                ohlc = parts[2:6]
                vol = parts[6]
                dt_str = parts[7]
                
                tick = {
                    "symbol": symbol,
                    "open": float(ohlc[0]),
                    "high": float(ohlc[1]),
                    "low": float(ohlc[2]),
                    "last": float(ohlc[3]),
                    "volume": float(vol),
                    "datetime": dt_str,
                    "interval": interval,
                    "type": "ohlcv"
                }
            elif exchange == "NFO":
                # Derivative format: NFO, NIFTY, Expiry, Strike, Right, O, H, L, C, Vol, OI, DateTime, Interval
                symbol = parts[1]
                expiry = parts[2]
                strike = parts[3]
                right = parts[4]
                ohlc = parts[5:9]
                vol = parts[9]
                oi = parts[10]
                dt_str = parts[11]
                
                tick = {
                    "symbol": symbol,
                    "expiry_date": expiry,
                    "strike_price": strike,
                    "right": right,
                    "open": float(ohlc[0]),
                    "high": float(ohlc[1]),
                    "low": float(ohlc[2]),
                    "last": float(ohlc[3]),
                    "volume": float(vol),
                    "open_interest": float(oi),
                    "datetime": dt_str,
                    "interval": interval,
                    "type": "ohlcv"
                }
            else:
                return

            self._handle_tick(tick)
        except Exception as e:
            logger.error(f"Error parsing candle tick: {e} | Data: {ticks}")

    def _handle_tick(self, tick: Any):
        # Build a composite key for options: "STRIKE_RIGHT" (e.g. "22500_CE")
        symbol = tick.get("symbol") or tick.get("stock_token") or tick.get("stock_code")
        strike = tick.get("strike_price")
        right = tick.get("right")
        
        if strike and right:
            # Option tick — use composite key
            right_label = "CE" if right.lower() in ("call", "ce") else "PE"
            # Normalize strike to float string format "22500.0" if needed, 
            # but usually it's best to match what OptionChain.tsx uses.
            # Frontend uses parseFloat(strike) usually.
            key = f"{float(strike)}_{right_label}"
            tick["_key"] = key
            tick["_strike"] = float(strike)
            tick["_right"] = right_label
        elif symbol:
            key = symbol
            tick["_key"] = key
        else:
            key = None
        
        if key:
            with self._lock:
                self._latest_ticks[key] = tick
        
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
