"""
FinBot AI Automation Dashboard
Python + NumPy + pandas + matplotlib + seaborn + Streamlit

How to run:
1. pip install streamlit pandas numpy matplotlib seaborn openpyxl
2. streamlit run finbot_python_dashboard.py

CSV/Excel expected columns:
Year, Revenue, EBITDA, NetProfit, Assets, Liabilities
Minimum required: Year, Revenue, EBITDA, NetProfit
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import streamlit as st


st.set_page_config(
    page_title="FinBot AI Automation Dashboard",
    page_icon="📊",
    layout="wide"
)

st.title("📊 FinBot AI — Python Automation Dashboard Analyst")
st.write("Upload Excel/CSV data and generate financial KPIs, charts, insights, and analyst summary.")


# -----------------------------
# Sample data
# -----------------------------
def sample_data() -> pd.DataFrame:
    return pd.DataFrame({
        "Year": [2021, 2022, 2023, 2024, 2025],
        "Revenue": [1200000, 1450000, 1680000, 2100000, 2520000],
        "EBITDA": [240000, 326000, 420000, 588000, 756000],
        "NetProfit": [120000, 178000, 240000, 345000, 478000],
        "Assets": [2500000, 2800000, 3300000, 3900000, 4700000],
        "Liabilities": [900000, 980000, 1200000, 1450000, 1600000],
    })


# -----------------------------
# Data loader
# -----------------------------
def load_data(uploaded_file) -> pd.DataFrame:
    if uploaded_file is None:
        return sample_data()

    name = uploaded_file.name.lower()

    if name.endswith(".csv"):
        df = pd.read_csv(uploaded_file)
    elif name.endswith((".xlsx", ".xls")):
        df = pd.read_excel(uploaded_file)
    else:
        st.error("Please upload CSV or Excel file.")
        return sample_data()

    return df


# -----------------------------
# Cleaning function
# -----------------------------
def clean_financial_data(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    rename_map = {
        "year": "Year",
        "date": "Year",
        "sales": "Revenue",
        "revenue": "Revenue",
        "ebitda": "EBITDA",
        "profit": "NetProfit",
        "net profit": "NetProfit",
        "netprofit": "NetProfit",
        "assets": "Assets",
        "liabilities": "Liabilities",
    }

    df.columns = [str(col).strip() for col in df.columns]
    df = df.rename(columns={col: rename_map.get(col.lower(), col) for col in df.columns})

    required_cols = ["Year", "Revenue", "EBITDA", "NetProfit"]

    for col in required_cols:
        if col not in df.columns:
            st.warning(f"Missing column: {col}. Creating default value 0.")
            df[col] = 0

    numeric_cols = ["Revenue", "EBITDA", "NetProfit", "Assets", "Liabilities"]

    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    df = df.dropna(how="all")
    df = df.sort_values("Year").reset_index(drop=True)

    return df


# -----------------------------
# KPI calculation
# -----------------------------
def calculate_kpis(df: pd.DataFrame) -> dict:
    total_revenue = df["Revenue"].sum()
    total_ebitda = df["EBITDA"].sum()
    total_profit = df["NetProfit"].sum()

    first_revenue = df["Revenue"].iloc[0] if len(df) > 0 else 0
    last_revenue = df["Revenue"].iloc[-1] if len(df) > 0 else 0

    revenue_growth = ((last_revenue - first_revenue) / first_revenue * 100) if first_revenue else 0
    ebitda_margin = (total_ebitda / total_revenue * 100) if total_revenue else 0
    net_profit_margin = (total_profit / total_revenue * 100) if total_revenue else 0

    periods = max(len(df) - 1, 1)
    cagr = ((last_revenue / first_revenue) ** (1 / periods) - 1) * 100 if first_revenue else 0

    return {
        "Total Revenue": total_revenue,
        "Total EBITDA": total_ebitda,
        "Total Net Profit": total_profit,
        "Revenue Growth %": revenue_growth,
        "EBITDA Margin %": ebitda_margin,
        "Net Profit Margin %": net_profit_margin,
        "Revenue CAGR %": cagr,
    }


# -----------------------------
# Analyst insight generator
# -----------------------------
def generate_insights(kpis: dict) -> str:
    growth = kpis["Revenue Growth %"]
    margin = kpis["EBITDA Margin %"]
    profit_margin = kpis["Net Profit Margin %"]

    if growth > 50 and margin > 25:
        rating = "Strong Buy / High Growth"
    elif growth > 20 and margin > 15:
        rating = "Positive / Good Business"
    elif growth > 0:
        rating = "Neutral / Watchlist"
    else:
        rating = "Risky / Declining"

    return f"""
FinBot AI Analyst Summary

Business Rating: {rating}

Key Findings:
1. Revenue Growth: {growth:.2f}%
2. EBITDA Margin: {margin:.2f}%
3. Net Profit Margin: {profit_margin:.2f}%
4. Revenue CAGR: {kpis['Revenue CAGR %']:.2f}%

Analyst View:
- Revenue growth shows {'strong momentum' if growth > 30 else 'moderate performance'}.
- EBITDA margin is {'healthy' if margin > 20 else 'weak and needs cost control'}.
- Profitability is {'strong' if profit_margin > 10 else 'low and needs improvement'}.

Investment Banking Use Case:
This dashboard can support DCF modelling, comparable company analysis,
financial statement review, valuation pitch decks, and analyst reports.
"""


# -----------------------------
# Sidebar upload
# -----------------------------
st.sidebar.header("Upload Financial Data")
uploaded_file = st.sidebar.file_uploader("Upload CSV or Excel", type=["csv", "xlsx", "xls"])

df_raw = load_data(uploaded_file)
df = clean_financial_data(df_raw)
kpis = calculate_kpis(df)


# -----------------------------
# KPI Cards
# -----------------------------
col1, col2, col3, col4 = st.columns(4)

col1.metric("Total Revenue", f"₹{kpis['Total Revenue']:,.0f}")
col2.metric("Revenue Growth", f"{kpis['Revenue Growth %']:.2f}%")
col3.metric("EBITDA Margin", f"{kpis['EBITDA Margin %']:.2f}%")
col4.metric("Net Profit Margin", f"{kpis['Net Profit Margin %']:.2f}%")


# -----------------------------
# Data preview
# -----------------------------
st.subheader("Financial Data Preview")
st.dataframe(df, use_container_width=True)


# -----------------------------
# Charts
# -----------------------------
st.subheader("Financial Charts")

chart_col1, chart_col2 = st.columns(2)

with chart_col1:
    st.write("Revenue, EBITDA and Net Profit Trend")
    fig, ax = plt.subplots(figsize=(8, 5))
    ax.plot(df["Year"], df["Revenue"], marker="o", label="Revenue")
    ax.plot(df["Year"], df["EBITDA"], marker="o", label="EBITDA")
    ax.plot(df["Year"], df["NetProfit"], marker="o", label="Net Profit")
    ax.set_xlabel("Year")
    ax.set_ylabel("Amount")
    ax.legend()
    ax.grid(True)
    st.pyplot(fig)

with chart_col2:
    st.write("Revenue Bar Chart")
    fig, ax = plt.subplots(figsize=(8, 5))
    ax.bar(df["Year"].astype(str), df["Revenue"])
    ax.set_xlabel("Year")
    ax.set_ylabel("Revenue")
    ax.grid(axis="y")
    st.pyplot(fig)


# -----------------------------
# Seaborn charts
# -----------------------------
chart_col3, chart_col4 = st.columns(2)

with chart_col3:
    st.write("EBITDA Margin by Year")
    df["EBITDA_Margin"] = np.where(df["Revenue"] != 0, df["EBITDA"] / df["Revenue"] * 100, 0)
    fig, ax = plt.subplots(figsize=(8, 5))
    sns.lineplot(data=df, x="Year", y="EBITDA_Margin", marker="o", ax=ax)
    ax.set_ylabel("EBITDA Margin %")
    ax.grid(True)
    st.pyplot(fig)

with chart_col4:
    st.write("Correlation Heatmap")
    numeric_df = df.select_dtypes(include=[np.number])
    fig, ax = plt.subplots(figsize=(8, 5))
    sns.heatmap(numeric_df.corr(), annot=True, cmap="Blues", ax=ax)
    st.pyplot(fig)


# -----------------------------
# Analyst summary
# -----------------------------
st.subheader("FinBot AI Analyst Summary")
summary = generate_insights(kpis)
st.text_area("Generated Summary", value=summary, height=320)


# -----------------------------
# Export buttons
# -----------------------------
st.subheader("Export Automation")

clean_csv = df.to_csv(index=False).encode("utf-8")
st.download_button(
    label="Download Clean CSV",
    data=clean_csv,
    file_name="finbot_clean_financial_data.csv",
    mime="text/csv"
)

report_text = summary.encode("utf-8")
st.download_button(
    label="Download Analyst Report TXT",
    data=report_text,
    file_name="finbot_analyst_report.txt",
    mime="text/plain"
)


# -----------------------------
# FinBot prompt box
# -----------------------------
st.subheader("FinBot Chat Prompt")
user_prompt = st.text_input("Ask FinBot", "Create investment banking analyst view")

if st.button("Run FinBot Automation"):
    st.success("Automation completed: Excel analysis, KPI dashboard, charts, summary and export files are ready.")
    st.write(generate_insights(kpis))
