# Crypto Quantitative Analysis Project
# Libraries: NumPy, Pandas, Matplotlib, Seaborn

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

HISTORICAL_FILE = "crypto_historical_365days.csv"
MONTHLY_FILE = "crypto_monthly_summary.csv"
YEARLY_FILE = "crypto_yearly_performance.csv"

hist = pd.read_csv(HISTORICAL_FILE, parse_dates=["date"])
monthly = pd.read_csv(MONTHLY_FILE)
yearly = pd.read_csv(YEARLY_FILE)

hist = hist.sort_values(["coin_id", "date"]).copy()
hist["ret"] = hist["daily_return"] / 100
hist["asset"] = hist["coin_name"] + " (" + hist["symbol"] + ")"

def max_drawdown(price_series):
    price_series = price_series.dropna()
    running_max = price_series.cummax()
    drawdown = price_series / running_max - 1
    return drawdown.min()

rows = []
for coin_id, g in hist.groupby("coin_id"):
    g = g.sort_values("date")
    returns = g["ret"].dropna()
    prices = g["price"].dropna()
    if len(returns) < 30:
        continue

    total_return = prices.iloc[-1] / prices.iloc[0] - 1
    ann_return = (1 + total_return) ** (365 / len(returns)) - 1
    ann_vol = returns.std() * np.sqrt(365)
    sharpe = ann_return / ann_vol if ann_vol > 0 else np.nan
    var_95 = np.percentile(returns, 5)
    cvar_95 = returns[returns <= var_95].mean()

    first = g.iloc[0]
    rows.append({
        "coin_id": coin_id,
        "coin_name": first["coin_name"],
        "symbol": first["symbol"],
        "market_cap_rank": first["market_cap_rank"],
        "total_return_%": total_return * 100,
        "annualized_return_%": ann_return * 100,
        "annualized_volatility_%": ann_vol * 100,
        "sharpe_ratio": sharpe,
        "max_drawdown_%": max_drawdown(prices) * 100,
        "VaR_95_daily_%": var_95 * 100,
        "CVaR_95_daily_%": cvar_95 * 100,
        "win_rate_%": (returns > 0).mean() * 100
    })

metrics = pd.DataFrame(rows)
print("\nTop 10 by Total Return")
print(metrics.sort_values("total_return_%", ascending=False).head(10))

print("\nTop 10 by Sharpe Ratio")
print(metrics.sort_values("sharpe_ratio", ascending=False).head(10))

# 1) Top 10 return chart
top10 = metrics.sort_values("total_return_%", ascending=False).head(10)
plt.figure(figsize=(11, 6))
sns.barplot(data=top10, x="symbol", y="total_return_%")
plt.title("Top 10 Crypto Assets by Total Return")
plt.xlabel("Symbol")
plt.ylabel("Total Return (%)")
plt.xticks(rotation=45)
plt.tight_layout()
plt.show()

# 2) Risk-return scatter
plt.figure(figsize=(11, 7))
sns.scatterplot(
    data=metrics,
    x="annualized_volatility_%",
    y="annualized_return_%",
    size="market_cap_rank",
    sizes=(20, 200),
    legend=False
)
plt.axhline(0, color="black", linewidth=1)
plt.title("Crypto Risk vs Return")
plt.xlabel("Annualized Volatility (%)")
plt.ylabel("Annualized Return (%)")
plt.tight_layout()
plt.show()

# 3) BTC moving average trend
btc = hist[hist["coin_id"] == "bitcoin"].sort_values("date")
plt.figure(figsize=(12, 6))
plt.plot(btc["date"], btc["price"], label="BTC Price")
plt.plot(btc["date"], btc["price_ma7"], label="7-Day MA")
plt.plot(btc["date"], btc["price_ma30"], label="30-Day MA")
plt.title("Bitcoin Price Trend with Moving Averages")
plt.xlabel("Date")
plt.ylabel("Price")
plt.legend()
plt.xticks(rotation=45)
plt.tight_layout()
plt.show()

# 4) Correlation heatmap for top 10 market cap coins
top_assets = (
    hist[hist["market_cap_rank"] <= 10]
    .drop_duplicates("coin_id")
    .sort_values("market_cap_rank")["coin_id"]
)
ret_pivot = hist[hist["coin_id"].isin(top_assets)].pivot_table(
    index="date",
    columns="symbol",
    values="ret",
    aggfunc="mean"
)
corr = ret_pivot.corr()

plt.figure(figsize=(10, 8))
sns.heatmap(corr, annot=True, cmap="coolwarm", center=0, fmt=".2f")
plt.title("Daily Return Correlation Heatmap")
plt.tight_layout()
plt.show()

# 5) Monthly performance
plt.figure(figsize=(11, 5))
sns.barplot(data=monthly, x="month", y="avg_daily_return")
plt.axhline(0, color="black", linewidth=1)
plt.title("Monthly Average Daily Return")
plt.xlabel("Month")
plt.ylabel("Average Daily Return (%)")
plt.xticks(rotation=45)
plt.tight_layout()
plt.show()