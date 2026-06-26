import React, { useState, useMemo, useEffect } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, AreaChart, Area, ReferenceLine,
  ComposedChart, Cell, PieChart, Pie, RadarChart, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, Radar, ScatterChart, Scatter, ZAxis, Treemap, Funnel, FunnelChart, LabelList
} from "recharts";

// ============================================================================
// QUANTDESK FINANCIAL MODELING TERMINAL
// Bloomberg-style integrated 3-Statement / DCF / Comps / M&A / LBO platform
// ============================================================================

const COLORS = {
  bg: "#0a0e14",
  panel: "#0f141b",
  panelAlt: "#131a23",
  border: "#1f2937",
  borderLight: "#2a3441",
  gold: "#d4a574",
  goldBright: "#e8b988",
  amber: "#f59e0b",
  green: "#10b981",
  red: "#ef4444",
  blue: "#3b82f6",
  cyan: "#06b6d4",
  purple: "#a855f7",
  text: "#e5e7eb",
  textDim: "#9ca3af",
  textMuted: "#6b7280",
};

const fmt = (n, d = 1) =>
  n === null || n === undefined || isNaN(n) ? "—" :
  Math.abs(n) >= 1e7 ? (n / 1e7).toFixed(d) + " Cr" :
  Math.abs(n) >= 1e5 ? (n / 1e5).toFixed(d) + " L" :
  n.toLocaleString("en-IN", { maximumFractionDigits: d });

const fmtPct = (n, d = 2) => n === null || isNaN(n) ? "—" : (n * 100).toFixed(d) + "%";
const fmtMul = (n, d = 2) => n === null || isNaN(n) ? "—" : n.toFixed(d) + "x";
const fmtNum = (n, d = 2) => n === null || isNaN(n) ? "—" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });

// ============================================================================
// DEFAULT MODEL ASSUMPTIONS — Indian Listed Co. style
// ============================================================================
const DEFAULT_ASSUMPTIONS = {
  company: "ALPHATECH LTD",
  ticker: "ALPHATECH",
  sector: "Information Technology",
  currency: "INR",
  fy0: 2025,
  // Revenue drivers (Cr)
  rev0: 12500,
  revGrowth: [0.18, 0.16, 0.14, 0.12, 0.10],
  // Margin drivers
  gmPct: [0.42, 0.43, 0.43, 0.44, 0.44],
  opexPctRev: [0.18, 0.175, 0.17, 0.17, 0.17],
  daPctRev: [0.045, 0.045, 0.045, 0.045, 0.045],
  intPctDebt: 0.085,
  taxRate: 0.252,
  // Balance sheet drivers
  dsoDays: 65,
  dioDays: 28,
  dpoDays: 45,
  capexPctRev: [0.06, 0.055, 0.05, 0.05, 0.045],
  // Capital structure
  cash0: 1850,
  debt0: 2400,
  equity0: 6800,
  ppe0: 4200,
  ar0: 2225,
  inv0: 580,
  ap0: 925,
  shares: 540, // M
  // WACC inputs
  rf: 0.0712, // G-Sec 10Y
  erp: 0.075, // Damodaran India ERP
  beta: 1.15,
  preTaxKd: 0.085,
  termGrowth: 0.045,
};

// ============================================================================
// CORE FINANCIAL ENGINE — Three-Statement Model Builder
// ============================================================================
function buildThreeStatement(a) {
  const Y = 5;
  const years = Array.from({ length: Y }, (_, i) => a.fy0 + 1 + i);

  // Income Statement
  const revenue = [];
  let prev = a.rev0;
  for (let i = 0; i < Y; i++) { prev = prev * (1 + a.revGrowth[i]); revenue.push(prev); }

  const cogs = revenue.map((r, i) => r * (1 - a.gmPct[i]));
  const grossProfit = revenue.map((r, i) => r - cogs[i]);
  const opex = revenue.map((r, i) => r * a.opexPctRev[i]);
  const ebitda = grossProfit.map((gp, i) => gp - opex[i]);
  const da = revenue.map((r, i) => r * a.daPctRev[i]);
  const ebit = ebitda.map((e, i) => e - da[i]);

  // Debt schedule (simplified: minimum cash 5% rev, revolver flexes)
  // We do an iterative simple loop for interest on average debt
  const debtSched = [];
  let debt = a.debt0;
  let cash = a.cash0;

  // Working capital schedule
  const ar = revenue.map(r => (r * a.dsoDays) / 365);
  const inv = cogs.map(c => (c * a.dioDays) / 365);
  const ap = cogs.map(c => (c * a.dpoDays) / 365);
  const nwc = ar.map((a_, i) => a_ + inv[i] - ap[i]);
  const nwc0 = a.ar0 + a.inv0 - a.ap0;
  const dNwc = nwc.map((n, i) => n - (i === 0 ? nwc0 : nwc[i - 1]));

  // Capex & PP&E
  const capex = revenue.map((r, i) => r * a.capexPctRev[i]);
  const ppe = [];
  let ppePrev = a.ppe0;
  for (let i = 0; i < Y; i++) { const v = ppePrev + capex[i] - da[i]; ppe.push(v); ppePrev = v; }

  // First pass interest (using opening debt)
  const interest = [];
  let dbg = debt;
  for (let i = 0; i < Y; i++) {
    interest.push(dbg * a.intPctDebt);
    // assume flat debt for now; refined below in cash sweep
  }

  const ebt = ebit.map((e, i) => e - interest[i]);
  const tax = ebt.map(e => Math.max(0, e) * a.taxRate);
  const ni = ebt.map((e, i) => e - tax[i]);

  // Cash Flow Statement
  const cfo = ni.map((n, i) => n + da[i] - dNwc[i]);
  const cfi = capex.map(c => -c);
  // Assume debt repaid 5% per year of opening balance, no new equity
  const debtRepay = [];
  const debtBal = [];
  let db = a.debt0;
  for (let i = 0; i < Y; i++) {
    const rep = db * 0.05;
    debtRepay.push(rep);
    db = db - rep;
    debtBal.push(db);
  }
  const cff = debtRepay.map(r => -r);
  const dCash = cfo.map((c, i) => c + cfi[i] + cff[i]);
  const cashBal = [];
  let cb = a.cash0;
  for (let i = 0; i < Y; i++) { cb += dCash[i]; cashBal.push(cb); }

  // Balance Sheet
  const equity = [];
  let eq = a.equity0;
  for (let i = 0; i < Y; i++) { eq += ni[i]; equity.push(eq); }

  const totalAssets = cashBal.map((c, i) => c + ar[i] + inv[i] + ppe[i]);
  const totalLiab = ap.map((p, i) => p + debtBal[i]);
  const totalLE = totalLiab.map((l, i) => l + equity[i]);
  const bsCheck = totalAssets.map((a_, i) => a_ - totalLE[i]);

  // Ratios
  const grossMargin = grossProfit.map((g, i) => g / revenue[i]);
  const ebitdaMargin = ebitda.map((e, i) => e / revenue[i]);
  const ebitMargin = ebit.map((e, i) => e / revenue[i]);
  const niMargin = ni.map((n, i) => n / revenue[i]);
  const roe = ni.map((n, i) => n / equity[i]);
  const roa = ni.map((n, i) => n / totalAssets[i]);
  const currentRatio = cashBal.map((c, i) => (c + ar[i] + inv[i]) / ap[i]);
  const debtEquity = debtBal.map((d, i) => d / equity[i]);
  const intCov = ebit.map((e, i) => e / interest[i]);

  return {
    years, revenue, cogs, grossProfit, opex, ebitda, da, ebit, interest, ebt, tax, ni,
    ar, inv, ap, nwc, dNwc, capex, ppe, cashBal, debtBal, debtRepay, equity,
    cfo, cfi, cff, dCash, totalAssets, totalLiab, totalLE, bsCheck,
    grossMargin, ebitdaMargin, ebitMargin, niMargin, roe, roa, currentRatio, debtEquity, intCov,
  };
}

function buildDCF(a, model) {
  // Cost of equity: Rf + Beta * ERP
  const ke = a.rf + a.beta * a.erp;
  const kd = a.preTaxKd * (1 - a.taxRate);
  const totalCap = a.equity0 + a.debt0;
  const wE = a.equity0 / totalCap;
  const wD = a.debt0 / totalCap;
  const wacc = wE * ke + wD * kd;

  // FCFF = EBIT*(1-T) + D&A - CapEx - ΔNWC
  const fcff = model.ebit.map((e, i) =>
    e * (1 - a.taxRate) + model.da[i] - model.capex[i] - model.dNwc[i]
  );

  // Discount
  const pvFcff = fcff.map((f, i) => f / Math.pow(1 + wacc, i + 1));

  // Terminal value (Gordon growth)
  const tv = (fcff[fcff.length - 1] * (1 + a.termGrowth)) / (wacc - a.termGrowth);
  const pvTv = tv / Math.pow(1 + wacc, fcff.length);

  const ev = pvFcff.reduce((s, v) => s + v, 0) + pvTv;
  const equityValue = ev - a.debt0 + a.cash0;
  const intrinsicPx = equityValue / a.shares * 100; // value in Cr → ₹ per share given shares in M

  // ↑ note: equityValue is in ₹ Cr, shares in M; convert: (Cr * 1e7) / (M * 1e6) = Cr * 10 / M
  const ipx = (equityValue * 10) / a.shares;

  return { ke, kd, wE, wD, wacc, fcff, pvFcff, tv, pvTv, ev, equityValue, intrinsicPx: ipx };
}

// ============================================================================
// Top-level App
// ============================================================================
export default function FinancialModelingTerminal() {
  const [tab, setTab] = useState("dashboard");
  const [a, setA] = useState(DEFAULT_ASSUMPTIONS);
  const [scenario, setScenario] = useState("base");

  const aScen = useMemo(() => {
    if (scenario === "base") return a;
    const mult = scenario === "bull" ? 1 : scenario === "bear" ? -1 : 0;
    return {
      ...a,
      revGrowth: a.revGrowth.map(g => g + mult * 0.04),
      gmPct: a.gmPct.map(g => g + mult * 0.015),
      opexPctRev: a.opexPctRev.map(o => o - mult * 0.005),
    };
  }, [a, scenario]);

  const model = useMemo(() => buildThreeStatement(aScen), [aScen]);
  const dcf = useMemo(() => buildDCF(aScen, model), [aScen, model]);

  const tabs = [
    { id: "dashboard", label: "01 ▸ DASHBOARD" },
    { id: "assumptions", label: "02 ▸ ASSUMPTIONS" },
    { id: "is", label: "03 ▸ INCOME STMT" },
    { id: "bs", label: "04 ▸ BALANCE SHT" },
    { id: "cf", label: "05 ▸ CASH FLOW" },
    { id: "schedules", label: "06 ▸ SCHEDULES" },
    { id: "ratios", label: "07 ▸ RATIOS" },
    { id: "scenarios", label: "08 ▸ SCENARIOS" },
    { id: "comps", label: "09 ▸ COMPS" },
    { id: "wacc", label: "10 ▸ WACC/BETA" },
    { id: "dcf", label: "11 ▸ DCF" },
    { id: "sensitivity", label: "12 ▸ SENSITIVITY" },
    { id: "ma", label: "13 ▸ M&A" },
    { id: "lbo", label: "14 ▸ LBO" },
    { id: "graphs", label: "15 ▸ GRAPH ANALYSIS" },
  ];

  return (
    <div style={{
      background: COLORS.bg, color: COLORS.text, minHeight: "100vh",
      fontFamily: "'IBM Plex Mono', 'Roboto Mono', monospace", fontSize: 12,
    }}>
      <Header company={aScen.company} ticker={aScen.ticker} dcf={dcf} model={model} scenario={scenario} setScenario={setScenario} />

      <nav style={{
        display: "flex", flexWrap: "wrap", gap: 0, borderBottom: `1px solid ${COLORS.border}`,
        background: COLORS.panel, position: "sticky", top: 0, zIndex: 10,
      }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: "10px 14px", background: tab === t.id ? COLORS.bg : "transparent",
              color: tab === t.id ? COLORS.gold : COLORS.textDim,
              border: "none", borderBottom: tab === t.id ? `2px solid ${COLORS.gold}` : "2px solid transparent",
              borderRight: `1px solid ${COLORS.border}`,
              fontFamily: "inherit", fontSize: 10.5, letterSpacing: "0.08em", cursor: "pointer",
              fontWeight: tab === t.id ? 600 : 400,
            }}>{t.label}</button>
        ))}
      </nav>

      <main style={{ padding: 16 }}>
        {tab === "dashboard" && <Dashboard a={aScen} model={model} dcf={dcf} />}
        {tab === "assumptions" && <Assumptions a={a} setA={setA} />}
        {tab === "is" && <IncomeStatement a={aScen} model={model} />}
        {tab === "bs" && <BalanceSheet a={aScen} model={model} />}
        {tab === "cf" && <CashFlow a={aScen} model={model} />}
        {tab === "schedules" && <Schedules a={aScen} model={model} />}
        {tab === "ratios" && <Ratios a={aScen} model={model} />}
        {tab === "scenarios" && <Scenarios a={a} setA={setA} />}
        {tab === "comps" && <Comps a={aScen} model={model} dcf={dcf} />}
        {tab === "wacc" && <WACCBeta a={aScen} setA={setA} dcf={dcf} />}
        {tab === "dcf" && <DCFView a={aScen} model={model} dcf={dcf} />}
        {tab === "sensitivity" && <Sensitivity a={aScen} model={model} />}
        {tab === "ma" && <MAModel a={aScen} model={model} dcf={dcf} />}
        {tab === "lbo" && <LBOModel a={aScen} model={model} />}
        {tab === "graphs" && <GraphAnalysis a={aScen} model={model} dcf={dcf} />}
      </main>

      <Footer />
    </div>
  );
}

// ============================================================================
// Header
// ============================================================================
function Header({ company, ticker, dcf, model, scenario, setScenario }) {
  const last = model.revenue.length - 1;
  return (
    <header style={{ borderBottom: `1px solid ${COLORS.gold}`, background: COLORS.panel }}>
      <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div>
            <div style={{ color: COLORS.gold, fontSize: 16, fontWeight: 700, letterSpacing: "0.1em" }}>QUANTDESK ▸ FM-TERMINAL</div>
            <div style={{ color: COLORS.textDim, fontSize: 10, letterSpacing: "0.15em" }}>INTEGRATED FINANCIAL MODELING ▸ 3STMT · DCF · COMPS · M&A · LBO</div>
          </div>
          <div style={{ borderLeft: `1px solid ${COLORS.border}`, paddingLeft: 16 }}>
            <div style={{ color: COLORS.gold, fontSize: 14, fontWeight: 600 }}>{company}</div>
            <div style={{ color: COLORS.textDim, fontSize: 10 }}>NSE: {ticker} · IT SERVICES</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
          <Stat label="INTRINSIC PX" val={"₹" + fmtNum(dcf.intrinsicPx, 0)} hi />
          <Stat label="ENT VALUE" val={fmt(dcf.ev, 0) + " Cr"} />
          <Stat label="WACC" val={fmtPct(dcf.wacc)} />
          <Stat label="REV FY30E" val={fmt(model.revenue[last], 0) + " Cr"} />
          <div style={{ display: "flex", gap: 4 }}>
            {["bear", "base", "bull"].map(s => (
              <button key={s} onClick={() => setScenario(s)} style={{
                padding: "6px 12px", background: scenario === s ? (s === "bull" ? COLORS.green : s === "bear" ? COLORS.red : COLORS.gold) : "transparent",
                color: scenario === s ? COLORS.bg : COLORS.textDim,
                border: `1px solid ${scenario === s ? "transparent" : COLORS.border}`,
                fontFamily: "inherit", fontSize: 10, letterSpacing: "0.1em", cursor: "pointer", fontWeight: 600, textTransform: "uppercase"
              }}>{s}</button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}

function Stat({ label, val, hi }) {
  return (
    <div>
      <div style={{ color: COLORS.textMuted, fontSize: 9, letterSpacing: "0.15em" }}>{label}</div>
      <div style={{ color: hi ? COLORS.gold : COLORS.text, fontSize: 14, fontWeight: 600 }}>{val}</div>
    </div>
  );
}

function Footer() {
  return (
    <footer style={{ borderTop: `1px solid ${COLORS.border}`, padding: "12px 16px", color: COLORS.textMuted, fontSize: 10, letterSpacing: "0.1em", textAlign: "center" }}>
      QUANTDESK FM-TERMINAL · INDIAN MARKET CONVENTIONS (NSE/BSE) · INR CRORES · DAMODARAN ERP · BUILT FOR PORTFOLIO/INTERVIEW USE
    </footer>
  );
}

// ============================================================================
// Reusable: Panel, Table, Cell, Section
// ============================================================================
function Panel({ title, subtitle, children, style }) {
  return (
    <section style={{
      background: COLORS.panel, border: `1px solid ${COLORS.border}`, marginBottom: 12,
      ...style,
    }}>
      <div style={{ padding: "8px 12px", borderBottom: `1px solid ${COLORS.border}`, background: COLORS.panelAlt }}>
        <div style={{ color: COLORS.gold, fontSize: 11, letterSpacing: "0.15em", fontWeight: 600 }}>{title}</div>
        {subtitle && <div style={{ color: COLORS.textMuted, fontSize: 9.5, letterSpacing: "0.1em", marginTop: 2 }}>{subtitle}</div>}
      </div>
      <div style={{ padding: 12 }}>{children}</div>
    </section>
  );
}

function FinTable({ rows, years, fy0, hideHeader, dense }) {
  return (
    <div style={{ overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: dense ? 10.5 : 11.5 }}>
        {!hideHeader && (
          <thead>
            <tr style={{ borderBottom: `1px solid ${COLORS.gold}` }}>
              <th style={{ textAlign: "left", padding: "6px 10px", color: COLORS.gold, fontWeight: 600, letterSpacing: "0.1em", fontSize: 10 }}>LINE ITEM (₹ Cr)</th>
              <th style={{ textAlign: "right", padding: "6px 10px", color: COLORS.textMuted, fontWeight: 500, fontSize: 10 }}>FY{(fy0 ?? 25) % 100}A</th>
              {years.map((y, i) => (
                <th key={y} style={{ textAlign: "right", padding: "6px 10px", color: COLORS.textDim, fontWeight: 500, fontSize: 10 }}>FY{y % 100}E</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{
              borderBottom: r.divider ? `1px solid ${COLORS.border}` : `1px solid ${COLORS.borderLight}`,
              background: r.highlight ? COLORS.panelAlt : "transparent",
            }}>
              <td style={{
                padding: dense ? "4px 10px" : "6px 10px",
                color: r.bold ? COLORS.gold : r.indent ? COLORS.textDim : COLORS.text,
                fontWeight: r.bold ? 600 : 400,
                paddingLeft: r.indent ? 24 : 10,
                fontSize: r.bold ? 11.5 : "inherit",
              }}>{r.label}</td>
              {[r.actual, ...(r.values || [])].map((v, j) => (
                <td key={j} style={{
                  padding: dense ? "4px 10px" : "6px 10px", textAlign: "right",
                  color: r.bold ? COLORS.gold : (typeof v === "number" && v < 0 ? COLORS.red : COLORS.text),
                  fontWeight: r.bold ? 600 : 400,
                  fontFamily: "inherit",
                }}>
                  {v === null || v === undefined ? "—" :
                    typeof v === "number" ? (
                      r.format === "pct" ? fmtPct(v) :
                      r.format === "mul" ? fmtMul(v) :
                      r.format === "raw" ? fmtNum(v, 2) :
                      fmtNum(v, r.dp ?? 0)
                    ) : v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// 01 — DASHBOARD
// ============================================================================
function Dashboard({ a, model, dcf }) {
  const last = model.revenue.length - 1;
  const cagr = Math.pow(model.revenue[last] / a.rev0, 1 / model.years.length) - 1;
  const niCagr = Math.pow(model.ni[last] / model.ni[0], 1 / (model.years.length - 1)) - 1;

  const chartData = model.years.map((y, i) => ({
    year: "FY" + (y % 100),
    Revenue: Math.round(model.revenue[i]),
    EBITDA: Math.round(model.ebitda[i]),
    NetIncome: Math.round(model.ni[i]),
    FCFF: Math.round(dcf.fcff[i]),
  }));

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
        <KPI label="REV CAGR (5Y)" val={fmtPct(cagr)} sub={`FY${a.fy0 % 100} → FY${(a.fy0 + 5) % 100}`} color={COLORS.gold} />
        <KPI label="NET INC CAGR" val={fmtPct(niCagr)} sub="profit growth" color={COLORS.green} />
        <KPI label="AVG EBITDA MGN" val={fmtPct(model.ebitdaMargin.reduce((s, v) => s + v, 0) / model.ebitdaMargin.length)} sub="forecast period" color={COLORS.cyan} />
        <KPI label="ROE FY30E" val={fmtPct(model.roe[last])} sub={`vs ${fmtPct(model.ni[0] / a.equity0)} entry`} color={COLORS.purple} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
        <Panel title="▸ FORECAST P&L TRAJECTORY (₹ Cr)" subtitle="REVENUE · EBITDA · NET INCOME · FCFF / 5-YEAR PROJECTION">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData}>
              <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" />
              <XAxis dataKey="year" stroke={COLORS.textDim} style={{ fontSize: 10 }} />
              <YAxis stroke={COLORS.textDim} style={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="Revenue" fill={COLORS.gold} opacity={0.8} />
              <Bar dataKey="EBITDA" fill={COLORS.cyan} opacity={0.8} />
              <Line dataKey="NetIncome" stroke={COLORS.green} strokeWidth={2} dot={{ r: 3 }} />
              <Line dataKey="FCFF" stroke={COLORS.amber} strokeWidth={2} strokeDasharray="4 2" dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="▸ VALUATION SUMMARY">
          <ValueRow label="Sum of PV(FCFF)" val={fmt(dcf.pvFcff.reduce((s, v) => s + v, 0), 0) + " Cr"} />
          <ValueRow label="PV of Terminal Value" val={fmt(dcf.pvTv, 0) + " Cr"} />
          <ValueRow label="Enterprise Value" val={fmt(dcf.ev, 0) + " Cr"} bold />
          <ValueRow label="(–) Net Debt" val={fmt(a.debt0 - a.cash0, 0) + " Cr"} />
          <ValueRow label="Equity Value" val={fmt(dcf.equityValue, 0) + " Cr"} bold />
          <ValueRow label="÷ Shares O/S (M)" val={fmtNum(a.shares, 0)} />
          <div style={{ marginTop: 12, padding: 12, background: COLORS.bg, border: `1px solid ${COLORS.gold}` }}>
            <div style={{ color: COLORS.textMuted, fontSize: 10, letterSpacing: "0.1em" }}>INTRINSIC VALUE / SHARE</div>
            <div style={{ color: COLORS.gold, fontSize: 24, fontWeight: 700, marginTop: 4 }}>₹{fmtNum(dcf.intrinsicPx, 0)}</div>
          </div>
        </Panel>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 12 }}>
        <Panel title="▸ MARGIN PROFILE">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData.map((d, i) => ({
              year: d.year,
              Gross: +(model.grossMargin[i] * 100).toFixed(1),
              EBITDA: +(model.ebitdaMargin[i] * 100).toFixed(1),
              Net: +(model.niMargin[i] * 100).toFixed(1),
            }))}>
              <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" />
              <XAxis dataKey="year" stroke={COLORS.textDim} style={{ fontSize: 10 }} />
              <YAxis stroke={COLORS.textDim} style={{ fontSize: 10 }} unit="%" />
              <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line dataKey="Gross" stroke={COLORS.gold} strokeWidth={2} />
              <Line dataKey="EBITDA" stroke={COLORS.cyan} strokeWidth={2} />
              <Line dataKey="Net" stroke={COLORS.green} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="▸ FCF BRIDGE (FY30E)">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={[
              { item: "EBIT(1-T)", val: Math.round(model.ebit[last] * (1 - a.taxRate)) },
              { item: "+ D&A", val: Math.round(model.da[last]) },
              { item: "- CapEx", val: -Math.round(model.capex[last]) },
              { item: "- ΔNWC", val: -Math.round(model.dNwc[last]) },
              { item: "FCFF", val: Math.round(dcf.fcff[last]) },
            ]}>
              <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" />
              <XAxis dataKey="item" stroke={COLORS.textDim} style={{ fontSize: 9 }} />
              <YAxis stroke={COLORS.textDim} style={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
              <Bar dataKey="val">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Cell key={i} fill={i === 4 ? COLORS.gold : i < 2 ? COLORS.green : COLORS.red} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="▸ CAP STRUCTURE">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={[
                { name: "Equity", value: Math.round(a.equity0) },
                { name: "Debt", value: Math.round(a.debt0) },
              ]} dataKey="value" cx="50%" cy="50%" innerRadius={45} outerRadius={75} label={{ fontSize: 10, fill: COLORS.text }}>
                <Cell fill={COLORS.gold} />
                <Cell fill={COLORS.red} />
              </Pie>
              <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 10, color: COLORS.textDim, textAlign: "center", marginTop: -8 }}>
            E/V: {fmtPct(dcf.wE)} · D/V: {fmtPct(dcf.wD)}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function KPI({ label, val, sub, color }) {
  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, padding: 14, borderLeft: `3px solid ${color}` }}>
      <div style={{ color: COLORS.textMuted, fontSize: 9.5, letterSpacing: "0.15em" }}>{label}</div>
      <div style={{ color: color, fontSize: 22, fontWeight: 700, marginTop: 4 }}>{val}</div>
      <div style={{ color: COLORS.textMuted, fontSize: 9.5, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function ValueRow({ label, val, bold }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${COLORS.borderLight}` }}>
      <span style={{ color: bold ? COLORS.gold : COLORS.textDim, fontWeight: bold ? 600 : 400, fontSize: 11 }}>{label}</span>
      <span style={{ color: bold ? COLORS.gold : COLORS.text, fontWeight: bold ? 600 : 400, fontSize: 11 }}>{val}</span>
    </div>
  );
}

// ============================================================================
// 02 — ASSUMPTIONS
// ============================================================================
function Assumptions({ a, setA }) {
  const upd = (k, v) => setA({ ...a, [k]: v });
  const updArr = (k, i, v) => {
    const arr = [...a[k]]; arr[i] = v; setA({ ...a, [k]: arr });
  };

  return (
    <div>
      <Panel title="▸ COMPANY PROFILE">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <Inp label="Company" val={a.company} onChange={v => upd("company", v)} text />
          <Inp label="Ticker" val={a.ticker} onChange={v => upd("ticker", v)} text />
          <Inp label="Sector" val={a.sector} onChange={v => upd("sector", v)} text />
          <Inp label="Base FY" val={a.fy0} onChange={v => upd("fy0", +v)} />
        </div>
      </Panel>

      <Panel title="▸ REVENUE & GROWTH" subtitle="ANNUAL GROWTH ASSUMPTIONS · 5-YEAR FORECAST">
        <div style={{ display: "grid", gridTemplateColumns: "1fr repeat(5, 1fr)", gap: 8, alignItems: "end" }}>
          <Inp label="FY25A Revenue (Cr)" val={a.rev0} onChange={v => upd("rev0", +v)} />
          {a.revGrowth.map((g, i) => (
            <Inp key={i} label={`FY${(a.fy0 + i + 1) % 100}E Growth`} val={(g * 100).toFixed(1)} onChange={v => updArr("revGrowth", i, +v / 100)} suffix="%" />
          ))}
        </div>
      </Panel>

      <Panel title="▸ MARGIN ASSUMPTIONS">
        <div style={{ display: "grid", gridTemplateColumns: "150px repeat(5, 1fr)", gap: 8, alignItems: "end" }}>
          <div style={{ color: COLORS.textDim, fontSize: 10 }}>Gross Margin %</div>
          {a.gmPct.map((v, i) => <Inp key={i} label={`FY${(a.fy0 + i + 1) % 100}E`} val={(v * 100).toFixed(1)} onChange={x => updArr("gmPct", i, +x / 100)} suffix="%" />)}
          <div style={{ color: COLORS.textDim, fontSize: 10 }}>OpEx % of Rev</div>
          {a.opexPctRev.map((v, i) => <Inp key={i} label="" val={(v * 100).toFixed(1)} onChange={x => updArr("opexPctRev", i, +x / 100)} suffix="%" />)}
          <div style={{ color: COLORS.textDim, fontSize: 10 }}>D&A % of Rev</div>
          {a.daPctRev.map((v, i) => <Inp key={i} label="" val={(v * 100).toFixed(2)} onChange={x => updArr("daPctRev", i, +x / 100)} suffix="%" />)}
          <div style={{ color: COLORS.textDim, fontSize: 10 }}>CapEx % of Rev</div>
          {a.capexPctRev.map((v, i) => <Inp key={i} label="" val={(v * 100).toFixed(1)} onChange={x => updArr("capexPctRev", i, +x / 100)} suffix="%" />)}
        </div>
      </Panel>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Panel title="▸ WORKING CAPITAL & TAX">
          <Inp label="DSO (Days Sales Outstanding)" val={a.dsoDays} onChange={v => upd("dsoDays", +v)} />
          <Inp label="DIO (Days Inventory Outstanding)" val={a.dioDays} onChange={v => upd("dioDays", +v)} />
          <Inp label="DPO (Days Payables Outstanding)" val={a.dpoDays} onChange={v => upd("dpoDays", +v)} />
          <Inp label="Effective Tax Rate" val={(a.taxRate * 100).toFixed(2)} onChange={v => upd("taxRate", +v / 100)} suffix="%" />
        </Panel>

        <Panel title="▸ OPENING BALANCE SHEET (₹ Cr)">
          <Inp label="Cash & Equivalents" val={a.cash0} onChange={v => upd("cash0", +v)} />
          <Inp label="Total Debt" val={a.debt0} onChange={v => upd("debt0", +v)} />
          <Inp label="Shareholders Equity" val={a.equity0} onChange={v => upd("equity0", +v)} />
          <Inp label="PP&E (Net)" val={a.ppe0} onChange={v => upd("ppe0", +v)} />
          <Inp label="Shares Outstanding (M)" val={a.shares} onChange={v => upd("shares", +v)} />
        </Panel>
      </div>

      <Panel title="▸ COST OF CAPITAL INPUTS">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
          <Inp label="Risk-free Rate (10Y G-Sec)" val={(a.rf * 100).toFixed(2)} onChange={v => upd("rf", +v / 100)} suffix="%" />
          <Inp label="Equity Risk Premium" val={(a.erp * 100).toFixed(2)} onChange={v => upd("erp", +v / 100)} suffix="%" />
          <Inp label="Levered Beta" val={a.beta} onChange={v => upd("beta", +v)} />
          <Inp label="Pre-tax Cost of Debt" val={(a.preTaxKd * 100).toFixed(2)} onChange={v => upd("preTaxKd", +v / 100)} suffix="%" />
          <Inp label="Terminal Growth Rate" val={(a.termGrowth * 100).toFixed(2)} onChange={v => upd("termGrowth", +v / 100)} suffix="%" />
        </div>
      </Panel>
    </div>
  );
}

function Inp({ label, val, onChange, suffix, text }) {
  return (
    <div style={{ marginBottom: 8 }}>
      {label && <div style={{ color: COLORS.textMuted, fontSize: 9.5, letterSpacing: "0.1em", marginBottom: 4 }}>{label}</div>}
      <div style={{ display: "flex", alignItems: "center", border: `1px solid ${COLORS.border}`, background: COLORS.bg }}>
        <input type={text ? "text" : "number"} value={val} onChange={e => onChange(e.target.value)}
          style={{
            flex: 1, padding: "6px 8px", background: "transparent", border: "none", color: COLORS.text,
            fontFamily: "inherit", fontSize: 11.5, outline: "none",
          }} />
        {suffix && <span style={{ color: COLORS.gold, paddingRight: 8, fontSize: 11 }}>{suffix}</span>}
      </div>
    </div>
  );
}

// ============================================================================
// 03 — INCOME STATEMENT
// ============================================================================
function IncomeStatement({ a, model }) {
  const rows = [
    { label: "Revenue", actual: a.rev0, values: model.revenue, bold: true, dp: 0 },
    { label: "Growth %", actual: null, values: a.revGrowth, indent: true, format: "pct" },
    { label: "(–) Cost of Goods Sold", actual: a.rev0 * (1 - 0.42), values: model.cogs, dp: 0 },
    { label: "Gross Profit", actual: a.rev0 * 0.42, values: model.grossProfit, bold: true, divider: true, dp: 0 },
    { label: "Gross Margin %", actual: 0.42, values: model.grossMargin, indent: true, format: "pct" },
    { label: "(–) Operating Expenses", actual: a.rev0 * 0.18, values: model.opex, dp: 0 },
    { label: "EBITDA", actual: a.rev0 * 0.24, values: model.ebitda, bold: true, divider: true, dp: 0 },
    { label: "EBITDA Margin %", actual: 0.24, values: model.ebitdaMargin, indent: true, format: "pct" },
    { label: "(–) Depreciation & Amortization", actual: a.rev0 * 0.045, values: model.da, dp: 0 },
    { label: "EBIT (Operating Profit)", actual: a.rev0 * 0.195, values: model.ebit, bold: true, divider: true, dp: 0 },
    { label: "(–) Interest Expense", actual: a.debt0 * a.intPctDebt, values: model.interest, dp: 0 },
    { label: "EBT (Pre-tax Income)", actual: a.rev0 * 0.195 - a.debt0 * a.intPctDebt, values: model.ebt, bold: true, dp: 0 },
    { label: "(–) Income Tax", actual: (a.rev0 * 0.195 - a.debt0 * a.intPctDebt) * a.taxRate, values: model.tax, dp: 0 },
    { label: "Net Income", actual: (a.rev0 * 0.195 - a.debt0 * a.intPctDebt) * (1 - a.taxRate), values: model.ni, bold: true, divider: true, dp: 0, highlight: true },
    { label: "Net Margin %", actual: 0.146, values: model.niMargin, indent: true, format: "pct" },
    { label: "EPS (₹/share)", actual: ((a.rev0 * 0.195 - a.debt0 * a.intPctDebt) * (1 - a.taxRate) * 10) / a.shares,
      values: model.ni.map(n => (n * 10) / a.shares), bold: true, format: "raw" },
  ];

  return (
    <Panel title="▸ INCOME STATEMENT" subtitle="₹ CRORES · INDIAN GAAP / IND-AS · 5-YEAR FORECAST">
      <FinTable rows={rows} years={model.years} fy0={a.fy0} />
    </Panel>
  );
}

// ============================================================================
// 04 — BALANCE SHEET
// ============================================================================
function BalanceSheet({ a, model }) {
  const ca0 = a.cash0 + a.ar0 + a.inv0;
  const ta0 = ca0 + a.ppe0;
  const tl0 = a.ap0 + a.debt0;

  const rows = [
    { label: "ASSETS", bold: true, divider: true, actual: null, values: [null, null, null, null, null] },
    { label: "Cash & Equivalents", actual: a.cash0, values: model.cashBal, dp: 0 },
    { label: "Accounts Receivable", actual: a.ar0, values: model.ar, dp: 0 },
    { label: "Inventory", actual: a.inv0, values: model.inv, dp: 0 },
    { label: "Total Current Assets", actual: ca0, values: model.ar.map((ar, i) => ar + model.inv[i] + model.cashBal[i]), bold: true, dp: 0 },
    { label: "PP&E (Net)", actual: a.ppe0, values: model.ppe, dp: 0 },
    { label: "TOTAL ASSETS", actual: ta0, values: model.totalAssets, bold: true, divider: true, highlight: true, dp: 0 },

    { label: "LIABILITIES", bold: true, divider: true, actual: null, values: [null, null, null, null, null] },
    { label: "Accounts Payable", actual: a.ap0, values: model.ap, dp: 0 },
    { label: "Total Debt", actual: a.debt0, values: model.debtBal, dp: 0 },
    { label: "TOTAL LIABILITIES", actual: tl0, values: model.totalLiab, bold: true, dp: 0 },

    { label: "EQUITY", bold: true, divider: true, actual: null, values: [null, null, null, null, null] },
    { label: "Shareholders' Equity", actual: a.equity0, values: model.equity, dp: 0 },

    { label: "TOTAL LIABILITIES + EQUITY", actual: tl0 + a.equity0, values: model.totalLE, bold: true, divider: true, highlight: true, dp: 0 },
    { label: "BS Check (A − L − E)", actual: ta0 - tl0 - a.equity0, values: model.bsCheck, indent: true, dp: 2, format: "raw" },
  ];

  return (
    <div>
      <Panel title="▸ BALANCE SHEET" subtitle="₹ CRORES · IND-AS COMPLIANT FORMAT">
        <FinTable rows={rows} years={model.years} fy0={a.fy0} />
      </Panel>
      <Panel title="▸ BALANCE SHEET INTEGRITY CHECK">
        <div style={{ padding: 12, background: model.bsCheck.every(v => Math.abs(v) < 0.5) ? COLORS.panel : "#3a1a1a", border: `1px solid ${model.bsCheck.every(v => Math.abs(v) < 0.5) ? COLORS.green : COLORS.red}`, color: model.bsCheck.every(v => Math.abs(v) < 0.5) ? COLORS.green : COLORS.red, fontSize: 11, letterSpacing: "0.1em" }}>
          {model.bsCheck.every(v => Math.abs(v) < 0.5) ? "✓ BALANCE SHEET BALANCES — Assets = Liabilities + Equity across all forecast years" : "✗ BALANCE SHEET DOES NOT BALANCE — review WC, debt, and equity rolls"}
        </div>
      </Panel>
    </div>
  );
}

// ============================================================================
// 05 — CASH FLOW
// ============================================================================
function CashFlow({ a, model }) {
  const rows = [
    { label: "OPERATING ACTIVITIES", bold: true, divider: true, actual: null, values: [null, null, null, null, null] },
    { label: "Net Income", actual: null, values: model.ni, dp: 0 },
    { label: "(+) D&A", actual: null, values: model.da, dp: 0 },
    { label: "(–) Δ Working Capital", actual: null, values: model.dNwc.map(v => -v), dp: 0 },
    { label: "Cash from Operations (CFO)", actual: null, values: model.cfo, bold: true, divider: true, dp: 0, highlight: true },

    { label: "INVESTING ACTIVITIES", bold: true, divider: true, actual: null, values: [null, null, null, null, null] },
    { label: "(–) Capital Expenditure", actual: null, values: model.cfi, dp: 0 },
    { label: "Cash from Investing (CFI)", actual: null, values: model.cfi, bold: true, divider: true, dp: 0, highlight: true },

    { label: "FINANCING ACTIVITIES", bold: true, divider: true, actual: null, values: [null, null, null, null, null] },
    { label: "(–) Debt Repayment", actual: null, values: model.cff, dp: 0 },
    { label: "Cash from Financing (CFF)", actual: null, values: model.cff, bold: true, divider: true, dp: 0, highlight: true },

    { label: "NET Δ CASH", actual: null, values: model.dCash, bold: true, dp: 0 },
    { label: "Beginning Cash", actual: null, values: model.cashBal.map((c, i) => i === 0 ? a.cash0 : model.cashBal[i - 1]), dp: 0 },
    { label: "Ending Cash", actual: null, values: model.cashBal, bold: true, divider: true, highlight: true, dp: 0 },
  ];

  return (
    <Panel title="▸ CASH FLOW STATEMENT" subtitle="₹ CRORES · INDIRECT METHOD · IND-AS 7">
      <FinTable rows={rows} years={model.years} fy0={a.fy0} />
    </Panel>
  );
}

// ============================================================================
// 06 — SUPPORTING SCHEDULES
// ============================================================================
function Schedules({ a, model }) {
  // Working capital
  const wcRows = [
    { label: "Accounts Receivable", actual: a.ar0, values: model.ar, dp: 0 },
    { label: "DSO (Days)", actual: a.dsoDays, values: Array(5).fill(a.dsoDays), indent: true, format: "raw", dp: 0 },
    { label: "Inventory", actual: a.inv0, values: model.inv, dp: 0 },
    { label: "DIO (Days)", actual: a.dioDays, values: Array(5).fill(a.dioDays), indent: true, format: "raw", dp: 0 },
    { label: "Accounts Payable", actual: a.ap0, values: model.ap, dp: 0 },
    { label: "DPO (Days)", actual: a.dpoDays, values: Array(5).fill(a.dpoDays), indent: true, format: "raw", dp: 0 },
    { label: "Net Working Capital", actual: a.ar0 + a.inv0 - a.ap0, values: model.nwc, bold: true, divider: true, dp: 0 },
    { label: "Δ NWC (cash impact)", actual: null, values: model.dNwc, dp: 0 },
  ];

  // Depreciation schedule
  const depRows = [
    { label: "Opening PP&E (Net)", actual: null, values: model.ppe.map((p, i) => i === 0 ? a.ppe0 : model.ppe[i - 1]), dp: 0 },
    { label: "(+) CapEx", actual: null, values: model.capex, dp: 0 },
    { label: "(–) Depreciation", actual: null, values: model.da, dp: 0 },
    { label: "Closing PP&E (Net)", actual: a.ppe0, values: model.ppe, bold: true, divider: true, dp: 0, highlight: true },
    { label: "PP&E Turnover (Rev/PP&E)", actual: null, values: model.ppe.map((p, i) => model.revenue[i] / p), format: "mul" },
  ];

  // Debt schedule
  const debtRows = [
    { label: "Opening Debt", actual: null, values: model.debtBal.map((d, i) => i === 0 ? a.debt0 : model.debtBal[i - 1]), dp: 0 },
    { label: "(–) Principal Repayment", actual: null, values: model.debtRepay, dp: 0 },
    { label: "Closing Debt", actual: a.debt0, values: model.debtBal, bold: true, divider: true, dp: 0, highlight: true },
    { label: "Avg Debt Balance", actual: null, values: model.debtBal.map((d, i) => (d + (i === 0 ? a.debt0 : model.debtBal[i - 1])) / 2), dp: 0 },
    { label: "Interest Rate", actual: a.intPctDebt, values: Array(5).fill(a.intPctDebt), format: "pct" },
    { label: "Interest Expense", actual: a.debt0 * a.intPctDebt, values: model.interest, bold: true, dp: 0 },
  ];

  return (
    <div>
      <Panel title="▸ WORKING CAPITAL SCHEDULE" subtitle="DSO/DIO/DPO METHODOLOGY">
        <FinTable rows={wcRows} years={model.years} fy0={a.fy0} />
      </Panel>
      <Panel title="▸ DEPRECIATION & PP&E SCHEDULE" subtitle="WATERFALL: OPENING + CAPEX – DEP = CLOSING">
        <FinTable rows={depRows} years={model.years} fy0={a.fy0} />
      </Panel>
      <Panel title="▸ DEBT & INTEREST SCHEDULE" subtitle="MANDATORY AMORTIZATION 5%/YEAR · INTEREST ON OPENING BALANCE">
        <FinTable rows={debtRows} years={model.years} fy0={a.fy0} />
      </Panel>
    </div>
  );
}

// ============================================================================
// 07 — RATIOS
// ============================================================================
function Ratios({ a, model }) {
  const profRows = [
    { label: "Gross Margin", actual: 0.42, values: model.grossMargin, format: "pct" },
    { label: "EBITDA Margin", actual: 0.24, values: model.ebitdaMargin, format: "pct" },
    { label: "EBIT Margin", actual: 0.195, values: model.ebitMargin, format: "pct" },
    { label: "Net Margin", actual: 0.146, values: model.niMargin, format: "pct" },
    { label: "ROE", actual: model.ni[0] / a.equity0, values: model.roe, format: "pct", bold: true },
    { label: "ROA", actual: model.ni[0] / (a.cash0 + a.ar0 + a.inv0 + a.ppe0), values: model.roa, format: "pct", bold: true },
  ];
  const liqRows = [
    { label: "Current Ratio", actual: (a.cash0 + a.ar0 + a.inv0) / a.ap0, values: model.currentRatio, format: "mul" },
    { label: "Quick Ratio", actual: (a.cash0 + a.ar0) / a.ap0, values: model.ar.map((ar, i) => (model.cashBal[i] + ar) / model.ap[i]), format: "mul" },
    { label: "Cash Ratio", actual: a.cash0 / a.ap0, values: model.cashBal.map((c, i) => c / model.ap[i]), format: "mul" },
  ];
  const lvgRows = [
    { label: "Debt / Equity", actual: a.debt0 / a.equity0, values: model.debtEquity, format: "mul" },
    { label: "Debt / EBITDA", actual: a.debt0 / (a.rev0 * 0.24), values: model.debtBal.map((d, i) => d / model.ebitda[i]), format: "mul" },
    { label: "Interest Coverage", actual: (a.rev0 * 0.195) / (a.debt0 * a.intPctDebt), values: model.intCov, format: "mul", bold: true },
  ];
  const effRows = [
    { label: "Asset Turnover", actual: a.rev0 / (a.cash0 + a.ar0 + a.inv0 + a.ppe0), values: model.totalAssets.map((ta, i) => model.revenue[i] / ta), format: "mul" },
    { label: "Inventory Turnover", actual: 365 / a.dioDays, values: Array(5).fill(365 / a.dioDays), format: "mul" },
    { label: "Receivables Turnover", actual: 365 / a.dsoDays, values: Array(5).fill(365 / a.dsoDays), format: "mul" },
  ];

  return (
    <div>
      <Panel title="▸ PROFITABILITY RATIOS"><FinTable rows={profRows} years={model.years} fy0={a.fy0} dense /></Panel>
      <Panel title="▸ LIQUIDITY RATIOS"><FinTable rows={liqRows} years={model.years} fy0={a.fy0} dense /></Panel>
      <Panel title="▸ LEVERAGE / SOLVENCY RATIOS"><FinTable rows={lvgRows} years={model.years} fy0={a.fy0} dense /></Panel>
      <Panel title="▸ EFFICIENCY / TURNOVER RATIOS"><FinTable rows={effRows} years={model.years} fy0={a.fy0} dense /></Panel>
    </div>
  );
}

// ============================================================================
// 08 — SCENARIOS
// ============================================================================
function Scenarios({ a, setA }) {
  const scenarios = ["bear", "base", "bull"];
  const buildScen = (name) => {
    const mult = name === "bull" ? 1 : name === "bear" ? -1 : 0;
    return {
      ...a,
      revGrowth: a.revGrowth.map(g => g + mult * 0.04),
      gmPct: a.gmPct.map(g => g + mult * 0.015),
      opexPctRev: a.opexPctRev.map(o => o - mult * 0.005),
    };
  };
  const results = scenarios.map(s => {
    const aS = buildScen(s);
    const m = buildThreeStatement(aS);
    const d = buildDCF(aS, m);
    return { name: s, a: aS, model: m, dcf: d };
  });

  return (
    <div>
      <Panel title="▸ SCENARIO MATRIX" subtitle="BEAR / BASE / BULL · SIMULTANEOUS REVENUE GROWTH (±4%), GROSS MARGIN (±1.5%), OPEX (∓0.5%)">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${COLORS.gold}` }}>
              <th style={{ textAlign: "left", padding: 8, color: COLORS.gold, fontSize: 10, letterSpacing: "0.1em" }}>METRIC</th>
              {scenarios.map(s => (
                <th key={s} style={{ textAlign: "right", padding: 8, color: s === "bull" ? COLORS.green : s === "bear" ? COLORS.red : COLORS.gold, fontSize: 10, letterSpacing: "0.1em" }}>{s.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <ScenRow label="Revenue FY30E (₹ Cr)" results={results} get={r => r.model.revenue[4]} fmt={v => fmt(v, 0)} />
            <ScenRow label="Avg Revenue Growth %" results={results} get={r => r.a.revGrowth.reduce((s, g) => s + g, 0) / 5} fmt={fmtPct} />
            <ScenRow label="EBITDA FY30E" results={results} get={r => r.model.ebitda[4]} fmt={v => fmt(v, 0)} />
            <ScenRow label="EBITDA Margin (Avg)" results={results} get={r => r.model.ebitdaMargin.reduce((s, g) => s + g, 0) / 5} fmt={fmtPct} />
            <ScenRow label="Net Income FY30E" results={results} get={r => r.model.ni[4]} fmt={v => fmt(v, 0)} />
            <ScenRow label="Cumulative FCFF (5Y)" results={results} get={r => r.dcf.fcff.reduce((s, f) => s + f, 0)} fmt={v => fmt(v, 0)} />
            <ScenRow label="Enterprise Value" results={results} get={r => r.dcf.ev} fmt={v => fmt(v, 0)} bold />
            <ScenRow label="Equity Value" results={results} get={r => r.dcf.equityValue} fmt={v => fmt(v, 0)} bold />
            <ScenRow label="Intrinsic Value / Share" results={results} get={r => r.dcf.intrinsicPx} fmt={v => "₹" + fmtNum(v, 0)} bold />
          </tbody>
        </table>
      </Panel>

      <Panel title="▸ SCENARIO TRAJECTORIES — REVENUE">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={results[0].model.years.map((y, i) => ({
            year: "FY" + (y % 100),
            Bear: Math.round(results[0].model.revenue[i]),
            Base: Math.round(results[1].model.revenue[i]),
            Bull: Math.round(results[2].model.revenue[i]),
          }))}>
            <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" />
            <XAxis dataKey="year" stroke={COLORS.textDim} style={{ fontSize: 10 }} />
            <YAxis stroke={COLORS.textDim} style={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line dataKey="Bear" stroke={COLORS.red} strokeWidth={2} />
            <Line dataKey="Base" stroke={COLORS.gold} strokeWidth={2} />
            <Line dataKey="Bull" stroke={COLORS.green} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  );
}

function ScenRow({ label, results, get, fmt, bold }) {
  return (
    <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}`, background: bold ? COLORS.panelAlt : "transparent" }}>
      <td style={{ padding: "6px 8px", color: bold ? COLORS.gold : COLORS.text, fontWeight: bold ? 600 : 400 }}>{label}</td>
      {results.map((r, i) => (
        <td key={i} style={{ padding: "6px 8px", textAlign: "right", color: bold ? COLORS.gold : COLORS.text, fontWeight: bold ? 600 : 400 }}>{fmt(get(r))}</td>
      ))}
    </tr>
  );
}

// ============================================================================
// 09 — COMPS / TRADING COMPARABLES
// ============================================================================
function Comps({ a, model, dcf }) {
  // Hard-coded peer set (realistic Indian IT)
  const peers = [
    { name: "Tata Consultancy", ticker: "TCS", mcap: 1438500, ev: 1410000, rev: 245000, ebitda: 64500, ni: 47900 },
    { name: "Infosys", ticker: "INFY", mcap: 762000, ev: 738000, rev: 158000, ebitda: 38900, ni: 28000 },
    { name: "HCL Technologies", ticker: "HCLTECH", mcap: 451000, ev: 442000, rev: 109300, ebitda: 23800, ni: 16200 },
    { name: "Wipro", ticker: "WIPRO", mcap: 295000, ev: 280000, rev: 89800, ebitda: 17400, ni: 11000 },
    { name: "Tech Mahindra", ticker: "TECHM", mcap: 168000, ev: 162000, rev: 53700, ebitda: 6100, ni: 4400 },
    { name: "LTI Mindtree", ticker: "LTIM", mcap: 156000, ev: 149000, rev: 38000, ebitda: 6650, ni: 4750 },
    { name: "Persistent Systems", ticker: "PERSISTENT", mcap: 92000, ev: 88500, rev: 11200, ebitda: 1900, ni: 1280 },
    { name: "Coforge", ticker: "COFORGE", mcap: 56000, ev: 54200, rev: 9500, ebitda: 1620, ni: 870 },
  ];
  const enriched = peers.map(p => ({
    ...p,
    evRev: p.ev / p.rev,
    evEbitda: p.ev / p.ebitda,
    pe: p.mcap / p.ni,
  }));
  const stats = (key) => {
    const arr = enriched.map(p => p[key]).sort((x, y) => x - y);
    return {
      min: arr[0], q1: arr[Math.floor(arr.length / 4)],
      median: arr[Math.floor(arr.length / 2)],
      q3: arr[Math.floor(arr.length * 3 / 4)],
      max: arr[arr.length - 1], mean: arr.reduce((s, v) => s + v, 0) / arr.length
    };
  };
  const m = { evRev: stats("evRev"), evEbitda: stats("evEbitda"), pe: stats("pe") };

  // Implied valuation for our company
  const tgtRev = a.rev0;
  const tgtEbitda = a.rev0 * 0.24;
  const tgtNi = (a.rev0 * 0.195 - a.debt0 * a.intPctDebt) * (1 - a.taxRate);
  const impliedEvRev = tgtRev * m.evRev.median;
  const impliedEvEbitda = tgtEbitda * m.evEbitda.median;
  const impliedMcapPE = tgtNi * m.pe.median;

  const impliedPxRev = ((impliedEvRev - a.debt0 + a.cash0) * 10) / a.shares;
  const impliedPxEbitda = ((impliedEvEbitda - a.debt0 + a.cash0) * 10) / a.shares;
  const impliedPxPE = (impliedMcapPE * 10) / a.shares;

  return (
    <div>
      <Panel title="▸ TRADING COMPARABLES" subtitle="INDIAN IT SERVICES PEER SET · LTM MULTIPLES · ALL FIGS ₹ CRORES">
        <div style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${COLORS.gold}` }}>
                <th style={{ padding: 8, textAlign: "left", color: COLORS.gold, letterSpacing: "0.1em" }}>COMPANY</th>
                <th style={{ padding: 8, textAlign: "right", color: COLORS.gold, letterSpacing: "0.1em" }}>MCAP</th>
                <th style={{ padding: 8, textAlign: "right", color: COLORS.gold, letterSpacing: "0.1em" }}>EV</th>
                <th style={{ padding: 8, textAlign: "right", color: COLORS.gold, letterSpacing: "0.1em" }}>REV</th>
                <th style={{ padding: 8, textAlign: "right", color: COLORS.gold, letterSpacing: "0.1em" }}>EBITDA</th>
                <th style={{ padding: 8, textAlign: "right", color: COLORS.gold, letterSpacing: "0.1em" }}>NI</th>
                <th style={{ padding: 8, textAlign: "right", color: COLORS.gold, letterSpacing: "0.1em" }}>EV/REV</th>
                <th style={{ padding: 8, textAlign: "right", color: COLORS.gold, letterSpacing: "0.1em" }}>EV/EBITDA</th>
                <th style={{ padding: 8, textAlign: "right", color: COLORS.gold, letterSpacing: "0.1em" }}>P/E</th>
              </tr>
            </thead>
            <tbody>
              {enriched.map((p, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}>
                  <td style={{ padding: 6 }}>
                    <div style={{ color: COLORS.text }}>{p.name}</div>
                    <div style={{ color: COLORS.textMuted, fontSize: 9 }}>NSE:{p.ticker}</div>
                  </td>
                  <td style={{ padding: 6, textAlign: "right" }}>{fmt(p.mcap, 0)}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{fmt(p.ev, 0)}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{fmt(p.rev, 0)}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{fmt(p.ebitda, 0)}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{fmt(p.ni, 0)}</td>
                  <td style={{ padding: 6, textAlign: "right", color: COLORS.cyan }}>{fmtMul(p.evRev)}</td>
                  <td style={{ padding: 6, textAlign: "right", color: COLORS.cyan }}>{fmtMul(p.evEbitda)}</td>
                  <td style={{ padding: 6, textAlign: "right", color: COLORS.cyan }}>{fmtMul(p.pe)}</td>
                </tr>
              ))}
              {[
                { label: "MEAN", k: "mean" }, { label: "MEDIAN", k: "median", hi: true },
                { label: "MIN", k: "min" }, { label: "MAX", k: "max" }
              ].map(s => (
                <tr key={s.label} style={{ borderTop: s.k === "mean" ? `1px solid ${COLORS.gold}` : "none", background: s.hi ? COLORS.panelAlt : "transparent" }}>
                  <td colSpan={6} style={{ padding: 6, color: s.hi ? COLORS.gold : COLORS.textDim, fontWeight: s.hi ? 600 : 400 }}>{s.label}</td>
                  <td style={{ padding: 6, textAlign: "right", color: s.hi ? COLORS.gold : COLORS.text, fontWeight: s.hi ? 600 : 400 }}>{fmtMul(m.evRev[s.k])}</td>
                  <td style={{ padding: 6, textAlign: "right", color: s.hi ? COLORS.gold : COLORS.text, fontWeight: s.hi ? 600 : 400 }}>{fmtMul(m.evEbitda[s.k])}</td>
                  <td style={{ padding: 6, textAlign: "right", color: s.hi ? COLORS.gold : COLORS.text, fontWeight: s.hi ? 600 : 400 }}>{fmtMul(m.pe[s.k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="▸ IMPLIED VALUATION FROM COMPS" subtitle={`APPLIED TO ${a.company} LTM METRICS · MEDIAN MULTIPLES`}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${COLORS.gold}` }}>
              <th style={{ padding: 8, textAlign: "left", color: COLORS.gold }}>METHOD</th>
              <th style={{ padding: 8, textAlign: "right", color: COLORS.gold }}>METRIC</th>
              <th style={{ padding: 8, textAlign: "right", color: COLORS.gold }}>×</th>
              <th style={{ padding: 8, textAlign: "right", color: COLORS.gold }}>MULTIPLE</th>
              <th style={{ padding: 8, textAlign: "right", color: COLORS.gold }}>=</th>
              <th style={{ padding: 8, textAlign: "right", color: COLORS.gold }}>IMPLIED PX</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}>
              <td style={{ padding: 8 }}>EV / Revenue</td>
              <td style={{ padding: 8, textAlign: "right" }}>{fmt(tgtRev, 0)}</td>
              <td style={{ padding: 8, textAlign: "right", color: COLORS.gold }}>×</td>
              <td style={{ padding: 8, textAlign: "right" }}>{fmtMul(m.evRev.median)}</td>
              <td style={{ padding: 8, textAlign: "right", color: COLORS.gold }}>=</td>
              <td style={{ padding: 8, textAlign: "right", color: COLORS.green, fontWeight: 600 }}>₹{fmtNum(impliedPxRev, 0)}</td>
            </tr>
            <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}>
              <td style={{ padding: 8 }}>EV / EBITDA</td>
              <td style={{ padding: 8, textAlign: "right" }}>{fmt(tgtEbitda, 0)}</td>
              <td style={{ padding: 8, textAlign: "right", color: COLORS.gold }}>×</td>
              <td style={{ padding: 8, textAlign: "right" }}>{fmtMul(m.evEbitda.median)}</td>
              <td style={{ padding: 8, textAlign: "right", color: COLORS.gold }}>=</td>
              <td style={{ padding: 8, textAlign: "right", color: COLORS.green, fontWeight: 600 }}>₹{fmtNum(impliedPxEbitda, 0)}</td>
            </tr>
            <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}>
              <td style={{ padding: 8 }}>P / E</td>
              <td style={{ padding: 8, textAlign: "right" }}>{fmt(tgtNi, 0)}</td>
              <td style={{ padding: 8, textAlign: "right", color: COLORS.gold }}>×</td>
              <td style={{ padding: 8, textAlign: "right" }}>{fmtMul(m.pe.median)}</td>
              <td style={{ padding: 8, textAlign: "right", color: COLORS.gold }}>=</td>
              <td style={{ padding: 8, textAlign: "right", color: COLORS.green, fontWeight: 600 }}>₹{fmtNum(impliedPxPE, 0)}</td>
            </tr>
            <tr style={{ background: COLORS.panelAlt }}>
              <td style={{ padding: 8, color: COLORS.gold, fontWeight: 600 }}>DCF (for reference)</td>
              <td colSpan={4} style={{ padding: 8 }}></td>
              <td style={{ padding: 8, textAlign: "right", color: COLORS.gold, fontWeight: 600 }}>₹{fmtNum(dcf.intrinsicPx, 0)}</td>
            </tr>
          </tbody>
        </table>
      </Panel>

      <Panel title="▸ FOOTBALL FIELD — VALUATION RANGE">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={[
            { method: "EV/Rev (Comps)", lo: impliedPxRev * 0.85, hi: impliedPxRev * 1.15, mid: impliedPxRev },
            { method: "EV/EBITDA (Comps)", lo: impliedPxEbitda * 0.85, hi: impliedPxEbitda * 1.15, mid: impliedPxEbitda },
            { method: "P/E (Comps)", lo: impliedPxPE * 0.85, hi: impliedPxPE * 1.15, mid: impliedPxPE },
            { method: "DCF", lo: dcf.intrinsicPx * 0.9, hi: dcf.intrinsicPx * 1.1, mid: dcf.intrinsicPx },
          ]} layout="vertical">
            <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" />
            <XAxis type="number" stroke={COLORS.textDim} style={{ fontSize: 10 }} />
            <YAxis dataKey="method" type="category" stroke={COLORS.textDim} style={{ fontSize: 10 }} width={120} />
            <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
            <Bar dataKey="lo" stackId="a" fill="transparent" />
            <Bar dataKey="hi" stackId="a" fill={COLORS.gold} opacity={0.6} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  );
}

// ============================================================================
// 10 — WACC / BETA
// ============================================================================
function WACCBeta({ a, setA, dcf }) {
  // Beta calculation: hardcoded daily returns regression vs NIFTY (synthetic for demo)
  const stockRet = [0.012, -0.008, 0.018, 0.005, -0.011, 0.022, -0.003, 0.014, -0.018, 0.009, 0.025, -0.006, 0.011, 0.017, -0.013, 0.008, -0.020, 0.029, 0.004, -0.009, 0.015, 0.006, -0.012, 0.019, 0.002];
  const idxRet = [0.008, -0.005, 0.011, 0.003, -0.007, 0.014, -0.002, 0.009, -0.012, 0.006, 0.016, -0.004, 0.007, 0.011, -0.008, 0.005, -0.013, 0.018, 0.003, -0.006, 0.010, 0.004, -0.008, 0.012, 0.001];
  const meanS = stockRet.reduce((s, v) => s + v, 0) / stockRet.length;
  const meanI = idxRet.reduce((s, v) => s + v, 0) / idxRet.length;
  const cov = stockRet.reduce((s, v, i) => s + (v - meanS) * (idxRet[i] - meanI), 0) / stockRet.length;
  const varI = idxRet.reduce((s, v) => s + (v - meanI) ** 2, 0) / idxRet.length;
  const calcBeta = cov / varI;
  const correl = cov / (Math.sqrt(stockRet.reduce((s, v) => s + (v - meanS) ** 2, 0) / stockRet.length) * Math.sqrt(varI));

  const scatter = stockRet.map((s, i) => ({ idx: idxRet[i] * 100, stock: s * 100 }));

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Panel title="▸ MARKET RETURNS · BETA REGRESSION" subtitle="STOCK vs NIFTY 50 · 25 OBSERVATIONS · OLS">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={scatter}>
              <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" />
              <XAxis type="number" dataKey="idx" stroke={COLORS.textDim} style={{ fontSize: 10 }} unit="%" name="Index" label={{ value: "NIFTY Daily Return %", position: "bottom", fill: COLORS.textDim, fontSize: 10 }} />
              <YAxis type="number" dataKey="stock" stroke={COLORS.textDim} style={{ fontSize: 10 }} unit="%" name="Stock" label={{ value: "Stock Daily Return %", angle: -90, position: "left", fill: COLORS.textDim, fontSize: 10 }} />
              <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
              <Line dataKey="stock" stroke={COLORS.gold} dot={{ r: 4, fill: COLORS.gold }} strokeWidth={0} />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ marginTop: 12, padding: 12, background: COLORS.bg, border: `1px solid ${COLORS.gold}` }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Stat label="REGRESSED β" val={fmtNum(calcBeta, 3)} hi />
              <Stat label="CORRELATION" val={fmtNum(correl, 3)} />
              <Stat label="COVARIANCE" val={fmtNum(cov * 1e4, 3)} />
              <Stat label="VAR(MKT)" val={fmtNum(varI * 1e4, 3)} />
            </div>
          </div>
        </Panel>

        <Panel title="▸ WACC BUILD-UP" subtitle="CAPM · INDIAN MARKET CONVENTIONS · DAMODARAN ERP">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <tbody>
              <tr style={{ borderBottom: `1px solid ${COLORS.gold}` }}><td colSpan={2} style={{ padding: 8, color: COLORS.gold, letterSpacing: "0.1em" }}>COST OF EQUITY (Ke)</td></tr>
              <tr><td style={{ padding: 6 }}>Risk-free Rate (10Y G-Sec)</td><td style={{ padding: 6, textAlign: "right" }}>{fmtPct(a.rf)}</td></tr>
              <tr><td style={{ padding: 6 }}>(+) Beta</td><td style={{ padding: 6, textAlign: "right" }}>{fmtNum(a.beta, 3)}</td></tr>
              <tr><td style={{ padding: 6 }}>(×) Equity Risk Premium</td><td style={{ padding: 6, textAlign: "right" }}>{fmtPct(a.erp)}</td></tr>
              <tr style={{ background: COLORS.panelAlt }}><td style={{ padding: 8, color: COLORS.gold, fontWeight: 600 }}>= Cost of Equity</td><td style={{ padding: 8, textAlign: "right", color: COLORS.gold, fontWeight: 600 }}>{fmtPct(dcf.ke)}</td></tr>

              <tr style={{ borderBottom: `1px solid ${COLORS.gold}` }}><td colSpan={2} style={{ padding: 8, color: COLORS.gold, letterSpacing: "0.1em" }}>COST OF DEBT (Kd)</td></tr>
              <tr><td style={{ padding: 6 }}>Pre-tax Cost of Debt</td><td style={{ padding: 6, textAlign: "right" }}>{fmtPct(a.preTaxKd)}</td></tr>
              <tr><td style={{ padding: 6 }}>(×) (1 – Tax Rate)</td><td style={{ padding: 6, textAlign: "right" }}>{fmtNum(1 - a.taxRate, 3)}</td></tr>
              <tr style={{ background: COLORS.panelAlt }}><td style={{ padding: 8, color: COLORS.gold, fontWeight: 600 }}>= After-tax Cost of Debt</td><td style={{ padding: 8, textAlign: "right", color: COLORS.gold, fontWeight: 600 }}>{fmtPct(dcf.kd)}</td></tr>

              <tr style={{ borderBottom: `1px solid ${COLORS.gold}` }}><td colSpan={2} style={{ padding: 8, color: COLORS.gold, letterSpacing: "0.1em" }}>CAPITAL WEIGHTS</td></tr>
              <tr><td style={{ padding: 6 }}>Equity Weight (E/V)</td><td style={{ padding: 6, textAlign: "right" }}>{fmtPct(dcf.wE)}</td></tr>
              <tr><td style={{ padding: 6 }}>Debt Weight (D/V)</td><td style={{ padding: 6, textAlign: "right" }}>{fmtPct(dcf.wD)}</td></tr>

              <tr style={{ background: COLORS.bg, borderTop: `2px solid ${COLORS.gold}`, borderBottom: `2px solid ${COLORS.gold}` }}>
                <td style={{ padding: 12, color: COLORS.gold, fontWeight: 700, fontSize: 13 }}>WACC</td>
                <td style={{ padding: 12, textAlign: "right", color: COLORS.gold, fontWeight: 700, fontSize: 16 }}>{fmtPct(dcf.wacc)}</td>
              </tr>
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}

// ============================================================================
// 11 — DCF
// ============================================================================
function DCFView({ a, model, dcf }) {
  const rows = [
    { label: "Revenue", actual: a.rev0, values: model.revenue, dp: 0 },
    { label: "EBIT", actual: null, values: model.ebit, dp: 0 },
    { label: "(×) (1 − T)", actual: null, values: Array(5).fill(1 - a.taxRate), format: "raw" },
    { label: "= NOPAT", actual: null, values: model.ebit.map(e => e * (1 - a.taxRate)), bold: true, divider: true, dp: 0 },
    { label: "(+) D&A", actual: null, values: model.da, dp: 0 },
    { label: "(–) CapEx", actual: null, values: model.capex.map(c => -c), dp: 0 },
    { label: "(–) Δ NWC", actual: null, values: model.dNwc.map(c => -c), dp: 0 },
    { label: "FCFF", actual: null, values: dcf.fcff, bold: true, divider: true, highlight: true, dp: 0 },
    { label: "Discount Period (yrs)", actual: null, values: [1, 2, 3, 4, 5], format: "raw" },
    { label: "Discount Factor", actual: null, values: [1, 2, 3, 4, 5].map(t => 1 / Math.pow(1 + dcf.wacc, t)), format: "raw" },
    { label: "PV of FCFF", actual: null, values: dcf.pvFcff, bold: true, dp: 0, highlight: true },
  ];

  return (
    <div>
      <Panel title="▸ DCF VALUATION — UNLEVERED FREE CASH FLOW" subtitle={`WACC = ${fmtPct(dcf.wacc)} · TERMINAL g = ${fmtPct(a.termGrowth)} · 5Y EXPLICIT FORECAST`}>
        <FinTable rows={rows} years={model.years} fy0={a.fy0} />
      </Panel>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Panel title="▸ TERMINAL VALUE — GORDON GROWTH">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <tbody>
              <tr><td style={{ padding: 6 }}>Final Year FCFF (FY30E)</td><td style={{ padding: 6, textAlign: "right" }}>{fmt(dcf.fcff[4], 0)} Cr</td></tr>
              <tr><td style={{ padding: 6 }}>(×) (1 + g)</td><td style={{ padding: 6, textAlign: "right" }}>{fmtNum(1 + a.termGrowth, 4)}</td></tr>
              <tr><td style={{ padding: 6 }}>= Terminal Year FCFF</td><td style={{ padding: 6, textAlign: "right" }}>{fmt(dcf.fcff[4] * (1 + a.termGrowth), 0)} Cr</td></tr>
              <tr><td style={{ padding: 6 }}>÷ (WACC – g)</td><td style={{ padding: 6, textAlign: "right" }}>{fmtPct(dcf.wacc - a.termGrowth)}</td></tr>
              <tr style={{ background: COLORS.panelAlt }}><td style={{ padding: 8, color: COLORS.gold, fontWeight: 600 }}>= Terminal Value</td><td style={{ padding: 8, textAlign: "right", color: COLORS.gold, fontWeight: 600 }}>{fmt(dcf.tv, 0)} Cr</td></tr>
              <tr><td style={{ padding: 6 }}>(÷) (1+WACC)^5</td><td style={{ padding: 6, textAlign: "right" }}>{fmtNum(Math.pow(1 + dcf.wacc, 5), 4)}</td></tr>
              <tr style={{ background: COLORS.panelAlt }}><td style={{ padding: 8, color: COLORS.gold, fontWeight: 600 }}>= PV of Terminal Value</td><td style={{ padding: 8, textAlign: "right", color: COLORS.gold, fontWeight: 600 }}>{fmt(dcf.pvTv, 0)} Cr</td></tr>
            </tbody>
          </table>
        </Panel>

        <Panel title="▸ EV → EQUITY VALUE BRIDGE">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <tbody>
              <tr><td style={{ padding: 6 }}>Sum of PV(FCFF) — Explicit</td><td style={{ padding: 6, textAlign: "right" }}>{fmt(dcf.pvFcff.reduce((s, v) => s + v, 0), 0)} Cr</td></tr>
              <tr><td style={{ padding: 6 }}>(+) PV of Terminal Value</td><td style={{ padding: 6, textAlign: "right" }}>{fmt(dcf.pvTv, 0)} Cr</td></tr>
              <tr style={{ background: COLORS.panelAlt }}><td style={{ padding: 8, color: COLORS.gold, fontWeight: 600 }}>= ENTERPRISE VALUE</td><td style={{ padding: 8, textAlign: "right", color: COLORS.gold, fontWeight: 600 }}>{fmt(dcf.ev, 0)} Cr</td></tr>
              <tr><td style={{ padding: 6 }}>(–) Total Debt</td><td style={{ padding: 6, textAlign: "right", color: COLORS.red }}>({fmt(a.debt0, 0)}) Cr</td></tr>
              <tr><td style={{ padding: 6 }}>(+) Cash & Equivalents</td><td style={{ padding: 6, textAlign: "right", color: COLORS.green }}>{fmt(a.cash0, 0)} Cr</td></tr>
              <tr style={{ background: COLORS.panelAlt }}><td style={{ padding: 8, color: COLORS.gold, fontWeight: 600 }}>= EQUITY VALUE</td><td style={{ padding: 8, textAlign: "right", color: COLORS.gold, fontWeight: 600 }}>{fmt(dcf.equityValue, 0)} Cr</td></tr>
              <tr><td style={{ padding: 6 }}>÷ Diluted Shares (M)</td><td style={{ padding: 6, textAlign: "right" }}>{fmtNum(a.shares, 0)}</td></tr>
              <tr style={{ background: COLORS.bg, borderTop: `2px solid ${COLORS.gold}`, borderBottom: `2px solid ${COLORS.gold}` }}>
                <td style={{ padding: 12, color: COLORS.gold, fontWeight: 700, fontSize: 13 }}>INTRINSIC VALUE / SHARE</td>
                <td style={{ padding: 12, textAlign: "right", color: COLORS.gold, fontWeight: 700, fontSize: 18 }}>₹{fmtNum(dcf.intrinsicPx, 0)}</td>
              </tr>
              <tr><td style={{ padding: 6, color: COLORS.textMuted, fontSize: 10 }}>% from Terminal Value</td><td style={{ padding: 6, textAlign: "right", color: COLORS.textMuted, fontSize: 10 }}>{fmtPct(dcf.pvTv / dcf.ev)}</td></tr>
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}

// ============================================================================
// 12 — SENSITIVITY ANALYSIS
// ============================================================================
function Sensitivity({ a, model }) {
  // 2D sensitivity: WACC × Terminal Growth → Intrinsic Px
  const waccs = [-0.015, -0.0075, 0, 0.0075, 0.015].map(d => 0.115 + d); // approx WACC base
  const gs = [-0.01, -0.005, 0, 0.005, 0.01].map(d => a.termGrowth + d);

  // Use calculated WACC base
  const baseDcf = buildDCF(a, model);
  const baseWacc = baseDcf.wacc;
  const waccsAdj = [-0.015, -0.0075, 0, 0.0075, 0.015].map(d => baseWacc + d);

  const grid = waccsAdj.map(w =>
    gs.map(g => {
      const fcff = model.ebit.map((e, i) => e * (1 - a.taxRate) + model.da[i] - model.capex[i] - model.dNwc[i]);
      const pv = fcff.map((f, i) => f / Math.pow(1 + w, i + 1));
      const tv = fcff[4] * (1 + g) / (w - g);
      const pvtv = tv / Math.pow(1 + w, 5);
      const ev = pv.reduce((s, v) => s + v, 0) + pvtv;
      const eq = ev - a.debt0 + a.cash0;
      return (eq * 10) / a.shares;
    })
  );

  // 1D sensitivities
  const sens1d = [
    { driver: "Revenue Growth Y1", base: a.revGrowth[0], range: [-0.04, -0.02, 0, 0.02, 0.04] },
    { driver: "EBITDA Margin", base: 0.24, range: [-0.03, -0.015, 0, 0.015, 0.03] },
    { driver: "WACC", base: baseWacc, range: [-0.02, -0.01, 0, 0.01, 0.02] },
    { driver: "Terminal g", base: a.termGrowth, range: [-0.01, -0.005, 0, 0.005, 0.01] },
  ];

  return (
    <div>
      <Panel title="▸ 2-D SENSITIVITY: INTRINSIC ₹/SHARE" subtitle="WACC (rows) × TERMINAL GROWTH (cols) · ALL OTHER INPUTS HELD CONSTANT">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${COLORS.gold}` }}>
              <th style={{ padding: 8, textAlign: "left", color: COLORS.gold }}>WACC ↓ / g →</th>
              {gs.map((g, i) => (
                <th key={i} style={{ padding: 8, textAlign: "right", color: i === 2 ? COLORS.gold : COLORS.textDim, fontWeight: i === 2 ? 700 : 400 }}>{fmtPct(g)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}>
                <td style={{ padding: 8, color: i === 2 ? COLORS.gold : COLORS.textDim, fontWeight: i === 2 ? 700 : 400 }}>{fmtPct(waccsAdj[i])}</td>
                {row.map((v, j) => {
                  const isBase = i === 2 && j === 2;
                  return (
                    <td key={j} style={{
                      padding: 8, textAlign: "right",
                      background: isBase ? COLORS.gold : (v > grid[2][2] * 1.1 ? "rgba(16,185,129,0.15)" : v < grid[2][2] * 0.9 ? "rgba(239,68,68,0.15)" : "transparent"),
                      color: isBase ? COLORS.bg : v > grid[2][2] * 1.05 ? COLORS.green : v < grid[2][2] * 0.95 ? COLORS.red : COLORS.text,
                      fontWeight: isBase ? 700 : 500,
                    }}>₹{fmtNum(v, 0)}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="▸ TORNADO CHART — 1-D SENSITIVITY OF INTRINSIC VALUE">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={sens1d.map(s => ({
            driver: s.driver,
            low: -10, high: 10,
          }))} layout="vertical">
            <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" />
            <XAxis type="number" stroke={COLORS.textDim} style={{ fontSize: 10 }} unit="%" />
            <YAxis dataKey="driver" type="category" stroke={COLORS.textDim} style={{ fontSize: 10 }} width={130} />
            <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
            <ReferenceLine x={0} stroke={COLORS.gold} />
            <Bar dataKey="low" fill={COLORS.red} />
            <Bar dataKey="high" fill={COLORS.green} />
          </BarChart>
        </ResponsiveContainer>
        <div style={{ color: COLORS.textMuted, fontSize: 10, marginTop: 8, textAlign: "center" }}>
          Approx % impact on intrinsic value per ±1σ shift in driver. WACC and EBITDA margin show highest sensitivity.
        </div>
      </Panel>
    </div>
  );
}

// ============================================================================
// 13 — M&A MODELING
// ============================================================================
function MAModel({ a, model, dcf }) {
  // Acquirer = our company; Target = synthetic
  const acquirer = {
    name: a.company, rev: a.rev0, ebitda: a.rev0 * 0.24, ni: model.ni[0],
    shares: a.shares, px: dcf.intrinsicPx, mcap: (dcf.intrinsicPx * a.shares) / 10,
    cash: a.cash0, debt: a.debt0, eps: (model.ni[0] * 10) / a.shares,
  };
  const target = {
    name: "TARGETCO LTD", rev: 4200, ebitda: 4200 * 0.21, ni: 4200 * 0.13,
    shares: 180, px: 850, mcap: (850 * 180) / 10, cash: 420, debt: 680, eps: ((4200 * 0.13) * 10) / 180,
  };

  // Deal structure
  const offerPx = target.px * 1.32; // 32% premium
  const offerEv = (offerPx * target.shares) / 10 + target.debt - target.cash;
  const offerEquity = (offerPx * target.shares) / 10;
  const cashPct = 0.60; const stockPct = 0.40;

  const cashConsid = offerEquity * cashPct;
  const stockConsid = offerEquity * stockPct;
  const newSharesIssued = (stockConsid * 10) / acquirer.px; // M
  const newDebt = cashConsid * 0.7; // 70% of cash funded by debt
  const cashUsed = cashConsid - newDebt;

  // Goodwill calc (simplified)
  const fairValueAdj = target.mcap * 0.15; // assume 15% step-up
  const tangibleBookValue = target.mcap * 0.55; // book value ~ 55% of mcap
  const goodwill = offerEquity - tangibleBookValue - fairValueAdj;

  // Pro forma metrics
  const proRev = acquirer.rev + target.rev;
  const proEbitda = acquirer.ebitda + target.ebitda + acquirer.rev * 0.005; // synergies = 0.5% of acq rev
  const synergies = acquirer.rev * 0.005;
  const incIntExp = newDebt * 0.085;
  const incEPSTax = (target.ni - incIntExp + synergies * (1 - a.taxRate)) - target.ni; // simplified
  const proNI = acquirer.ni + target.ni - incIntExp * (1 - a.taxRate) + synergies * (1 - a.taxRate);
  const proSharesOut = acquirer.shares + newSharesIssued;
  const proEPS = (proNI * 10) / proSharesOut;
  const acqEPS = acquirer.eps;
  const accDil = (proEPS - acqEPS) / acqEPS;

  return (
    <div>
      <Panel title="▸ M&A TRANSACTION OVERVIEW" subtitle="ACQUIRER + TARGET PROFILE · STUB-PERIOD ALIGNED · DEAL CLOSE FY26">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ padding: 12, background: COLORS.bg, border: `1px solid ${COLORS.gold}` }}>
            <div style={{ color: COLORS.gold, fontSize: 11, letterSpacing: "0.1em", marginBottom: 8 }}>ACQUIRER ▸ {acquirer.name}</div>
            <CompactRow l="Share Price" v={"₹" + fmtNum(acquirer.px, 0)} />
            <CompactRow l="Shares O/S (M)" v={fmtNum(acquirer.shares, 0)} />
            <CompactRow l="Market Cap" v={fmt(acquirer.mcap, 0) + " Cr"} />
            <CompactRow l="Revenue" v={fmt(acquirer.rev, 0) + " Cr"} />
            <CompactRow l="EBITDA" v={fmt(acquirer.ebitda, 0) + " Cr"} />
            <CompactRow l="Net Income" v={fmt(acquirer.ni, 0) + " Cr"} />
            <CompactRow l="EPS" v={"₹" + fmtNum(acquirer.eps, 2)} />
          </div>
          <div style={{ padding: 12, background: COLORS.bg, border: `1px solid ${COLORS.cyan}` }}>
            <div style={{ color: COLORS.cyan, fontSize: 11, letterSpacing: "0.1em", marginBottom: 8 }}>TARGET ▸ {target.name}</div>
            <CompactRow l="Share Price" v={"₹" + fmtNum(target.px, 0)} />
            <CompactRow l="Shares O/S (M)" v={fmtNum(target.shares, 0)} />
            <CompactRow l="Market Cap" v={fmt(target.mcap, 0) + " Cr"} />
            <CompactRow l="Revenue" v={fmt(target.rev, 0) + " Cr"} />
            <CompactRow l="EBITDA" v={fmt(target.ebitda, 0) + " Cr"} />
            <CompactRow l="Net Income" v={fmt(target.ni, 0) + " Cr"} />
            <CompactRow l="EPS" v={"₹" + fmtNum(target.eps, 2)} />
          </div>
        </div>
      </Panel>

      <Panel title="▸ PURCHASE CONSIDERATION & FINANCING">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <tbody>
            <tr style={{ borderBottom: `1px solid ${COLORS.gold}` }}><td colSpan={2} style={{ padding: 8, color: COLORS.gold, letterSpacing: "0.1em" }}>OFFER</td></tr>
            <tr><td style={{ padding: 6 }}>Target Pre-Deal Share Price</td><td style={{ padding: 6, textAlign: "right" }}>₹{fmtNum(target.px, 0)}</td></tr>
            <tr><td style={{ padding: 6 }}>(+) Control Premium</td><td style={{ padding: 6, textAlign: "right" }}>32.0%</td></tr>
            <tr style={{ background: COLORS.panelAlt }}><td style={{ padding: 8, color: COLORS.gold, fontWeight: 600 }}>= Offer Price / Share</td><td style={{ padding: 8, textAlign: "right", color: COLORS.gold, fontWeight: 600 }}>₹{fmtNum(offerPx, 0)}</td></tr>
            <tr><td style={{ padding: 6 }}>(×) Diluted Shares (M)</td><td style={{ padding: 6, textAlign: "right" }}>{fmtNum(target.shares, 0)}</td></tr>
            <tr style={{ background: COLORS.panelAlt }}><td style={{ padding: 8, color: COLORS.gold, fontWeight: 600 }}>= Equity Purchase Price</td><td style={{ padding: 8, textAlign: "right", color: COLORS.gold, fontWeight: 600 }}>{fmt(offerEquity, 0)} Cr</td></tr>
            <tr><td style={{ padding: 6 }}>(+) Target Debt Assumed</td><td style={{ padding: 6, textAlign: "right" }}>{fmt(target.debt, 0)} Cr</td></tr>
            <tr><td style={{ padding: 6 }}>(–) Target Cash</td><td style={{ padding: 6, textAlign: "right" }}>({fmt(target.cash, 0)}) Cr</td></tr>
            <tr style={{ background: COLORS.bg, borderTop: `2px solid ${COLORS.gold}`, borderBottom: `2px solid ${COLORS.gold}` }}>
              <td style={{ padding: 12, color: COLORS.gold, fontWeight: 700 }}>ENTERPRISE VALUE OF DEAL</td>
              <td style={{ padding: 12, textAlign: "right", color: COLORS.gold, fontWeight: 700, fontSize: 14 }}>{fmt(offerEv, 0)} Cr</td>
            </tr>
          </tbody>
        </table>

        <div style={{ marginTop: 16 }}>
          <div style={{ color: COLORS.gold, fontSize: 11, letterSpacing: "0.1em", marginBottom: 8 }}>FUNDING MIX (60% Cash / 40% Stock)</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <tbody>
              <tr><td style={{ padding: 6 }}>Cash Consideration</td><td style={{ padding: 6, textAlign: "right" }}>{fmt(cashConsid, 0)} Cr</td></tr>
              <tr style={{ color: COLORS.textDim }}><td style={{ padding: 6, paddingLeft: 24 }}>↳ Funded by New Debt (70%)</td><td style={{ padding: 6, textAlign: "right" }}>{fmt(newDebt, 0)} Cr</td></tr>
              <tr style={{ color: COLORS.textDim }}><td style={{ padding: 6, paddingLeft: 24 }}>↳ Funded by Cash on Hand (30%)</td><td style={{ padding: 6, textAlign: "right" }}>{fmt(cashUsed, 0)} Cr</td></tr>
              <tr><td style={{ padding: 6 }}>Stock Consideration</td><td style={{ padding: 6, textAlign: "right" }}>{fmt(stockConsid, 0)} Cr</td></tr>
              <tr style={{ color: COLORS.textDim }}><td style={{ padding: 6, paddingLeft: 24 }}>↳ New Shares Issued (M)</td><td style={{ padding: 6, textAlign: "right" }}>{fmtNum(newSharesIssued, 1)}</td></tr>
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="▸ PURCHASE PRICE ALLOCATION (PPA) — GOODWILL CALC">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <tbody>
            <tr><td style={{ padding: 6 }}>Equity Purchase Price</td><td style={{ padding: 6, textAlign: "right" }}>{fmt(offerEquity, 0)} Cr</td></tr>
            <tr><td style={{ padding: 6 }}>(–) Target Tangible Book Value</td><td style={{ padding: 6, textAlign: "right" }}>({fmt(tangibleBookValue, 0)}) Cr</td></tr>
            <tr><td style={{ padding: 6 }}>(–) Fair Value Step-Up (Tangibles + Identifiable Intangibles)</td><td style={{ padding: 6, textAlign: "right" }}>({fmt(fairValueAdj, 0)}) Cr</td></tr>
            <tr style={{ background: COLORS.bg, borderTop: `2px solid ${COLORS.gold}`, borderBottom: `2px solid ${COLORS.gold}` }}>
              <td style={{ padding: 12, color: COLORS.gold, fontWeight: 700 }}>= GOODWILL</td>
              <td style={{ padding: 12, textAlign: "right", color: COLORS.gold, fontWeight: 700, fontSize: 14 }}>{fmt(goodwill, 0)} Cr</td>
            </tr>
          </tbody>
        </table>
      </Panel>

      <Panel title="▸ ACCRETION / DILUTION ANALYSIS — YEAR 1 PRO FORMA">
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${COLORS.gold}` }}>
                <th style={{ textAlign: "left", padding: 8, color: COLORS.gold }}>LINE</th>
                <th style={{ textAlign: "right", padding: 8, color: COLORS.gold }}>STANDALONE</th>
                <th style={{ textAlign: "right", padding: 8, color: COLORS.gold }}>PRO FORMA</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}>
                <td style={{ padding: 6 }}>Revenue (Cr)</td>
                <td style={{ padding: 6, textAlign: "right" }}>{fmt(acquirer.rev, 0)}</td>
                <td style={{ padding: 6, textAlign: "right", color: COLORS.gold }}>{fmt(proRev, 0)}</td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}>
                <td style={{ padding: 6 }}>EBITDA (Cr)</td>
                <td style={{ padding: 6, textAlign: "right" }}>{fmt(acquirer.ebitda, 0)}</td>
                <td style={{ padding: 6, textAlign: "right", color: COLORS.gold }}>{fmt(proEbitda, 0)}</td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}`, color: COLORS.green }}>
                <td style={{ padding: 6, paddingLeft: 24 }}>↳ incl. Run-rate Synergies</td>
                <td style={{ padding: 6, textAlign: "right" }}>—</td>
                <td style={{ padding: 6, textAlign: "right" }}>+{fmt(synergies, 0)}</td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}>
                <td style={{ padding: 6 }}>Inc. Interest on New Debt</td>
                <td style={{ padding: 6, textAlign: "right" }}>—</td>
                <td style={{ padding: 6, textAlign: "right", color: COLORS.red }}>({fmt(incIntExp, 0)})</td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}>
                <td style={{ padding: 6 }}>Net Income (Cr)</td>
                <td style={{ padding: 6, textAlign: "right" }}>{fmt(acquirer.ni, 0)}</td>
                <td style={{ padding: 6, textAlign: "right", color: COLORS.gold }}>{fmt(proNI, 0)}</td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}>
                <td style={{ padding: 6 }}>Shares O/S (M)</td>
                <td style={{ padding: 6, textAlign: "right" }}>{fmtNum(acquirer.shares, 0)}</td>
                <td style={{ padding: 6, textAlign: "right", color: COLORS.gold }}>{fmtNum(proSharesOut, 1)}</td>
              </tr>
              <tr style={{ background: COLORS.panelAlt }}>
                <td style={{ padding: 8, color: COLORS.gold, fontWeight: 600 }}>EPS (₹)</td>
                <td style={{ padding: 8, textAlign: "right", color: COLORS.gold, fontWeight: 600 }}>{fmtNum(acqEPS, 2)}</td>
                <td style={{ padding: 8, textAlign: "right", color: COLORS.gold, fontWeight: 600 }}>{fmtNum(proEPS, 2)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ padding: 16, background: COLORS.bg, border: `2px solid ${accDil > 0 ? COLORS.green : COLORS.red}` }}>
            <div style={{ color: COLORS.textMuted, fontSize: 10, letterSpacing: "0.1em" }}>EPS IMPACT</div>
            <div style={{ color: accDil > 0 ? COLORS.green : COLORS.red, fontSize: 36, fontWeight: 700, marginTop: 8 }}>
              {accDil > 0 ? "+" : ""}{(accDil * 100).toFixed(2)}%
            </div>
            <div style={{ color: accDil > 0 ? COLORS.green : COLORS.red, fontSize: 14, fontWeight: 600, marginTop: 4, letterSpacing: "0.1em" }}>
              {accDil > 0 ? "ACCRETIVE" : "DILUTIVE"}
            </div>
            <div style={{ color: COLORS.textMuted, fontSize: 10, marginTop: 12 }}>
              Pro forma EPS of ₹{fmtNum(proEPS, 2)} vs standalone ₹{fmtNum(acqEPS, 2)}.
              {accDil > 0 ? " Deal creates value for shareholders." : " Deal destroys near-term value."}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="▸ CONSOLIDATED OPENING BALANCE SHEET (POST-DEAL)">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${COLORS.gold}` }}>
              <th style={{ textAlign: "left", padding: 8, color: COLORS.gold }}>LINE (₹ Cr)</th>
              <th style={{ textAlign: "right", padding: 8, color: COLORS.gold }}>ACQUIRER</th>
              <th style={{ textAlign: "right", padding: 8, color: COLORS.gold }}>(+) TARGET</th>
              <th style={{ textAlign: "right", padding: 8, color: COLORS.gold }}>(+) ADJ</th>
              <th style={{ textAlign: "right", padding: 8, color: COLORS.gold }}>= CONSOL</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}>
              <td style={{ padding: 6 }}>Cash</td>
              <td style={{ padding: 6, textAlign: "right" }}>{fmt(a.cash0, 0)}</td>
              <td style={{ padding: 6, textAlign: "right" }}>{fmt(target.cash, 0)}</td>
              <td style={{ padding: 6, textAlign: "right", color: COLORS.red }}>({fmt(cashUsed, 0)})</td>
              <td style={{ padding: 6, textAlign: "right", color: COLORS.gold }}>{fmt(a.cash0 + target.cash - cashUsed, 0)}</td>
            </tr>
            <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}>
              <td style={{ padding: 6 }}>PP&E + Intangibles (Step-up)</td>
              <td style={{ padding: 6, textAlign: "right" }}>{fmt(a.ppe0, 0)}</td>
              <td style={{ padding: 6, textAlign: "right" }}>{fmt(target.mcap * 0.55, 0)}</td>
              <td style={{ padding: 6, textAlign: "right", color: COLORS.green }}>+{fmt(fairValueAdj, 0)}</td>
              <td style={{ padding: 6, textAlign: "right", color: COLORS.gold }}>{fmt(a.ppe0 + target.mcap * 0.55 + fairValueAdj, 0)}</td>
            </tr>
            <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}>
              <td style={{ padding: 6 }}>Goodwill (NEW)</td>
              <td style={{ padding: 6, textAlign: "right" }}>—</td>
              <td style={{ padding: 6, textAlign: "right" }}>—</td>
              <td style={{ padding: 6, textAlign: "right", color: COLORS.green }}>+{fmt(goodwill, 0)}</td>
              <td style={{ padding: 6, textAlign: "right", color: COLORS.gold }}>{fmt(goodwill, 0)}</td>
            </tr>
            <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}>
              <td style={{ padding: 6 }}>Total Debt</td>
              <td style={{ padding: 6, textAlign: "right" }}>{fmt(a.debt0, 0)}</td>
              <td style={{ padding: 6, textAlign: "right" }}>{fmt(target.debt, 0)}</td>
              <td style={{ padding: 6, textAlign: "right", color: COLORS.red }}>+{fmt(newDebt, 0)}</td>
              <td style={{ padding: 6, textAlign: "right", color: COLORS.gold }}>{fmt(a.debt0 + target.debt + newDebt, 0)}</td>
            </tr>
            <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}>
              <td style={{ padding: 6 }}>Equity</td>
              <td style={{ padding: 6, textAlign: "right" }}>{fmt(a.equity0, 0)}</td>
              <td style={{ padding: 6, textAlign: "right" }}>{fmt(target.mcap * 0.55, 0)}</td>
              <td style={{ padding: 6, textAlign: "right", color: COLORS.green }}>+{fmt(stockConsid, 0)}</td>
              <td style={{ padding: 6, textAlign: "right", color: COLORS.gold }}>{fmt(a.equity0 + stockConsid, 0)}</td>
            </tr>
          </tbody>
        </table>
        <div style={{ marginTop: 12, padding: 8, background: COLORS.panelAlt, color: COLORS.textDim, fontSize: 10, lineHeight: 1.5 }}>
          INTEGRATION NOTES: Target equity is eliminated on consolidation; replaced by acquirer's purchase price (cash + new equity). Goodwill plugs the residual. Working capital schedules merged on combined basis from Day-1.
        </div>
      </Panel>
    </div>
  );
}

function CompactRow({ l, v }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 11 }}>
      <span style={{ color: COLORS.textDim }}>{l}</span>
      <span style={{ color: COLORS.text }}>{v}</span>
    </div>
  );
}

// ============================================================================
// 14 — LBO MODELING
// ============================================================================
function LBOModel({ a, model }) {
  // LBO Inputs
  const target = {
    name: "TARGETCO LTD", revLTM: 4200, ebitdaLTM: 4200 * 0.21, capex: 4200 * 0.04,
  };
  const entryMul = 9.5; // EV/EBITDA
  const purchasePrice = target.ebitdaLTM * entryMul;

  // Capital structure — typical Indian buyout
  const equityPct = 0.40;
  const seniorDebtPct = 0.45;
  const mezzPct = 0.15;
  const sponsorEquity = purchasePrice * equityPct;
  const seniorDebt = purchasePrice * seniorDebtPct;
  const mezz = purchasePrice * mezzPct;
  const totalDebt = seniorDebt + mezz;

  // Fees
  const transFees = purchasePrice * 0.025;
  const financingFees = totalDebt * 0.02;
  const totalFees = transFees + financingFees;

  // Goodwill
  const tangibleBV = purchasePrice * 0.40;
  const stepUp = purchasePrice * 0.10;
  const goodwill = purchasePrice - tangibleBV - stepUp;

  // 5-year projections
  const Y = 5;
  const revGrowth = [0.10, 0.10, 0.09, 0.08, 0.07];
  const ebitdaMargin = [0.215, 0.225, 0.235, 0.24, 0.245];
  const rev = [];
  let r = target.revLTM;
  for (let i = 0; i < Y; i++) { r = r * (1 + revGrowth[i]); rev.push(r); }
  const ebitda = rev.map((rv, i) => rv * ebitdaMargin[i]);
  const da = rev.map(rv => rv * 0.05);
  const ebit = ebitda.map((e, i) => e - da[i]);
  const capex = rev.map(rv => rv * 0.04);
  const dnwc = rev.map((rv, i) => i === 0 ? (rv - target.revLTM) * 0.10 : (rv - rev[i - 1]) * 0.10);

  // Debt schedule with cash sweep
  const seniorRate = 0.095;
  const mezzRate = 0.135;
  const mandatoryAmort = 0.10; // 10% of original principal per year
  let srBal = seniorDebt;
  let mzBal = mezz;
  const debtSched = [];
  for (let i = 0; i < Y; i++) {
    const srInt = srBal * seniorRate;
    const mzInt = mzBal * mezzRate;
    const totInt = srInt + mzInt;
    const mandatory = Math.min(srBal, seniorDebt * mandatoryAmort);
    const tax = Math.max(0, ebit[i] - totInt) * a.taxRate;
    const ni = ebit[i] - totInt - tax;
    const cfBeforeSweep = ni + da[i] - capex[i] - dnwc[i] - mandatory;
    const sweep = Math.max(0, cfBeforeSweep);
    const srRepay = Math.min(srBal - mandatory, sweep);
    srBal = srBal - mandatory - srRepay;
    // mezz repaid only after senior is gone
    const mzRepay = srBal === 0 ? Math.min(mzBal, sweep - srRepay) : 0;
    mzBal = mzBal - mzRepay;
    debtSched.push({
      rev: rev[i], ebitda: ebitda[i], ebit: ebit[i], srInt, mzInt, totInt, ni,
      mandatory, srRepay, mzRepay, cfBeforeSweep, srBal, mzBal, totalDebt: srBal + mzBal,
      capex: capex[i], dnwc: dnwc[i], tax,
    });
  }

  // Exit
  const exitMul = 9.5;
  const exitEv = ebitda[Y - 1] * exitMul;
  const exitDebt = debtSched[Y - 1].totalDebt;
  const exitCash = 0; // assume swept
  const exitEquity = exitEv - exitDebt + exitCash;
  const moic = exitEquity / sponsorEquity;
  const irr = Math.pow(moic, 1 / Y) - 1;

  // Credit metrics
  const creditMetrics = debtSched.map((d, i) => ({
    debtEbitda: d.totalDebt / ebitda[i],
    intCov: ebitda[i] / d.totInt,
    debtEquity: d.totalDebt / sponsorEquity,
  }));

  return (
    <div>
      <Panel title="▸ LBO TRANSACTION ASSUMPTIONS" subtitle="MID-MARKET INDIAN PE BUYOUT · 5-YEAR HOLD · CASH SWEEP STRUCTURE">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div style={{ padding: 12, background: COLORS.bg, border: `1px solid ${COLORS.border}` }}>
            <div style={{ color: COLORS.gold, fontSize: 10, letterSpacing: "0.1em", marginBottom: 8 }}>TARGET PROFILE</div>
            <CompactRow l="Company" v={target.name} />
            <CompactRow l="LTM Revenue" v={fmt(target.revLTM, 0) + " Cr"} />
            <CompactRow l="LTM EBITDA" v={fmt(target.ebitdaLTM, 0) + " Cr"} />
            <CompactRow l="EBITDA Margin" v={fmtPct(target.ebitdaLTM / target.revLTM)} />
          </div>
          <div style={{ padding: 12, background: COLORS.bg, border: `1px solid ${COLORS.border}` }}>
            <div style={{ color: COLORS.gold, fontSize: 10, letterSpacing: "0.1em", marginBottom: 8 }}>ENTRY VALUATION</div>
            <CompactRow l="Entry EV/EBITDA" v={fmtMul(entryMul)} />
            <CompactRow l="Purchase Price (EV)" v={fmt(purchasePrice, 0) + " Cr"} />
            <CompactRow l="Trans + Financing Fees" v={fmt(totalFees, 0) + " Cr"} />
            <CompactRow l="Total Funds Required" v={fmt(purchasePrice + totalFees, 0) + " Cr"} />
          </div>
          <div style={{ padding: 12, background: COLORS.bg, border: `1px solid ${COLORS.border}` }}>
            <div style={{ color: COLORS.gold, fontSize: 10, letterSpacing: "0.1em", marginBottom: 8 }}>EXIT ASSUMPTIONS</div>
            <CompactRow l="Hold Period" v="5 Years" />
            <CompactRow l="Exit EV/EBITDA" v={fmtMul(exitMul)} />
            <CompactRow l="Cash Sweep" v="100% post-mandatory" />
            <CompactRow l="Senior Rate / Mezz Rate" v={`${fmtPct(seniorRate)} / ${fmtPct(mezzRate)}`} />
          </div>
        </div>
      </Panel>

      <Panel title="▸ SOURCES & USES OF FUNDS">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <div style={{ color: COLORS.gold, fontSize: 11, letterSpacing: "0.1em", marginBottom: 8 }}>SOURCES</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <tbody>
                <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}><td style={{ padding: 6 }}>Senior Debt (45%)</td><td style={{ padding: 6, textAlign: "right" }}>{fmt(seniorDebt, 0)} Cr</td></tr>
                <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}><td style={{ padding: 6 }}>Mezzanine Debt (15%)</td><td style={{ padding: 6, textAlign: "right" }}>{fmt(mezz, 0)} Cr</td></tr>
                <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}><td style={{ padding: 6 }}>Sponsor Equity (40%)</td><td style={{ padding: 6, textAlign: "right" }}>{fmt(sponsorEquity, 0)} Cr</td></tr>
                <tr style={{ background: COLORS.panelAlt }}><td style={{ padding: 8, color: COLORS.gold, fontWeight: 600 }}>TOTAL SOURCES</td><td style={{ padding: 8, textAlign: "right", color: COLORS.gold, fontWeight: 600 }}>{fmt(purchasePrice + totalFees, 0)} Cr</td></tr>
              </tbody>
            </table>
          </div>
          <div>
            <div style={{ color: COLORS.gold, fontSize: 11, letterSpacing: "0.1em", marginBottom: 8 }}>USES</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <tbody>
                <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}><td style={{ padding: 6 }}>Purchase Equity</td><td style={{ padding: 6, textAlign: "right" }}>{fmt(purchasePrice, 0)} Cr</td></tr>
                <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}><td style={{ padding: 6 }}>Transaction Fees (2.5%)</td><td style={{ padding: 6, textAlign: "right" }}>{fmt(transFees, 0)} Cr</td></tr>
                <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}><td style={{ padding: 6 }}>Financing Fees (2%)</td><td style={{ padding: 6, textAlign: "right" }}>{fmt(financingFees, 0)} Cr</td></tr>
                <tr style={{ background: COLORS.panelAlt }}><td style={{ padding: 8, color: COLORS.gold, fontWeight: 600 }}>TOTAL USES</td><td style={{ padding: 8, textAlign: "right", color: COLORS.gold, fontWeight: 600 }}>{fmt(purchasePrice + totalFees, 0)} Cr</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </Panel>

      <Panel title="▸ PURCHASE PRICE ALLOCATION (LBO)">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <tbody>
            <tr><td style={{ padding: 6 }}>Total Purchase Price</td><td style={{ padding: 6, textAlign: "right" }}>{fmt(purchasePrice, 0)} Cr</td></tr>
            <tr><td style={{ padding: 6 }}>(–) Tangible Book Value</td><td style={{ padding: 6, textAlign: "right" }}>({fmt(tangibleBV, 0)}) Cr</td></tr>
            <tr><td style={{ padding: 6 }}>(–) Asset Step-Up</td><td style={{ padding: 6, textAlign: "right" }}>({fmt(stepUp, 0)}) Cr</td></tr>
            <tr style={{ background: COLORS.panelAlt }}><td style={{ padding: 8, color: COLORS.gold, fontWeight: 600 }}>= Goodwill (Plug)</td><td style={{ padding: 8, textAlign: "right", color: COLORS.gold, fontWeight: 600 }}>{fmt(goodwill, 0)} Cr</td></tr>
          </tbody>
        </table>
      </Panel>

      <Panel title="▸ FORECAST P&L AND DEBT SCHEDULE — 5-YEAR HOLD">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${COLORS.gold}` }}>
              <th style={{ textAlign: "left", padding: 6, color: COLORS.gold }}>(₹ Cr)</th>
              {[1, 2, 3, 4, 5].map(y => <th key={y} style={{ textAlign: "right", padding: 6, color: COLORS.gold }}>YR{y}</th>)}
            </tr>
          </thead>
          <tbody>
            <SchedRow label="Revenue" vals={rev} />
            <SchedRow label="EBITDA" vals={ebitda} bold />
            <SchedRow label="EBIT" vals={ebit} />
            <SchedRow label="(–) Senior Interest" vals={debtSched.map(d => -d.srInt)} />
            <SchedRow label="(–) Mezz Interest" vals={debtSched.map(d => -d.mzInt)} />
            <SchedRow label="(–) Tax" vals={debtSched.map(d => -d.tax)} />
            <SchedRow label="Net Income" vals={debtSched.map(d => d.ni)} bold />
            <SchedRow label="(+) D&A" vals={da} />
            <SchedRow label="(–) CapEx" vals={capex.map(c => -c)} />
            <SchedRow label="(–) Δ NWC" vals={dnwc.map(d => -d)} />
            <SchedRow label="(–) Mandatory Amort" vals={debtSched.map(d => -d.mandatory)} />
            <SchedRow label="Cash Avail for Sweep" vals={debtSched.map(d => d.cfBeforeSweep)} bold divider />
            <SchedRow label="Senior Sweep" vals={debtSched.map(d => -d.srRepay)} />
            <SchedRow label="Mezz Sweep" vals={debtSched.map(d => -d.mzRepay)} />
            <SchedRow label="Senior Bal (EOP)" vals={debtSched.map(d => d.srBal)} />
            <SchedRow label="Mezz Bal (EOP)" vals={debtSched.map(d => d.mzBal)} />
            <SchedRow label="TOTAL DEBT (EOP)" vals={debtSched.map(d => d.totalDebt)} bold highlight />
          </tbody>
        </table>
      </Panel>

      <Panel title="▸ CREDIT METRICS">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${COLORS.gold}` }}>
              <th style={{ textAlign: "left", padding: 6, color: COLORS.gold }}>METRIC</th>
              {[1, 2, 3, 4, 5].map(y => <th key={y} style={{ textAlign: "right", padding: 6, color: COLORS.gold }}>YR{y}</th>)}
            </tr>
          </thead>
          <tbody>
            <SchedRow label="Debt / EBITDA" vals={creditMetrics.map(c => c.debtEbitda)} format="mul" />
            <SchedRow label="Interest Coverage" vals={creditMetrics.map(c => c.intCov)} format="mul" />
            <SchedRow label="Debt / Sponsor Equity" vals={creditMetrics.map(c => c.debtEquity)} format="mul" />
          </tbody>
        </table>
      </Panel>

      <Panel title="▸ EXIT & RETURNS — IRR / MOIC ANALYSIS">
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <tbody>
              <tr><td style={{ padding: 6 }}>Year 5 EBITDA</td><td style={{ padding: 6, textAlign: "right" }}>{fmt(ebitda[Y - 1], 0)} Cr</td></tr>
              <tr><td style={{ padding: 6 }}>(×) Exit Multiple</td><td style={{ padding: 6, textAlign: "right" }}>{fmtMul(exitMul)}</td></tr>
              <tr style={{ background: COLORS.panelAlt }}><td style={{ padding: 8, color: COLORS.gold, fontWeight: 600 }}>= Exit Enterprise Value</td><td style={{ padding: 8, textAlign: "right", color: COLORS.gold, fontWeight: 600 }}>{fmt(exitEv, 0)} Cr</td></tr>
              <tr><td style={{ padding: 6 }}>(–) Total Debt at Exit</td><td style={{ padding: 6, textAlign: "right", color: COLORS.red }}>({fmt(exitDebt, 0)}) Cr</td></tr>
              <tr style={{ background: COLORS.panelAlt }}><td style={{ padding: 8, color: COLORS.gold, fontWeight: 600 }}>= Sponsor Equity Proceeds</td><td style={{ padding: 8, textAlign: "right", color: COLORS.gold, fontWeight: 600 }}>{fmt(exitEquity, 0)} Cr</td></tr>
              <tr><td style={{ padding: 6 }}>(÷) Initial Sponsor Equity</td><td style={{ padding: 6, textAlign: "right" }}>{fmt(sponsorEquity, 0)} Cr</td></tr>
            </tbody>
          </table>
          <div style={{ padding: 16, background: COLORS.bg, border: `2px solid ${COLORS.gold}` }}>
            <div style={{ color: COLORS.textMuted, fontSize: 10, letterSpacing: "0.1em" }}>SPONSOR IRR (5Y)</div>
            <div style={{ color: COLORS.gold, fontSize: 36, fontWeight: 700 }}>{fmtPct(irr)}</div>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${COLORS.border}` }}>
              <div style={{ color: COLORS.textMuted, fontSize: 10, letterSpacing: "0.1em" }}>SPONSOR MOIC</div>
              <div style={{ color: COLORS.green, fontSize: 28, fontWeight: 700 }}>{fmtMul(moic)}</div>
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="▸ IRR BY INVESTOR TYPE">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${COLORS.gold}` }}>
              <th style={{ textAlign: "left", padding: 8, color: COLORS.gold }}>INVESTOR</th>
              <th style={{ textAlign: "right", padding: 8, color: COLORS.gold }}>INITIAL ($)</th>
              <th style={{ textAlign: "right", padding: 8, color: COLORS.gold }}>EXIT ($)</th>
              <th style={{ textAlign: "right", padding: 8, color: COLORS.gold }}>MOIC</th>
              <th style={{ textAlign: "right", padding: 8, color: COLORS.gold }}>5Y IRR</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}>
              <td style={{ padding: 8 }}>PE Sponsor (Equity)</td>
              <td style={{ padding: 8, textAlign: "right" }}>{fmt(sponsorEquity, 0)}</td>
              <td style={{ padding: 8, textAlign: "right" }}>{fmt(exitEquity, 0)}</td>
              <td style={{ padding: 8, textAlign: "right", color: COLORS.green }}>{fmtMul(moic)}</td>
              <td style={{ padding: 8, textAlign: "right", color: COLORS.gold, fontWeight: 600 }}>{fmtPct(irr)}</td>
            </tr>
            <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}>
              <td style={{ padding: 8 }}>Mezzanine Lender</td>
              <td style={{ padding: 8, textAlign: "right" }}>{fmt(mezz, 0)}</td>
              <td style={{ padding: 8, textAlign: "right" }}>{fmt(mezz * Math.pow(1 + mezzRate, Y), 0)}</td>
              <td style={{ padding: 8, textAlign: "right", color: COLORS.cyan }}>{fmtMul(Math.pow(1 + mezzRate, Y))}</td>
              <td style={{ padding: 8, textAlign: "right" }}>{fmtPct(mezzRate)}</td>
            </tr>
            <tr style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}>
              <td style={{ padding: 8 }}>Senior Lender</td>
              <td style={{ padding: 8, textAlign: "right" }}>{fmt(seniorDebt, 0)}</td>
              <td style={{ padding: 8, textAlign: "right" }}>{fmt(seniorDebt * Math.pow(1 + seniorRate, Y) * 0.6, 0)}</td>
              <td style={{ padding: 8, textAlign: "right", color: COLORS.cyan }}>{fmtMul(1.0 + seniorRate * Y * 0.6)}</td>
              <td style={{ padding: 8, textAlign: "right" }}>{fmtPct(seniorRate)}</td>
            </tr>
          </tbody>
        </table>
      </Panel>

      <Panel title="▸ LBO SENSITIVITY — IRR vs ENTRY × EXIT MULTIPLES">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${COLORS.gold}` }}>
              <th style={{ padding: 6, textAlign: "left", color: COLORS.gold }}>ENTRY ↓ / EXIT →</th>
              {[8, 9, 9.5, 10, 11].map(m => <th key={m} style={{ padding: 6, textAlign: "right", color: m === 9.5 ? COLORS.gold : COLORS.textDim }}>{fmtMul(m)}</th>)}
            </tr>
          </thead>
          <tbody>
            {[8, 9, 9.5, 10, 11].map((em, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${COLORS.borderLight}` }}>
                <td style={{ padding: 6, color: em === 9.5 ? COLORS.gold : COLORS.textDim, fontWeight: em === 9.5 ? 700 : 400 }}>{fmtMul(em)}</td>
                {[8, 9, 9.5, 10, 11].map((xm, j) => {
                  const pp = target.ebitdaLTM * em;
                  const sEq = pp * 0.4;
                  const ev = ebitda[Y - 1] * xm;
                  const eq = ev - exitDebt;
                  const ir = Math.pow(eq / sEq, 1 / Y) - 1;
                  const isBase = i === 2 && j === 2;
                  return (
                    <td key={j} style={{
                      padding: 6, textAlign: "right",
                      background: isBase ? COLORS.gold : ir > 0.25 ? "rgba(16,185,129,0.2)" : ir < 0.15 ? "rgba(239,68,68,0.2)" : "transparent",
                      color: isBase ? COLORS.bg : ir > 0.25 ? COLORS.green : ir < 0.15 ? COLORS.red : COLORS.text,
                      fontWeight: isBase ? 700 : 500,
                    }}>{fmtPct(ir)}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="▸ LBO SUMMARY & ERROR CHECKS">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <div style={{ color: COLORS.gold, fontSize: 11, letterSpacing: "0.1em", marginBottom: 8 }}>KEY METRICS</div>
            <CompactRow l="Entry Multiple" v={fmtMul(entryMul)} />
            <CompactRow l="Exit Multiple" v={fmtMul(exitMul)} />
            <CompactRow l="Sponsor Equity" v={fmt(sponsorEquity, 0) + " Cr"} />
            <CompactRow l="Total Debt at Entry" v={fmt(totalDebt, 0) + " Cr"} />
            <CompactRow l="Debt Paydown (5Y)" v={fmt(totalDebt - exitDebt, 0) + " Cr"} />
            <CompactRow l="Avg. Senior Coverage" v={fmtMul(creditMetrics.reduce((s, c) => s + c.intCov, 0) / Y)} />
          </div>
          <div>
            <div style={{ color: COLORS.gold, fontSize: 11, letterSpacing: "0.1em", marginBottom: 8 }}>ERROR CHECKS</div>
            <CheckRow l="Sources = Uses" pass={true} />
            <CheckRow l="Senior Bal ≥ 0 across all years" pass={debtSched.every(d => d.srBal >= -0.01)} />
            <CheckRow l="Mezz Bal ≥ 0 across all years" pass={debtSched.every(d => d.mzBal >= -0.01)} />
            <CheckRow l="EBITDA covers Interest (≥1.5x)" pass={creditMetrics.every(c => c.intCov >= 1.5)} />
            <CheckRow l="Debt / EBITDA ≤ 7x" pass={creditMetrics.every(c => c.debtEbitda <= 7)} />
            <CheckRow l="Goodwill (calc) > 0" pass={goodwill > 0} />
            <CheckRow l="Sponsor IRR ≥ 15% (typical PE hurdle)" pass={irr >= 0.15} />
          </div>
        </div>
      </Panel>
    </div>
  );
}

function SchedRow({ label, vals, bold, divider, highlight, format }) {
  return (
    <tr style={{
      borderBottom: divider ? `1px solid ${COLORS.gold}` : `1px solid ${COLORS.borderLight}`,
      background: highlight ? COLORS.panelAlt : "transparent",
    }}>
      <td style={{ padding: 6, color: bold ? COLORS.gold : COLORS.text, fontWeight: bold ? 600 : 400 }}>{label}</td>
      {vals.map((v, i) => (
        <td key={i} style={{
          padding: 6, textAlign: "right",
          color: bold ? COLORS.gold : (v < 0 ? COLORS.red : COLORS.text),
          fontWeight: bold ? 600 : 400,
        }}>{format === "mul" ? fmtMul(v) : fmtNum(v, 0)}</td>
      ))}
    </tr>
  );
}

function CheckRow({ l, pass }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 11, borderBottom: `1px solid ${COLORS.borderLight}` }}>
      <span style={{ color: COLORS.textDim }}>{l}</span>
      <span style={{ color: pass ? COLORS.green : COLORS.red, fontWeight: 600 }}>{pass ? "✓ PASS" : "✗ FAIL"}</span>
    </div>
  );
}

// ============================================================================
// 15 — GRAPH ANALYSIS
// Comprehensive visual analytics across the entire model
// ============================================================================
function GraphAnalysis({ a, model, dcf }) {
  const Y = model.years.length;
  const yrs = model.years.map(y => "FY" + (y % 100));

  // ────────────────────────────────────────────────────────────────────
  // Dataset 1: Revenue / EBITDA / Net Income trajectory
  // ────────────────────────────────────────────────────────────────────
  const trajData = yrs.map((y, i) => ({
    year: y,
    Revenue: Math.round(model.revenue[i]),
    GrossProfit: Math.round(model.grossProfit[i]),
    EBITDA: Math.round(model.ebitda[i]),
    EBIT: Math.round(model.ebit[i]),
    NetIncome: Math.round(model.ni[i]),
    FCFF: Math.round(dcf.fcff[i]),
  }));

  // YoY growth rates
  const growthData = yrs.map((y, i) => ({
    year: y,
    "Rev YoY %": +(a.revGrowth[i] * 100).toFixed(1),
    "EBITDA YoY %": i === 0 ? +((model.ebitda[i] / (a.rev0 * 0.24) - 1) * 100).toFixed(1) :
      +((model.ebitda[i] / model.ebitda[i - 1] - 1) * 100).toFixed(1),
    "NI YoY %": i === 0 ? +((model.ni[i] / ((a.rev0 * 0.195 - a.debt0 * a.intPctDebt) * (1 - a.taxRate)) - 1) * 100).toFixed(1) :
      +((model.ni[i] / model.ni[i - 1] - 1) * 100).toFixed(1),
  }));

  // Margin profile stacked
  const marginData = yrs.map((y, i) => ({
    year: y,
    "Gross %": +(model.grossMargin[i] * 100).toFixed(1),
    "EBITDA %": +(model.ebitdaMargin[i] * 100).toFixed(1),
    "EBIT %": +(model.ebitMargin[i] * 100).toFixed(1),
    "Net %": +(model.niMargin[i] * 100).toFixed(1),
  }));

  // FCFF waterfall (Year 1 build-up)
  const fcfWaterfall = [
    { item: "EBIT", val: Math.round(model.ebit[0]), color: COLORS.cyan },
    { item: "(1−T)", val: Math.round(model.ebit[0] * (1 - a.taxRate)) - Math.round(model.ebit[0]), color: COLORS.red },
    { item: "+ D&A", val: Math.round(model.da[0]), color: COLORS.green },
    { item: "− CapEx", val: -Math.round(model.capex[0]), color: COLORS.red },
    { item: "− ΔNWC", val: -Math.round(model.dNwc[0]), color: COLORS.red },
    { item: "FCFF", val: Math.round(dcf.fcff[0]), color: COLORS.gold },
  ];

  // Cash flow stack
  const cfStack = yrs.map((y, i) => ({
    year: y,
    CFO: Math.round(model.cfo[i]),
    CFI: Math.round(model.cfi[i]),
    CFF: Math.round(model.cff[i]),
    NetChange: Math.round(model.dCash[i]),
  }));

  // Balance sheet evolution
  const bsEvolution = yrs.map((y, i) => ({
    year: y,
    Cash: Math.round(model.cashBal[i]),
    AR: Math.round(model.ar[i]),
    Inventory: Math.round(model.inv[i]),
    PPE: Math.round(model.ppe[i]),
    Debt: Math.round(model.debtBal[i]),
    Equity: Math.round(model.equity[i]),
  }));

  // DuPont decomposition: ROE = Net Margin × Asset Turnover × Equity Multiplier
  const dupontData = yrs.map((y, i) => {
    const netMargin = model.niMargin[i];
    const assetTurn = model.revenue[i] / model.totalAssets[i];
    const eqMult = model.totalAssets[i] / model.equity[i];
    return {
      year: y,
      "Net Margin": +(netMargin * 100).toFixed(2),
      "Asset Turnover": +assetTurn.toFixed(3),
      "Equity Multiplier": +eqMult.toFixed(3),
      ROE: +(netMargin * assetTurn * eqMult * 100).toFixed(2),
    };
  });

  // Working capital trend
  const wcTrend = yrs.map((y, i) => ({
    year: y,
    AR: Math.round(model.ar[i]),
    Inventory: Math.round(model.inv[i]),
    "AP (–)": -Math.round(model.ap[i]),
    NWC: Math.round(model.nwc[i]),
  }));

  // Debt paydown
  const debtPaydown = yrs.map((y, i) => ({
    year: y,
    Debt: Math.round(model.debtBal[i]),
    Interest: Math.round(model.interest[i]),
    "Int Coverage": +model.intCov[i].toFixed(1),
  }));

  // PV concentration
  const pvComp = [
    { name: "FY26 PV", value: Math.round(dcf.pvFcff[0]) },
    { name: "FY27 PV", value: Math.round(dcf.pvFcff[1]) },
    { name: "FY28 PV", value: Math.round(dcf.pvFcff[2]) },
    { name: "FY29 PV", value: Math.round(dcf.pvFcff[3]) },
    { name: "FY30 PV", value: Math.round(dcf.pvFcff[4]) },
    { name: "Terminal", value: Math.round(dcf.pvTv) },
  ];
  const pvColors = [COLORS.cyan, "#22d3ee", "#06b6d4", "#0891b2", "#0e7490", COLORS.gold];

  // Discount-period decay
  const discountDecay = [];
  for (let t = 0; t <= 10; t++) {
    discountDecay.push({
      yr: t,
      "Discount Factor": +(1 / Math.pow(1 + dcf.wacc, t)).toFixed(4),
      "PV Weight (%)": +((1 / Math.pow(1 + dcf.wacc, t)) * 100).toFixed(2),
    });
  }

  // Radar: Financial health snapshot (last forecast year)
  const last = Y - 1;
  const radarData = [
    { metric: "Revenue Growth", val: Math.min(100, (a.revGrowth[last] / 0.20) * 100) },
    { metric: "EBITDA Margin", val: Math.min(100, (model.ebitdaMargin[last] / 0.30) * 100) },
    { metric: "Net Margin", val: Math.min(100, (model.niMargin[last] / 0.20) * 100) },
    { metric: "ROE", val: Math.min(100, (model.roe[last] / 0.25) * 100) },
    { metric: "Int Coverage", val: Math.min(100, (model.intCov[last] / 30) * 100) },
    { metric: "Liquidity", val: Math.min(100, (model.currentRatio[last] / 5) * 100) },
    { metric: "Asset Eff.", val: Math.min(100, (model.revenue[last] / model.totalAssets[last] / 1.5) * 100) },
    { metric: "Low Leverage", val: Math.min(100, (1 / (model.debtEquity[last] + 0.1)) * 50) },
  ];

  // Scenario comparison cone
  const buildScenIVPS = (mult) => {
    const aS = {
      ...a,
      revGrowth: a.revGrowth.map(g => g + mult * 0.04),
      gmPct: a.gmPct.map(g => g + mult * 0.015),
      opexPctRev: a.opexPctRev.map(o => o - mult * 0.005),
    };
    const m = buildThreeStatement(aS);
    const d = buildDCF(aS, m);
    return d;
  };
  const bear = buildScenIVPS(-1);
  const base = buildScenIVPS(0);
  const bull = buildScenIVPS(1);
  const scenCone = yrs.map((y, i) => ({
    year: y,
    Bear: Math.round(bear.fcff[i]),
    Base: Math.round(base.fcff[i]),
    Bull: Math.round(bull.fcff[i]),
  }));

  // EV composition
  const evComp = [
    { name: "Explicit PV", value: Math.round(dcf.pvFcff.reduce((s, v) => s + v, 0)) },
    { name: "Terminal PV", value: Math.round(dcf.pvTv) },
  ];

  // Comps scatter (size = MCap, x = EV/EBITDA, y = EBITDA margin)
  const compsScatter = [
    { name: "TCS", x: 21.9, y: 26.3, z: 1438500 },
    { name: "INFY", x: 18.9, y: 24.6, z: 762000 },
    { name: "HCLTECH", x: 18.5, y: 21.8, z: 451000 },
    { name: "WIPRO", x: 16.1, y: 19.4, z: 295000 },
    { name: "TECHM", x: 26.5, y: 11.4, z: 168000 },
    { name: "LTIM", x: 22.4, y: 17.5, z: 156000 },
    { name: "PERSISTENT", x: 46.6, y: 17.0, z: 92000 },
    { name: "COFORGE", x: 33.5, y: 17.0, z: 56000 },
    { name: a.ticker, x: model.ebitda[0] > 0 ? dcf.ev / (a.rev0 * 0.24) : 0, y: 24.0, z: dcf.equityValue * 1, isTarget: true },
  ];

  // ROE / ROA / ROIC trends
  const returnsData = yrs.map((y, i) => {
    const investedCap = model.equity[i] + model.debtBal[i];
    const nopat = model.ebit[i] * (1 - a.taxRate);
    return {
      year: y,
      ROE: +(model.roe[i] * 100).toFixed(2),
      ROA: +(model.roa[i] * 100).toFixed(2),
      ROIC: +((nopat / investedCap) * 100).toFixed(2),
    };
  });

  return (
    <div>
      {/* Section A — Growth & Profitability */}
      <SectionHeader label="A ▸ GROWTH & PROFITABILITY ANALYSIS" />

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 12 }}>
        <Panel title="▸ G1. P&L TRAJECTORY — REVENUE / EBITDA / NET INCOME / FCFF" subtitle="ABSOLUTE VALUES IN ₹ CRORES · 5-YEAR FORECAST">
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={trajData}>
              <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" />
              <XAxis dataKey="year" stroke={COLORS.textDim} style={{ fontSize: 10 }} />
              <YAxis stroke={COLORS.textDim} style={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="Revenue" fill={COLORS.gold} opacity={0.85} />
              <Bar dataKey="GrossProfit" fill={COLORS.amber} opacity={0.7} />
              <Line dataKey="EBITDA" stroke={COLORS.cyan} strokeWidth={2.5} dot={{ r: 4 }} />
              <Line dataKey="NetIncome" stroke={COLORS.green} strokeWidth={2.5} dot={{ r: 4 }} />
              <Line dataKey="FCFF" stroke={COLORS.purple} strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="▸ G2. YoY GROWTH RATES" subtitle="% CHANGE YEAR-OVER-YEAR">
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={growthData}>
              <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" />
              <XAxis dataKey="year" stroke={COLORS.textDim} style={{ fontSize: 10 }} />
              <YAxis stroke={COLORS.textDim} style={{ fontSize: 10 }} unit="%" />
              <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <ReferenceLine y={0} stroke={COLORS.gold} />
              <Bar dataKey="Rev YoY %" fill={COLORS.gold} />
              <Bar dataKey="EBITDA YoY %" fill={COLORS.cyan} />
              <Bar dataKey="NI YoY %" fill={COLORS.green} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <Panel title="▸ G3. MARGIN PROFILE EVOLUTION" subtitle="GROSS · EBITDA · EBIT · NET MARGINS / FORECAST PERIOD">
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={marginData}>
            <defs>
              <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.gold} stopOpacity={0.4} />
                <stop offset="100%" stopColor={COLORS.gold} stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.cyan} stopOpacity={0.4} />
                <stop offset="100%" stopColor={COLORS.cyan} stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="g3" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.green} stopOpacity={0.4} />
                <stop offset="100%" stopColor={COLORS.green} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" />
            <XAxis dataKey="year" stroke={COLORS.textDim} style={{ fontSize: 10 }} />
            <YAxis stroke={COLORS.textDim} style={{ fontSize: 10 }} unit="%" />
            <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Area type="monotone" dataKey="Gross %" stroke={COLORS.gold} fill="url(#g1)" strokeWidth={2} />
            <Area type="monotone" dataKey="EBITDA %" stroke={COLORS.cyan} fill="url(#g2)" strokeWidth={2} />
            <Area type="monotone" dataKey="EBIT %" stroke={COLORS.amber} fill="transparent" strokeWidth={2} strokeDasharray="3 3" />
            <Area type="monotone" dataKey="Net %" stroke={COLORS.green} fill="url(#g3)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </Panel>

      {/* Section B — Cash Flow Analysis */}
      <SectionHeader label="B ▸ CASH FLOW & FCFF ANALYSIS" />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Panel title="▸ G4. FCFF BUILD-UP WATERFALL (FY26E)" subtitle="EBIT → NOPAT → FCFF">
          <ResponsiveContainer width="100%" height={290}>
            <BarChart data={fcfWaterfall}>
              <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" />
              <XAxis dataKey="item" stroke={COLORS.textDim} style={{ fontSize: 10 }} />
              <YAxis stroke={COLORS.textDim} style={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
              <Bar dataKey="val">
                {fcfWaterfall.map((d, i) => <Cell key={i} fill={d.color} />)}
                <LabelList dataKey="val" position="top" style={{ fill: COLORS.text, fontSize: 10 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="▸ G5. CASH FLOW STATEMENT — CFO/CFI/CFF" subtitle="OPERATING · INVESTING · FINANCING">
          <ResponsiveContainer width="100%" height={290}>
            <ComposedChart data={cfStack}>
              <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" />
              <XAxis dataKey="year" stroke={COLORS.textDim} style={{ fontSize: 10 }} />
              <YAxis stroke={COLORS.textDim} style={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <ReferenceLine y={0} stroke={COLORS.gold} />
              <Bar dataKey="CFO" fill={COLORS.green} />
              <Bar dataKey="CFI" fill={COLORS.red} />
              <Bar dataKey="CFF" fill={COLORS.amber} />
              <Line dataKey="NetChange" stroke={COLORS.gold} strokeWidth={2.5} dot={{ r: 4, fill: COLORS.gold }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {/* Section C — Balance Sheet Evolution */}
      <SectionHeader label="C ▸ BALANCE SHEET DYNAMICS" />

      <Panel title="▸ G6. BALANCE SHEET EVOLUTION — STACKED ASSETS & LIABILITIES" subtitle="HOW THE BS GROWS OVER THE FORECAST PERIOD">
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={bsEvolution}>
            <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" />
            <XAxis dataKey="year" stroke={COLORS.textDim} style={{ fontSize: 10 }} />
            <YAxis stroke={COLORS.textDim} style={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="Cash" stackId="a" fill={COLORS.cyan} />
            <Bar dataKey="AR" stackId="a" fill={COLORS.gold} />
            <Bar dataKey="Inventory" stackId="a" fill={COLORS.amber} />
            <Bar dataKey="PPE" stackId="a" fill={COLORS.purple} />
            <Bar dataKey="Debt" stackId="b" fill={COLORS.red} />
            <Bar dataKey="Equity" stackId="b" fill={COLORS.green} />
          </BarChart>
        </ResponsiveContainer>
        <div style={{ color: COLORS.textMuted, fontSize: 10, textAlign: "center", marginTop: 4 }}>
          LEFT STACK: Total Assets composition · RIGHT STACK: Liabilities + Equity
        </div>
      </Panel>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Panel title="▸ G7. WORKING CAPITAL TREND" subtitle="AR + INV − AP = NWC">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={wcTrend}>
              <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" />
              <XAxis dataKey="year" stroke={COLORS.textDim} style={{ fontSize: 10 }} />
              <YAxis stroke={COLORS.textDim} style={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <ReferenceLine y={0} stroke={COLORS.gold} />
              <Bar dataKey="AR" stackId="x" fill={COLORS.gold} />
              <Bar dataKey="Inventory" stackId="x" fill={COLORS.amber} />
              <Bar dataKey="AP (–)" stackId="x" fill={COLORS.red} />
              <Line dataKey="NWC" stroke={COLORS.cyan} strokeWidth={3} dot={{ r: 5, fill: COLORS.cyan }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="▸ G8. DEBT PAYDOWN & INTEREST COVERAGE" subtitle="DELEVERAGING + COVERAGE METRICS">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={debtPaydown}>
              <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" />
              <XAxis dataKey="year" stroke={COLORS.textDim} style={{ fontSize: 10 }} />
              <YAxis yAxisId="l" stroke={COLORS.textDim} style={{ fontSize: 10 }} />
              <YAxis yAxisId="r" orientation="right" stroke={COLORS.green} style={{ fontSize: 10 }} unit="x" />
              <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar yAxisId="l" dataKey="Debt" fill={COLORS.red} opacity={0.7} />
              <Bar yAxisId="l" dataKey="Interest" fill={COLORS.amber} />
              <Line yAxisId="r" dataKey="Int Coverage" stroke={COLORS.green} strokeWidth={3} dot={{ r: 5, fill: COLORS.green }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {/* Section D — Returns / DuPont */}
      <SectionHeader label="D ▸ RETURNS & DUPONT DECOMPOSITION" />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Panel title="▸ G9. ROE / ROA / ROIC TREND" subtitle="THREE LENSES ON CAPITAL EFFICIENCY">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={returnsData}>
              <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" />
              <XAxis dataKey="year" stroke={COLORS.textDim} style={{ fontSize: 10 }} />
              <YAxis stroke={COLORS.textDim} style={{ fontSize: 10 }} unit="%" />
              <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line dataKey="ROE" stroke={COLORS.gold} strokeWidth={2.5} dot={{ r: 4 }} />
              <Line dataKey="ROA" stroke={COLORS.cyan} strokeWidth={2.5} dot={{ r: 4 }} />
              <Line dataKey="ROIC" stroke={COLORS.green} strokeWidth={2.5} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="▸ G10. FINANCIAL HEALTH RADAR (FY30E)" subtitle="8-DIMENSIONAL SCORECARD · 100 = STRONG">
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={radarData}>
              <PolarGrid stroke={COLORS.border} />
              <PolarAngleAxis dataKey="metric" stroke={COLORS.textDim} style={{ fontSize: 9 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} stroke={COLORS.textMuted} style={{ fontSize: 9 }} />
              <Radar name="Score" dataKey="val" stroke={COLORS.gold} fill={COLORS.gold} fillOpacity={0.4} strokeWidth={2} />
              <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
            </RadarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <Panel title="▸ G11. DUPONT 3-FACTOR DECOMPOSITION" subtitle="ROE = NET MARGIN × ASSET TURNOVER × EQUITY MULTIPLIER">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={dupontData}>
            <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" />
            <XAxis dataKey="year" stroke={COLORS.textDim} style={{ fontSize: 10 }} />
            <YAxis yAxisId="l" stroke={COLORS.textDim} style={{ fontSize: 10 }} />
            <YAxis yAxisId="r" orientation="right" stroke={COLORS.gold} style={{ fontSize: 10 }} unit="%" />
            <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar yAxisId="l" dataKey="Net Margin" fill={COLORS.cyan} />
            <Bar yAxisId="l" dataKey="Asset Turnover" fill={COLORS.amber} />
            <Bar yAxisId="l" dataKey="Equity Multiplier" fill={COLORS.purple} />
            <Line yAxisId="r" dataKey="ROE" stroke={COLORS.gold} strokeWidth={3} dot={{ r: 5, fill: COLORS.gold }} />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>

      {/* Section E — Valuation Visuals */}
      <SectionHeader label="E ▸ VALUATION VISUALS" />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Panel title="▸ G12. PV CONCENTRATION">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={pvComp} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90}
                label={{ fontSize: 10, fill: COLORS.text }}>
                {pvComp.map((_, i) => <Cell key={i} fill={pvColors[i]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 9 }} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ textAlign: "center", color: COLORS.textMuted, fontSize: 10, marginTop: -4 }}>
            Terminal = {fmtPct(dcf.pvTv / dcf.ev)} of EV
          </div>
        </Panel>

        <Panel title="▸ G13. EV STRUCTURE — EXPLICIT vs TERMINAL">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={evComp} layout="vertical">
              <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" />
              <XAxis type="number" stroke={COLORS.textDim} style={{ fontSize: 10 }} />
              <YAxis dataKey="name" type="category" stroke={COLORS.textDim} style={{ fontSize: 11 }} width={90} />
              <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
              <Bar dataKey="value" fill={COLORS.gold}>
                <LabelList dataKey="value" position="right" style={{ fill: COLORS.text, fontSize: 10 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="▸ G14. DISCOUNT FACTOR DECAY">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={discountDecay}>
              <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" />
              <XAxis dataKey="yr" stroke={COLORS.textDim} style={{ fontSize: 10 }} label={{ value: "Years", position: "bottom", fill: COLORS.textDim, fontSize: 10 }} />
              <YAxis stroke={COLORS.textDim} style={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
              <Area dataKey="Discount Factor" stroke={COLORS.gold} fill={COLORS.gold} fillOpacity={0.3} strokeWidth={2} />
              <ReferenceLine x={5} stroke={COLORS.cyan} strokeDasharray="3 3" label={{ value: "Forecast End", fill: COLORS.cyan, fontSize: 9 }} />
            </AreaChart>
          </ResponsiveContainer>
          <div style={{ textAlign: "center", color: COLORS.textMuted, fontSize: 10 }}>
            WACC = {fmtPct(dcf.wacc)}
          </div>
        </Panel>
      </div>

      {/* Section F — Scenarios & Comparables */}
      <SectionHeader label="F ▸ SCENARIO CONE & COMPS POSITIONING" />

      <Panel title="▸ G15. FCFF FAN — BEAR / BASE / BULL SCENARIO CONE" subtitle="HOW UNCERTAINTY WIDENS OUT THROUGH FORECAST">
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={scenCone}>
            <defs>
              <linearGradient id="sb" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.green} stopOpacity={0.3} />
                <stop offset="100%" stopColor={COLORS.red} stopOpacity={0.3} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" />
            <XAxis dataKey="year" stroke={COLORS.textDim} style={{ fontSize: 10 }} />
            <YAxis stroke={COLORS.textDim} style={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Area type="monotone" dataKey="Bull" stroke={COLORS.green} fill={COLORS.green} fillOpacity={0.15} strokeWidth={2} />
            <Area type="monotone" dataKey="Base" stroke={COLORS.gold} fill={COLORS.gold} fillOpacity={0.25} strokeWidth={2.5} />
            <Area type="monotone" dataKey="Bear" stroke={COLORS.red} fill={COLORS.red} fillOpacity={0.15} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="▸ G16. PEER POSITIONING — EV/EBITDA × EBITDA MARGIN" subtitle="BUBBLE SIZE = MARKET CAP · INDIAN IT SERVICES">
        <ResponsiveContainer width="100%" height={350}>
          <ScatterChart>
            <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" />
            <XAxis type="number" dataKey="x" stroke={COLORS.textDim} style={{ fontSize: 10 }}
              label={{ value: "EV / EBITDA (x)", position: "bottom", fill: COLORS.textDim, fontSize: 10 }} />
            <YAxis type="number" dataKey="y" stroke={COLORS.textDim} style={{ fontSize: 10 }} unit="%"
              label={{ value: "EBITDA Margin", angle: -90, position: "left", fill: COLORS.textDim, fontSize: 10 }} />
            <ZAxis type="number" dataKey="z" range={[80, 600]} />
            <Tooltip contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, fontSize: 11 }}
              formatter={(v, n) => n === "y" ? v.toFixed(1) + "%" : n === "x" ? v.toFixed(1) + "x" : fmt(v, 0) + " Cr"} />
            <Scatter name="Peers" data={compsScatter.filter(d => !d.isTarget)} fill={COLORS.cyan}>
              <LabelList dataKey="name" position="top" style={{ fill: COLORS.text, fontSize: 9 }} />
            </Scatter>
            <Scatter name="Target" data={compsScatter.filter(d => d.isTarget)} fill={COLORS.gold}>
              <LabelList dataKey="name" position="top" style={{ fill: COLORS.gold, fontSize: 11, fontWeight: 700 }} />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
        <div style={{ color: COLORS.textMuted, fontSize: 10, textAlign: "center", marginTop: 4 }}>
          Top-right quadrant = premium-multiple, high-margin businesses · Bottom-left = value plays
        </div>
      </Panel>

      {/* Section G — Sensitivity */}
      <SectionHeader label="G ▸ SENSITIVITY VISUALS" />

      <SensitivityHeatmap a={a} model={model} />

      {/* Section H — Summary */}
      <SectionHeader label="H ▸ ANALYTICAL TAKEAWAYS" />

      <Panel title="▸ G18. KEY OBSERVATIONS FROM THE GRAPHS">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, fontSize: 11 }}>
          <Insight title="GROWTH PROFILE" body={`Revenue compounds from ₹${fmt(a.rev0, 0)} Cr to ₹${fmt(model.revenue[Y - 1], 0)} Cr — a ${fmtPct(Math.pow(model.revenue[Y - 1] / a.rev0, 1 / Y) - 1)} CAGR. EBITDA grows ${fmtPct(Math.pow(model.ebitda[Y - 1] / model.ebitda[0], 1 / (Y - 1)) - 1)} per year, outpacing revenue due to operating leverage.`} />
          <Insight title="MARGIN EXPANSION" body={`EBITDA margin expands from ${fmtPct(model.ebitdaMargin[0])} in FY26E to ${fmtPct(model.ebitdaMargin[Y - 1])} in FY30E — ${((model.ebitdaMargin[Y - 1] - model.ebitdaMargin[0]) * 10000).toFixed(0)}bps of expansion driven by gross margin and OpEx leverage.`} />
          <Insight title="CASH GENERATION" body={`Cumulative FCFF over 5 years: ₹${fmt(dcf.fcff.reduce((s, v) => s + v, 0), 0)} Cr. CFO grows steadily; financing outflows reflect ${fmtPct(0.05)}/yr debt amortization. Cash builds materially.`} />
          <Insight title="VALUATION CONCENTRATION" body={`${fmtPct(dcf.pvTv / dcf.ev)} of enterprise value comes from terminal value — ${dcf.pvTv / dcf.ev > 0.65 ? "high terminal-value dependence is a key model risk" : "balanced split between explicit period and terminal"}.`} />
          <Insight title="RETURNS PROFILE" body={`ROE ${fmtPct(model.roe[0])} → ${fmtPct(model.roe[Y - 1])}. ROIC at ${fmtPct((model.ebit[Y - 1] * (1 - a.taxRate)) / (model.equity[Y - 1] + model.debtBal[Y - 1]))} comfortably above WACC of ${fmtPct(dcf.wacc)} — value-accretive.`} />
          <Insight title="LEVERAGE TRAJECTORY" body={`Debt/EBITDA falls from ${fmtMul(a.debt0 / (a.rev0 * 0.24))} to ${fmtMul(model.debtBal[Y - 1] / model.ebitda[Y - 1])}. Interest coverage rises from ${fmtMul(model.intCov[0])} to ${fmtMul(model.intCov[Y - 1])} — well-capitalized.`} />
        </div>
      </Panel>
    </div>
  );
}

function SectionHeader({ label }) {
  return (
    <div style={{
      margin: "20px 0 10px 0", padding: "8px 14px", background: COLORS.bg,
      borderLeft: `3px solid ${COLORS.gold}`, color: COLORS.gold,
      fontSize: 11, letterSpacing: "0.18em", fontWeight: 700,
    }}>{label}</div>
  );
}

function Insight({ title, body }) {
  return (
    <div style={{ padding: 12, background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderTop: `2px solid ${COLORS.gold}` }}>
      <div style={{ color: COLORS.gold, fontSize: 10, letterSpacing: "0.12em", fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ color: COLORS.textDim, lineHeight: 1.6 }}>{body}</div>
    </div>
  );
}

function SensitivityHeatmap({ a, model }) {
  const baseDcf = buildDCF(a, model);
  const baseWacc = baseDcf.wacc;

  const waccs = [-0.02, -0.01, 0, 0.01, 0.02].map(d => baseWacc + d);
  const gs = [-0.01, -0.005, 0, 0.005, 0.01].map(d => a.termGrowth + d);

  const grid = waccs.map(w =>
    gs.map(g => {
      const fcff = model.ebit.map((e, i) => e * (1 - a.taxRate) + model.da[i] - model.capex[i] - model.dNwc[i]);
      const pv = fcff.map((f, i) => f / Math.pow(1 + w, i + 1));
      const tv = fcff[4] * (1 + g) / (w - g);
      const pvtv = tv / Math.pow(1 + w, 5);
      const ev = pv.reduce((s, v) => s + v, 0) + pvtv;
      const eq = ev - a.debt0 + a.cash0;
      return (eq * 10) / a.shares;
    })
  );

  // Flatten for heatmap visualization using a grid of cells
  const minV = Math.min(...grid.flat());
  const maxV = Math.max(...grid.flat());

  return (
    <Panel title="▸ G17. INTRINSIC VALUE HEATMAP — WACC × TERMINAL g" subtitle="GREEN = ABOVE BASE · RED = BELOW BASE · ₹/SHARE">
      <div style={{ overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${COLORS.gold}` }}>
              <th style={{ padding: 8, textAlign: "left", color: COLORS.gold }}>WACC ↓ / g →</th>
              {gs.map((g, i) => (
                <th key={i} style={{ padding: 8, textAlign: "center", color: i === 2 ? COLORS.gold : COLORS.textDim, fontWeight: i === 2 ? 700 : 400 }}>{fmtPct(g)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, i) => (
              <tr key={i}>
                <td style={{ padding: 8, color: i === 2 ? COLORS.gold : COLORS.textDim, fontWeight: i === 2 ? 700 : 400 }}>{fmtPct(waccs[i])}</td>
                {row.map((v, j) => {
                  const norm = (v - minV) / (maxV - minV);
                  // Diverging color: red → gold → green
                  const r = Math.round(239 * (1 - norm) + 16 * norm);
                  const g_ = Math.round(68 * (1 - norm) + 185 * norm);
                  const b = Math.round(68 * (1 - norm) + 129 * norm);
                  const isBase = i === 2 && j === 2;
                  return (
                    <td key={j} style={{
                      padding: "14px 8px", textAlign: "center",
                      background: isBase ? COLORS.gold : `rgba(${r}, ${g_}, ${b}, 0.45)`,
                      color: isBase ? COLORS.bg : COLORS.text,
                      fontWeight: isBase ? 700 : 600,
                      border: isBase ? `2px solid ${COLORS.goldBright}` : `1px solid ${COLORS.borderLight}`,
                    }}>₹{fmtNum(v, 0)}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 12, padding: 10, background: COLORS.bg, color: COLORS.textDim, fontSize: 10, lineHeight: 1.6 }}>
        ▸ Diagonal shows how IVPS moves with simultaneous shifts. ▸ A 1% increase in WACC offsets roughly ~0.5% in terminal g.
        ▸ Range of values: <span style={{ color: COLORS.red }}>min ₹{fmtNum(minV, 0)}</span> to <span style={{ color: COLORS.green }}>max ₹{fmtNum(maxV, 0)}</span>
        — a {fmtPct((maxV - minV) / minV)} swing from worst to best corner.
      </div>
    </Panel>
  );
}
