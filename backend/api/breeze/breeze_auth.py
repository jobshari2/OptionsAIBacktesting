from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from urllib.parse import quote
import requests

from .models import BreezeTokenData
from .token_store import BreezeTokenStore


class BreezeAuth:
    def __init__(self, app_key: str | None, secret_key: str | None, store: BreezeTokenStore):
        self._app_key = app_key
        self._secret_key = secret_key
        self._store = store

    def _require_app_key(self) -> str:
        if not self._app_key:
            raise ValueError("BREEZE_APP_KEY is missing. Add your Breeze AppKey to config.")
        return self._app_key

    def get_login_url(self) -> str:
        app_key = self._require_app_key()
        return f"https://api.icicidirect.com/apiuser/login?api_key={quote(app_key)}"

    def exchange_api_session(self, api_session: str) -> BreezeTokenData:
        app_key = self._require_app_key()
        url = "https://api.icicidirect.com/breezeapi/api/v1/customerdetails"
        payload = {
            "SessionToken": api_session,
            "AppKey": app_key,
        }
        headers = {"Content-Type": "application/json"}
        response = requests.request("GET", url, json=payload, headers=headers, timeout=30)
        if response.status_code != 200:
            raise ValueError(f"CustomerDetails failed: {response.status_code} {response.text}")
        data = response.json()
        if data.get("Status") != 200:
            raise ValueError(f"CustomerDetails error: {data.get('Error')}")
        success = data.get("Success") or {}
        session_token = success.get("session_token")
        if not session_token:
            raise ValueError("Session token not found in CustomerDetails response")

        token_data = BreezeTokenData(
            session_token=session_token,
            api_session=api_session,
            user_id=success.get("idirect_userid"),
            updated_at=datetime.utcnow(),
        )
        self._store.save(token_data)
        return token_data

    def set_session_token(self, session_token: str, api_session: str | None = None, user_id: str | None = None) -> BreezeTokenData:
        token_data = BreezeTokenData(
            session_token=session_token,
            api_session=api_session,
            user_id=user_id,
            updated_at=datetime.utcnow(),
        )
        self._store.save(token_data)
        return token_data

    def get_session_token(self) -> str:
        token_data = self._store.load()
        if not token_data:
            raise ValueError("Session token not set. Complete Breeze login first.")
        return token_data.session_token

    def get_api_key(self) -> str:
        return self._require_app_key()

    def get_status(self) -> BreezeTokenData | None:
        return self._store.load()

    def get_token_data(self) -> BreezeTokenData | None:
        return self._store.load()
