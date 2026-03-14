import asyncio
from backend.data_engine import DataLoader
import polars as pl

dl = DataLoader()

def test():
    df = dl.load_options("02May2024", use_unified=True)
    print("Options DF Schema:")
    print(df.schema)
    print("Options DF Head:")
    print(df.head(2).to_dicts())

    # Mock query
    queries = [{"id": "1", "timestamp": "02/05/2024 09:15:00", "strike": 22650, "right": "CE"}]
    qdf = pl.DataFrame(queries)
    
    print("\nOriginal Query DF:")
    print(qdf.to_dicts())

    try:
        qdf = qdf.with_columns(pl.col("timestamp").str.strptime(pl.Datetime, "%d/%m/%Y %H:%M:%S").alias("Date"))
    except Exception as e:
        print("Error parsing timestamp:", e)
        qdf = qdf.with_columns(pl.col("timestamp").str.to_datetime(strict=False).alias("Date"))

    qdf = qdf.rename({"strike": "Strike", "right": "Right"})
    
    print("\nParsed Query DF:")
    print(qdf.to_dicts())
    print("Query DF Schema:")
    print(qdf.schema)
    
    # ensure date in options df is datetime
    if df.schema.get("Date") == pl.Utf8:
        df = df.with_columns(pl.col("Date").str.to_datetime().alias("Date"))

    print("\nOptions DF Date Type:", df.schema.get("Date"))

    res = qdf.join(df, on=["Date", "Strike", "Right"], how="left")
    print("\nJoin Result:")
    print(res.select(["id", "Close"]).to_dicts())

if __name__ == "__main__":
    test()
