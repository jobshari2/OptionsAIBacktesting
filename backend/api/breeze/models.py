from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


class BreezeTokenData(BaseModel):
    session_token: str
    api_session: Optional[str] = None
    user_id: Optional[str] = None
    updated_at: datetime


class BreezeSessionRequest(BaseModel):
    api_session: str = Field(..., min_length=3, description="API_Session from Breeze login")


class BreezeManualTokenRequest(BaseModel):
    session_token: str = Field(..., min_length=10, description="Session token from CustomerDetails")
    api_session: Optional[str] = None
    user_id: Optional[str] = None


class BreezeHistoricalRequest(BaseModel):
    stock_code: str
    exchange_code: str
    product_type: str
    interval: str
    from_date: str
    to_date: str
    expiry_date: Optional[str] = None
    right: Optional[str] = None
    strike_price: Optional[str] = None


class BreezeLiveSubscription(BaseModel):
    stock_token: Optional[str] = None
    exchange_code: Optional[str] = None
    stock_code: Optional[str] = None
    product_type: Optional[str] = None
    expiry_date: Optional[str] = None
    strike_price: Optional[str] = None
    right: Optional[str] = None
    interval: Optional[str] = None
