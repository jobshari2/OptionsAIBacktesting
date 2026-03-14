# ICICI Breeze API -- Live NIFTY Option Chain Retrieval Guide

This guide explains **how to retrieve live NIFTY option chain data using
ICICI Breeze API**.\
It assumes you **already implemented authentication and session
creation**.

This document focuses only on:

-   Getting **NIFTY option chain data**
-   Understanding the required parameters
-   Example **Python implementation**
-   Efficient polling strategy for near‑live updates

------------------------------------------------------------------------

# 1. Overview

Breeze API provides an endpoint:

**get_option_chain()**

This API returns the **entire option chain for a given expiry**
including:

-   Strike price
-   Call LTP
-   Put LTP
-   Open Interest
-   Volume
-   Bid / Ask prices

This is the primary API used to retrieve **live option chain
snapshots**.

Note:

Breeze does **not provide a full option chain websocket stream**.\
To obtain real-time updates you must:

1.  Poll the option chain API at intervals
2.  Optionally subscribe to **tick feeds for selected strikes**

------------------------------------------------------------------------

# 2. Required Parameters

  Parameter       Description
  --------------- ---------------------------------
  stock_code      Underlying symbol (e.g., NIFTY)
  exchange_code   Exchange (NFO for options)
  product_type    options
  expiry_date     Expiry date of options

Example:

    stock_code="NIFTY"
    exchange_code="NFO"
    product_type="options"
    expiry_date="2026-03-26"

------------------------------------------------------------------------

# 3. Python Implementation

Install Breeze SDK:

``` bash
pip install breeze-connect
```

------------------------------------------------------------------------

# 4. Initialize Breeze Client

Example:

``` python
from breeze_connect import BreezeConnect

breeze = BreezeConnect(api_key="YOUR_API_KEY")

breeze.generate_session(
    api_secret="YOUR_SECRET",
    session_token="SESSION_TOKEN"
)
```

Since login is already implemented, this step may already exist in your
system.

------------------------------------------------------------------------

# 5. Retrieve Option Chain

Use:

    get_option_chain()

Example:

``` python
option_chain = breeze.get_option_chain(
    stock_code="NIFTY",
    exchange_code="NFO",
    product_type="options",
    expiry_date="2026-03-26"
)

print(option_chain)
```

------------------------------------------------------------------------

# 6. Example Response Structure

Typical response:

``` json
{
  "Status": 200,
  "Success": [
    {
      "strike_price": 22000,
      "call_ltp": 145.5,
      "put_ltp": 120.2,
      "call_oi": 120000,
      "put_oi": 95000,
      "call_volume": 25000,
      "put_volume": 20000
    }
  ]
}
```

Fields include:

  Field          Description
  -------------- -------------------------------
  strike_price   Option strike
  call_ltp       Call option last traded price
  put_ltp        Put option last traded price
  call_oi        Call open interest
  put_oi         Put open interest
  call_volume    Call traded volume
  put_volume     Put traded volume

------------------------------------------------------------------------

# 7. Polling Strategy for Near‑Live Data

Since the option chain endpoint is snapshot based, use periodic polling.

Recommended interval:

    2–5 seconds

Example:

``` python
import time

while True:

    chain = breeze.get_option_chain(
        stock_code="NIFTY",
        exchange_code="NFO",
        product_type="options",
        expiry_date="2026-03-26"
    )

    process(chain)

    time.sleep(3)
```

------------------------------------------------------------------------

# 8. Filtering ATM Strikes

Usually you only need strikes around ATM.

Example:

``` python
def filter_near_atm(chain, spot_price):

    strikes = []

    for item in chain["Success"]:
        if abs(item["strike_price"] - spot_price) <= 500:
            strikes.append(item)

    return strikes
```

------------------------------------------------------------------------

# 9. Optimized Workflow

Recommended pipeline:

    Get NIFTY Spot Price
            |
    Retrieve Option Chain
            |
    Filter ATM Strikes
            |
    Track OI / Volume Changes
            |
    Store in Redis / Database

------------------------------------------------------------------------

# 10. Production Tips

1.  Cache option chain results.
2.  Only track **20--30 strikes around ATM**.
3.  Avoid polling faster than **2 seconds** to respect API limits.
4.  Store chain snapshots for analytics.

------------------------------------------------------------------------

# 11. Common Errors

  Error                 Cause
  --------------------- ------------------------
  Invalid expiry        Wrong expiry format
  Rate limit exceeded   Polling too frequently
  Empty chain           Market closed

------------------------------------------------------------------------

# 12. Example Expiry Format

Example weekly expiry:

    2026-03-26

Always use **YYYY-MM-DD**.

------------------------------------------------------------------------

# 13. Summary

To retrieve live NIFTY option chain data:

1.  Authenticate with Breeze API
2.  Call **get_option_chain()**
3.  Provide:
    -   stock_code = NIFTY
    -   exchange_code = NFO
    -   product_type = options
    -   expiry_date
4.  Poll every **2--5 seconds** for near‑live updates

This method provides the full option chain required for trading
analytics or monitoring systems.
