import asyncio
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pathlib import Path

from backend.config import config
from .models import BreezeSessionRequest, BreezeManualTokenRequest, BreezeHistoricalRequest, BreezeLiveSubscription
from .breeze_auth import BreezeAuth
from .breeze_historical import BreezeHistoricalClient
from .token_store import BreezeTokenStore
from .breeze_streamer import BreezeStreamer

router = APIRouter(prefix="/api/breeze", tags=["Breeze"])
logger = logging.getLogger(__name__)

# Dependencies & Shared Instances
def get_token_store() -> BreezeTokenStore:
    # Use config for path
    store_path = Path(config.breeze.token_path)
    if not store_path.is_absolute():
        from backend.config import get_project_root
        store_path = get_project_root() / store_path
    return BreezeTokenStore(store_path)

def get_auth(store: BreezeTokenStore = Depends(get_token_store)) -> BreezeAuth:
    return BreezeAuth(
        app_key=config.breeze.app_key,
        secret_key=config.breeze.secret_key,
        store=store,
    )

def get_historical_client(auth: BreezeAuth = Depends(get_auth)) -> BreezeHistoricalClient:
    return BreezeHistoricalClient(auth)

# Singleton streamer instance
_streamer: Optional[BreezeStreamer] = None

def get_streamer(auth: BreezeAuth = Depends(get_auth)) -> BreezeStreamer:
    global _streamer
    if _streamer is None:
        _streamer = BreezeStreamer(auth)
    return _streamer

# Endpoints
@router.get("/login-url")
def get_login_url(auth: BreezeAuth = Depends(get_auth)):
    try:
        return {"url": auth.get_login_url()}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.post("/session")
def exchange_session(request: BreezeSessionRequest, auth: BreezeAuth = Depends(get_auth)):
    try:
        token_data = auth.exchange_api_session(request.api_session)
        # Re-initialize streamer if token changes
        global _streamer
        if _streamer:
            _streamer.disconnect()
            _streamer = None
            
        return {
            "user_id": token_data.user_id,
            "updated_at": token_data.updated_at.isoformat(),
            "authenticated": True
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.get("/status")
def get_status(auth: BreezeAuth = Depends(get_auth)):
    token_data = auth.get_status()
    if not token_data:
        return {"authenticated": False}
    return {
        "authenticated": True,
        "user_id": token_data.user_id,
        "updated_at": token_data.updated_at.isoformat(),
    }

@router.get("/historical")
def get_historical_data(
    stock_code: str = Query(...),
    exchange_code: str = Query(...),
    product_type: str = Query(...),
    interval: str = Query(...),
    from_date: str = Query(...),
    to_date: str = Query(...),
    expiry_date: Optional[str] = Query(None),
    right: Optional[str] = Query(None),
    strike_price: Optional[str] = Query(None),
    client: BreezeHistoricalClient = Depends(get_historical_client),
):
    try:
        req = BreezeHistoricalRequest(
            stock_code=stock_code,
            exchange_code=exchange_code,
            product_type=product_type,
            interval=interval,
            from_date=from_date,
            to_date=to_date,
            expiry_date=expiry_date,
            right=right,
            strike_price=strike_price,
        )
        return client.get_historical(req)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error(f"Failed to fetch Breeze data: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch Breeze data")

@router.get("/option-chain")
def get_option_chain_meta(
    stock_code: str = Query(...),
    exchange_code: str = Query(...),
    product_type: str = Query(...),
    expiry_date: str = Query(...),
    client: BreezeHistoricalClient = Depends(get_historical_client),
):
    try:
        return client.get_option_chain_quotes(
            stock_code=stock_code,
            exchange_code=exchange_code,
            product_type=product_type,
            expiry_date=expiry_date
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error(f"Failed to fetch option chain: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch option chain")

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, auth: BreezeAuth = Depends(get_auth)):
    await websocket.accept()
    streamer = get_streamer(auth)
    
    queue = asyncio.Queue()
    
    def on_tick(tick):
        asyncio.run_coroutine_threadsafe(queue.put(tick), asyncio.get_event_loop())

    streamer.add_callback(on_tick)
    
    try:
        # Initial connection
        try:
            streamer.connect()
        except Exception as e:
            await websocket.send_json({"type": "error", "message": f"Connection failed: {str(e)}"})
            return

        # Handle incoming commands from client (subscriptions)
        async def receive_commands():
            try:
                while True:
                    data = await websocket.receive_json()
                    cmd = data.get("command")
                    if cmd == "subscribe":
                        tokens = data.get("tokens", [])
                        streamer.subscribe(tokens)
                    elif cmd == "subscribe_ohlc":
                        tokens = data.get("tokens", [])
                        interval = data.get("interval", "1minute")
                        streamer.subscribe_ohlc(tokens, interval)
                    elif cmd == "unsubscribe":
                        tokens = data.get("tokens", [])
                        streamer.unsubscribe(tokens)
            except WebSocketDisconnect:
                pass
            except Exception as e:
                logger.error(f"WS command error: {e}")

        async def send_ticks():
            while True:
                tick = await queue.get()
                await websocket.send_json({"type": "tick", "data": tick})

        # Run both tasks
        await asyncio.gather(receive_commands(), send_ticks())

    except WebSocketDisconnect:
        logger.info("Breeze WS client disconnected")
    finally:
        streamer.remove_callback(on_tick)
        # We don't necessarily disconnect the streamer here as other clients might use it 
        # (though likely only one for this app)
