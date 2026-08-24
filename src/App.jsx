import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { SYNC_CODE, IS_READ_ONLY } from "./storage-shim.js";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, Cell
} from "recharts";
import {
  Plus, X, Settings, ChevronLeft, ChevronRight, Trash2, Copy, Pencil,
  Wallet, Target, Flame, Snowflake, TrendingUp, TrendingDown, Image as ImageIcon,
  Check, ChevronDown, Filter, Layers, ArrowUpRight, ArrowDownRight, Download, Upload,
  Eye, Lock
} from "lucide-react";

/* ----------------------------- constants ----------------------------- */

const STORAGE_KEY = "rr-journal:portfolios-v1";

const RESULTS = ["TP", "SL", "BE", "NC"];

const RESULT_META = {
  TP: { label: "Take Profit", short: "TP", color: "#21D19F", dim: "rgba(33,209,159,0.14)" },
  SL: { label: "Stop Loss", short: "SL", color: "#FF5C6C", dim: "rgba(255,92,108,0.14)" },
  BE: { label: "Break Even", short: "BE", color: "#F5B84F", dim: "rgba(245,184,79,0.14)" },
  NC: { label: "No Confirmation", short: "NC", color: "#5B6472", dim: "rgba(91,100,114,0.16)" },
};

const RISK_PRESETS = [0.1, 0.25, 0.5, 0.75, 1];
const RR_PRESETS = [1, 1.5, 2, 2.5, 3, 4];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "AUD", "CAD"];
const CURRENCY_SYMBOL = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", AUD: "A$", CAD: "C$" };

/* ------------------------------ utilities ------------------------------ */

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function dateKey(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

function fmtMoney(n, currency) {
  const sym = CURRENCY_SYMBOL[currency] || "$";
  const neg = n < 0;
  const v = Math.abs(n);
  const s = v >= 1000
    ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : v.toFixed(2);
  return `${neg ? "-" : ""}${sym}${s}`;
}

function fmtPct(n) {
  const neg = n < 0;
  return `${neg ? "-" : n > 0 ? "+" : ""}${Math.abs(n).toFixed(2)}%`;
}

function fmtRR(n) {
  const neg = n < 0;
  return `${neg ? "-" : n > 0 ? "+" : ""}${Math.abs(n).toFixed(2)}R`;
}

function rrForTrade(t) {
  if (t.result === "TP") return Number(t.tp_rr) || 0;
  if (t.result === "SL") return -1;
  return 0; // BE, NC
}

// Sort chronologically by date then created_at, compute running risk/pnl/balance.
function enrichTrades(trades, startingCapital, compounding) {
  const sorted = [...trades].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (a.created_at || 0) - (b.created_at || 0);
  });
  let balance = startingCapital;
  const out = [];
  for (const t of sorted) {
    const base = compounding ? balance : startingCapital;
    const risk_amount = base * ((Number(t.risk_percentage) || 0) / 100);
    const actual_rr = rrForTrade(t);
    const pnl = risk_amount * actual_rr;
    const balance_before = balance;
    balance += pnl;
    out.push({ ...t, actual_rr, risk_amount, pnl, balance_before, balance_after: balance });
  }
  return out;
}

function computeMetrics(enriched, startingCapital) {
  const total = enriched.length;
  const counts = { TP: 0, SL: 0, BE: 0, NC: 0 };
  let netRR = 0, totalPnl = 0, grossProfit = 0, grossLoss = 0;
  for (const t of enriched) {
    counts[t.result] = (counts[t.result] || 0) + 1;
    netRR += t.actual_rr;
    totalPnl += t.pnl;
    if (t.pnl > 0) grossProfit += t.pnl;
    if (t.pnl < 0) grossLoss += Math.abs(t.pnl);
  }
  const decided = counts.TP + counts.SL;
  const winRate = decided ? (counts.TP / decided) * 100 : 0;
  const avgRR = total ? netRR / total : 0;
  const growthPct = startingCapital ? (totalPnl / startingCapital) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

  // streaks (BE/NC are neutral: skipped, don't break or extend)
  let curStreak = 0, curType = null;
  for (let i = enriched.length - 1; i >= 0; i--) {
    const r = enriched[i].result;
    if (r === "BE" || r === "NC") continue;
    if (curType === null) { curType = r; curStreak = 1; }
    else if (r === curType) curStreak++;
    else break;
  }
  let longestWin = 0, longestLoss = 0, runWin = 0, runLoss = 0;
  for (const t of enriched) {
    if (t.result === "TP") { runWin++; runLoss = 0; }
    else if (t.result === "SL") { runLoss++; runWin = 0; }
    else continue;
    longestWin = Math.max(longestWin, runWin);
    longestLoss = Math.max(longestLoss, runLoss);
  }

  // max drawdown from balance curve
  let peak = startingCapital, maxDD = 0;
  for (const t of enriched) {
    peak = Math.max(peak, t.balance_after);
    const dd = peak > 0 ? ((peak - t.balance_after) / peak) * 100 : 0;
    maxDD = Math.max(maxDD, dd);
  }

  let best = null, worst = null;
  for (const t of enriched) {
    if (!best || t.pnl > best.pnl) best = t;
    if (!worst || t.pnl < worst.pnl) worst = t;
  }

  return {
    total, counts, netRR, avgRR, totalPnl, growthPct, profitFactor,
    winRate, curStreak, curType, longestWin, longestLoss, maxDD,
    best, worst, finalBalance: startingCapital + totalPnl,
  };
}

function defaultPortfolio(name, capital) {
  return {
    portfolio_id: uid(),
    name,
    starting_capital: capital,
    currency: "USD",
    default_risk_percentage: 0.5,
    default_tp_rr: 2,
    compounding_enabled: false,
    max_risk_percentage: 2,
    max_daily_loss_percentage: 3,
    max_trades_per_day: 5,
    created_at: Date.now(),
    trades: [],
  };
}

/* -------------------------------- app -------------------------------- */

export default function TradingJournalApp() {
  const [portfolios, setPortfolios] = useState(() => [defaultPortfolio("Personal Account", 10000)]);
  const [activeId, setActiveId] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [viewDate, setViewDate] = useState(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() }; });
  const [modalDate, setModalDate] = useState(null); // "YYYY-MM-DD" or null
  const [showSettings, setShowSettings] = useState(false);
  const [showNewPortfolio, setShowNewPortfolio] = useState(false);
  const [portfolioMenuOpen, setPortfolioMenuOpen] = useState(false);
  const [historyFilters, setHistoryFilters] = useState({ result: "ALL", search: "" });
  const [toast, setToast] = useState(null);
  const saveTimer = useRef(null);
  const importInputRef = useRef(null);

  // load fonts
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap";
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);

  // load persisted data once
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY, false);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          if (parsed && Array.isArray(parsed.portfolios) && parsed.portfolios.length) {
            setPortfolios(parsed.portfolios);
            setActiveId(parsed.activeId || parsed.portfolios[0].portfolio_id);
            setLoaded(true);
            return;
          }
        }
      } catch (e) { /* no saved data yet */ }
      setActiveId((prev) => prev);
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (!activeId && portfolios[0]) setActiveId(portfolios[0].portfolio_id);
  }, [loaded, activeId, portfolios]);

  // persist on change (debounced)
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await window.storage.set(STORAGE_KEY, JSON.stringify({ portfolios, activeId }), false);
      } catch (e) { /* best effort */ }
    }, 350);
    return () => clearTimeout(saveTimer.current);
  }, [portfolios, activeId, loaded]);

  const portfolio = useMemo(
    () => portfolios.find((p) => p.portfolio_id === activeId) || portfolios[0],
    [portfolios, activeId]
  );

  const updatePortfolio = useCallback((id, updater) => {
    setPortfolios((prev) => prev.map((p) => (p.portfolio_id === id ? updater(p) : p)));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  function exportData() {
    try {
      const payload = { portfolios, activeId, exported_at: new Date().toISOString() };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `rr-journal-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setToast({ type: "ok", text: "Backup downloaded." });
    } catch (e) {
      setToast({ type: "err", text: "Export failed — please try again." });
    }
  }

  function shareViewOnlyLink() {
    try {
      const url = `${window.location.origin}${window.location.pathname}?view=readonly&code=${encodeURIComponent(SYNC_CODE)}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url);
        setToast({ type: "ok", text: "View-only link copied — paste it to share." });
      } else {
        window.prompt("Copy this view-only link:", url);
      }
    } catch (e) {
      setToast({ type: "err", text: "Could not create the link." });
    }
  }

  function handleImportFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.portfolios) || !parsed.portfolios.length) {
          throw new Error("bad file");
        }
        setPortfolios(parsed.portfolios);
        setActiveId(parsed.activeId || parsed.portfolios[0].portfolio_id);
        setToast({ type: "ok", text: "Backup restored." });
      } catch (err) {
        setToast({ type: "err", text: "That file doesn't look like a valid backup." });
      }
    };
    reader.onerror = () => setToast({ type: "err", text: "Could not read that file." });
    reader.readAsText(file);
  }

  if (!loaded || !portfolio) {
    return (
      <div style={{ background: COLORS.bg, minHeight: "100vh" }} className="flex items-center justify-center">
        <div style={{ color: COLORS.textDim, fontFamily: F.body }}>Loading journal…</div>
      </div>
    );
  }

  const enriched = enrichTrades(portfolio.trades, portfolio.starting_capital, portfolio.compounding_enabled);
  const metrics = computeMetrics(enriched, portfolio.starting_capital);
  const enrichedByDate = groupBy(enriched, (t) => t.date);

  const monthEnriched = enriched.filter((t) => {
    const [y, m] = t.date.split("-").map(Number);
    return y === viewDate.y && m - 1 === viewDate.m;
  });
  const monthMetrics = computeMetrics(monthEnriched, portfolio.starting_capital);

  function addTrade(trade) {
    updatePortfolio(portfolio.portfolio_id, (p) => ({
      ...p,
      trades: [...p.trades, { ...trade, trade_id: uid(), created_at: Date.now(), updated_at: Date.now() }],
    }));
  }
  function editTrade(tradeId, patch) {
    updatePortfolio(portfolio.portfolio_id, (p) => ({
      ...p,
      trades: p.trades.map((t) => (t.trade_id === tradeId ? { ...t, ...patch, updated_at: Date.now() } : t)),
    }));
  }
  function deleteTrade(tradeId) {
    updatePortfolio(portfolio.portfolio_id, (p) => ({
      ...p,
      trades: p.trades.filter((t) => t.trade_id !== tradeId),
    }));
  }
  function duplicateTrade(trade) {
    addTrade({ ...trade, trade_id: undefined });
  }

  return (
    <div style={{ background: COLORS.bg, minHeight: "100vh", fontFamily: F.body, color: COLORS.text }}>
      <GlobalStyle />
      <div className="max-w-6xl mx-auto px-4 py-5 md:px-6 md:py-8">
        <Header
          portfolios={portfolios}
          portfolio={portfolio}
          setActiveId={setActiveId}
          portfolioMenuOpen={portfolioMenuOpen}
          setPortfolioMenuOpen={setPortfolioMenuOpen}
          onNewPortfolio={() => setShowNewPortfolio(true)}
          onSettings={() => setShowSettings(true)}
          onExport={exportData}
          onImportClick={() => importInputRef.current && importInputRef.current.click()}
          onShareView={shareViewOnlyLink}
          isReadOnly={IS_READ_ONLY}
        />
        <input ref={importInputRef} type="file" accept="application/json" onChange={handleImportFile} className="hidden" />

        {IS_READ_ONLY && (
          <div
            className="mb-4 px-3.5 py-2.5 flex items-center gap-2"
            style={{
              borderRadius: 10,
              background: "rgba(79,163,255,0.10)",
              border: `1px solid rgba(79,163,255,0.35)`,
              color: COLORS.accent,
              fontSize: 12.5,
            }}
          >
            <Lock size={14} />
            <span>View-only mode — you're viewing shared data and can't make changes here.</span>
          </div>
        )}

        {toast && (
          <div
            className="rrj-fade-in mb-4 px-3.5 py-2.5 flex items-center justify-between"
            style={{
              borderRadius: 10,
              background: toast.type === "ok" ? "rgba(33,209,159,0.10)" : "rgba(255,92,108,0.10)",
              border: `1px solid ${toast.type === "ok" ? "rgba(33,209,159,0.35)" : "rgba(255,92,108,0.35)"}`,
              color: toast.type === "ok" ? COLORS.green : COLORS.red,
              fontSize: 12.5,
            }}
          >
            <span>{toast.text}</span>
            <button onClick={() => setToast(null)} style={{ color: "inherit" }}><X size={13} /></button>
          </div>
        )}

        <TickerStrip enriched={enriched} currency={portfolio.currency} />

        <StatCards metrics={metrics} portfolio={portfolio} viewDate={viewDate} />

        <CalendarSection
          viewDate={viewDate}
          setViewDate={setViewDate}
          enrichedByDate={enrichedByDate}
          onSelectDate={(k) => setModalDate(k)}
          currency={portfolio.currency}
        />

        <WeeklySection viewDate={viewDate} enriched={monthEnriched} currency={portfolio.currency} />

        <CumulativeSection viewDate={viewDate} enriched={monthEnriched} />

        <TradeHistorySection
          enriched={enriched}
          currency={portfolio.currency}
          filters={historyFilters}
          setFilters={setHistoryFilters}
          onEdit={(t) => setModalDate(t.date)}
          onDelete={deleteTrade}
          onDuplicate={duplicateTrade}
          isReadOnly={IS_READ_ONLY}
        />

        <MonthlyAnalyticsSection viewDate={viewDate} metrics={monthMetrics} currency={portfolio.currency} />

        <footer className="mt-10 mb-4 text-center" style={{ color: COLORS.textFaint, fontSize: 12 }}>
          R-multiples first, dollars second. Data is stored privately in this artifact.
        </footer>
      </div>

      {modalDate && (
        <TradeModal
          dateKey={modalDate}
          portfolio={portfolio}
          trades={portfolio.trades.filter((t) => t.date === modalDate)}
          onClose={() => setModalDate(null)}
          onAdd={addTrade}
          onEdit={editTrade}
          onDelete={deleteTrade}
          onDuplicate={duplicateTrade}
          isReadOnly={IS_READ_ONLY}
        />
      )}

      {showSettings && !IS_READ_ONLY && (
        <SettingsModal
          portfolio={portfolio}
          onClose={() => setShowSettings(false)}
          onSave={(patch) => updatePortfolio(portfolio.portfolio_id, (p) => ({ ...p, ...patch }))}
        />
      )}

      {showNewPortfolio && !IS_READ_ONLY && (
        <NewPortfolioModal
          onClose={() => setShowNewPortfolio(false)}
          onCreate={(name, capital) => {
            const np = defaultPortfolio(name, capital);
            setPortfolios((prev) => [...prev, np]);
            setActiveId(np.portfolio_id);
            setShowNewPortfolio(false);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------- theming ------------------------------- */

const COLORS = {
  bg: "#0A0E14",
  panel: "#10161F",
  panel2: "#161D29",
  panel3: "#1B2330",
  border: "#232B38",
  borderSoft: "#1B222D",
  text: "#E7ECF3",
  textDim: "#8A94A6",
  textFaint: "#525C6B",
  accent: "#4FA3FF",
  accent2: "#8B7CF6",
  green: "#21D19F",
  red: "#FF5C6C",
  yellow: "#F5B84F",
  grey: "#5B6472",
};

const F = {
  display: "'Space Grotesk', sans-serif",
  mono: "'IBM Plex Mono', monospace",
  body: "'Inter', sans-serif",
};

function GlobalStyle() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      ::-webkit-scrollbar { height: 6px; width: 6px; }
      ::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 4px; }
      .rrj-card {
        background: ${COLORS.panel};
        border: 1px solid ${COLORS.border};
        border-radius: 12px;
      }
      .rrj-btn {
        border: 1px solid ${COLORS.border};
        background: ${COLORS.panel2};
        color: ${COLORS.text};
        border-radius: 8px;
        transition: border-color .15s ease, background .15s ease, transform .1s ease;
      }
      .rrj-btn:hover { border-color: #34404F; background: ${COLORS.panel3}; }
      .rrj-btn:active { transform: scale(0.98); }
      .rrj-btn-accent {
        background: ${COLORS.accent};
        color: #06121F;
        border: 1px solid ${COLORS.accent};
        font-weight: 600;
      }
      .rrj-btn-accent:hover { filter: brightness(1.08); }
      .rrj-input {
        background: ${COLORS.panel2};
        border: 1px solid ${COLORS.border};
        color: ${COLORS.text};
        border-radius: 8px;
        outline: none;
      }
      .rrj-input:focus { border-color: ${COLORS.accent}; }
      .rrj-pill {
        border: 1px solid ${COLORS.border};
        border-radius: 999px;
        background: ${COLORS.panel2};
        color: ${COLORS.textDim};
        transition: all .15s ease;
      }
      .rrj-pill.active { color: #06121F; font-weight: 600; }
      .rrj-day {
        background: ${COLORS.panel};
        border: 1px solid ${COLORS.borderSoft};
        border-radius: 10px;
        transition: border-color .15s ease, background .15s ease;
        cursor: pointer;
      }
      .rrj-day:hover { border-color: ${COLORS.accent}; background: ${COLORS.panel2}; }
      .rrj-fade-in { animation: rrjFade .18s ease; }
      @keyframes rrjFade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      @media (prefers-reduced-motion: reduce) {
        .rrj-fade-in { animation: none; }
      }
      .rrj-scroll::-webkit-scrollbar { height: 4px; }
    `}</style>
  );
}

function groupBy(arr, fn) {
  const out = {};
  for (const item of arr) {
    const k = fn(item);
    (out[k] = out[k] || []).push(item);
  }
  return out;
}

/* -------------------------------- header -------------------------------- */

function Header({ portfolios, portfolio, setActiveId, portfolioMenuOpen, setPortfolioMenuOpen, onNewPortfolio, onSettings, onExport, onImportClick, onShareView, isReadOnly }) {
  return (
    <div className="flex items-start justify-between mb-5 relative">
      <div>
        <div style={{ fontFamily: F.mono, fontSize: 11, letterSpacing: 1.5, color: COLORS.accent, textTransform: "uppercase" }}>
          RR Journal
        </div>
        <div className="relative mt-1">
          <button
            className="rrj-btn flex items-center gap-2 px-3 py-2"
            style={{ fontFamily: F.display, fontSize: 20, fontWeight: 600 }}
            onClick={() => setPortfolioMenuOpen((v) => !v)}
          >
            <Layers size={16} color={COLORS.accent} />
            {portfolio.name}
            <ChevronDown size={16} color={COLORS.textDim} />
          </button>
          {portfolioMenuOpen && (
            <div
              className="rrj-fade-in absolute left-0 top-full mt-2 z-30 rrj-card overflow-hidden"
              style={{ minWidth: 220 }}
            >
              {portfolios.map((p) => (
                <button
                  key={p.portfolio_id}
                  onClick={() => { setActiveId(p.portfolio_id); setPortfolioMenuOpen(false); }}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-left"
                  style={{
                    fontSize: 14,
                    background: p.portfolio_id === portfolio.portfolio_id ? COLORS.panel2 : "transparent",
                    borderBottom: `1px solid ${COLORS.borderSoft}`,
                  }}
                >
                  <span>{p.name}</span>
                  {p.portfolio_id === portfolio.portfolio_id && <Check size={14} color={COLORS.accent} />}
                </button>
              ))}
              {!isReadOnly && (
                <button
                  onClick={() => { onNewPortfolio(); setPortfolioMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
                  style={{ fontSize: 14, color: COLORS.accent }}
                >
                  <Plus size={14} /> New portfolio
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1">
        {isReadOnly ? (
          <span className="flex items-center gap-1.5 px-3 py-2" style={{ fontSize: 12, color: COLORS.accent, border: `1px solid rgba(79,163,255,0.35)`, borderRadius: 8, background: "rgba(79,163,255,0.08)" }}>
            <Eye size={14} /> View only
          </span>
        ) : (
          <>
            <button className="rrj-btn p-2.5" onClick={onShareView} aria-label="Share view-only link" title="Share view-only link">
              <Eye size={16} color={COLORS.textDim} />
            </button>
            <button className="rrj-btn p-2.5" onClick={onImportClick} aria-label="Import backup" title="Import backup">
              <Upload size={16} color={COLORS.textDim} />
            </button>
            <button className="rrj-btn p-2.5" onClick={onExport} aria-label="Export backup" title="Download backup">
              <Download size={16} color={COLORS.textDim} />
            </button>
            <button className="rrj-btn p-2.5" onClick={onSettings} aria-label="Risk settings">
              <Settings size={18} color={COLORS.textDim} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ ticker strip ------------------------------ */

function TickerStrip({ enriched, currency }) {
  const recent = enriched.slice(-24);
  if (!recent.length) return null;
  return (
    <div className="rrj-card mb-5 px-3 py-2.5 overflow-hidden">
      <div className="flex items-center gap-3 overflow-x-auto rrj-scroll" style={{ scrollbarWidth: "thin" }}>
        <span style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.textFaint, whiteSpace: "nowrap" }}>RECENT →</span>
        {recent.map((t, i) => {
          const meta = RESULT_META[t.result];
          return (
            <div key={t.trade_id + i} className="flex items-center gap-1 flex-shrink-0" title={`${t.date} · ${meta.label} · ${fmtRR(t.actual_rr)}`}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: meta.color, display: "inline-block" }} />
              <span style={{ fontFamily: F.mono, fontSize: 11, color: t.actual_rr > 0 ? COLORS.green : t.actual_rr < 0 ? COLORS.red : COLORS.textDim }}>
                {fmtRR(t.actual_rr)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------- stat cards -------------------------------- */

function StatCard({ label, value, valueColor, icon, sub }) {
  return (
    <div className="rrj-card px-4 py-3.5 flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center gap-1.5" style={{ color: COLORS.textDim, fontSize: 11.5 }}>
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div style={{ fontFamily: F.mono, fontSize: 20, fontWeight: 600, color: valueColor || COLORS.text }} className="truncate">
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: COLORS.textFaint }}>{sub}</div>}
    </div>
  );
}

function StatCards({ metrics, portfolio, viewDate }) {
  const growthColor = metrics.growthPct > 0 ? COLORS.green : metrics.growthPct < 0 ? COLORS.red : COLORS.text;
  const netRRColor = metrics.netRR > 0 ? COLORS.green : metrics.netRR < 0 ? COLORS.red : COLORS.text;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
      <StatCard icon={<Wallet size={13} />} label="Balance" value={fmtMoney(metrics.finalBalance, portfolio.currency)}
        sub={`${MONTHS[viewDate.m]} ${viewDate.y}`} />
      <StatCard icon={<Target size={13} />} label="Net RR" value={fmtRR(metrics.netRR)} valueColor={netRRColor}
        sub={`avg ${fmtRR(metrics.avgRR)} / trade`} />
      <StatCard icon={<TrendingUp size={13} />} label="Growth" value={fmtPct(metrics.growthPct)} valueColor={growthColor}
        sub={fmtMoney(metrics.totalPnl, portfolio.currency) + " total P&L"} />
      <StatCard icon={<Check size={13} />} label="Win Rate" value={`${metrics.winRate.toFixed(1)}%`}
        sub={`${metrics.counts.TP}TP · ${metrics.counts.SL}SL · ${metrics.counts.BE}BE · ${metrics.counts.NC}NC`} />
      <StatCard label="Total Trades" value={metrics.total} sub="all time" />
      <StatCard label="Profit Factor" value={metrics.profitFactor === Infinity ? "∞" : metrics.profitFactor.toFixed(2)} />
      <StatCard
        icon={metrics.curType === "SL" ? <Snowflake size={13} /> : <Flame size={13} />}
        label={metrics.curType === "SL" ? "Losing Streak" : "Winning Streak"}
        value={metrics.curStreak}
        valueColor={metrics.curType === "SL" ? COLORS.red : metrics.curType === "TP" ? COLORS.green : COLORS.text}
      />
      <StatCard label="Max Drawdown" value={`${metrics.maxDD.toFixed(2)}%`} valueColor={metrics.maxDD > 0 ? COLORS.red : COLORS.text} />
    </div>
  );
}

/* -------------------------------- calendar -------------------------------- */

function DayDots({ dayTrades }) {
  if (!dayTrades || !dayTrades.length) return null;
  const shown = dayTrades.slice(0, 4);
  return (
    <div className="flex items-center gap-1 flex-wrap mt-1">
      {shown.map((t, i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: 999, background: RESULT_META[t.result].color, display: "inline-block" }} />
      ))}
      {dayTrades.length > 4 && (
        <span style={{ fontFamily: F.mono, fontSize: 9.5, color: COLORS.textFaint }}>+{dayTrades.length - 4}</span>
      )}
    </div>
  );
}

function CalendarSection({ viewDate, setViewDate, enrichedByDate, onSelectDate, currency }) {
  const { y, m } = viewDate;
  const first = new Date(y, m, 1).getDay();
  const total = daysInMonth(y, m);
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const today = new Date();
  const isToday = (d) => d && today.getFullYear() === y && today.getMonth() === m && today.getDate() === d;

  function shiftMonth(delta) {
    let nm = m + delta, ny = y;
    if (nm < 0) { nm = 11; ny -= 1; }
    if (nm > 11) { nm = 0; ny += 1; }
    setViewDate({ y: ny, m: nm });
  }

  return (
    <div className="rrj-card p-4 md:p-5 mb-5">
      <div className="flex items-center justify-between mb-4">
        <div style={{ fontFamily: F.display, fontSize: 17, fontWeight: 600 }}>{MONTHS[m]} {y}</div>
        <div className="flex items-center gap-2">
          <button className="rrj-btn p-1.5" onClick={() => shiftMonth(-1)}><ChevronLeft size={16} /></button>
          <button
            className="rrj-btn px-2.5 py-1.5"
            style={{ fontSize: 12 }}
            onClick={() => setViewDate({ y: today.getFullYear(), m: today.getMonth() })}
          >
            Today
          </button>
          <button className="rrj-btn p-1.5" onClick={() => shiftMonth(1)}><ChevronRight size={16} /></button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5 mb-1.5">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-center" style={{ fontSize: 10.5, color: COLORS.textFaint, fontFamily: F.mono, letterSpacing: 0.5 }}>
            {w.toUpperCase()}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const k = dateKey(y, m, d);
          const dayTrades = enrichedByDate[k];
          const dayNetRR = dayTrades ? dayTrades.reduce((s, t) => s + t.actual_rr, 0) : 0;
          return (
            <div
              key={i}
              className="rrj-day px-1.5 py-1.5 md:px-2 md:py-2 flex flex-col justify-between"
              style={{ minHeight: 58, borderColor: isToday(d) ? COLORS.accent : undefined }}
              onClick={() => onSelectDate(k)}
            >
              <div className="flex items-center justify-between">
                <span style={{ fontFamily: F.mono, fontSize: 12, color: isToday(d) ? COLORS.accent : COLORS.textDim }}>{d}</span>
                {dayTrades && (
                  <span style={{ fontFamily: F.mono, fontSize: 10, color: dayNetRR > 0 ? COLORS.green : dayNetRR < 0 ? COLORS.red : COLORS.textFaint }}>
                    {dayNetRR !== 0 ? fmtRR(dayNetRR) : ""}
                  </span>
                )}
              </div>
              <DayDots dayTrades={dayTrades} />
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-4 flex-wrap mt-4 pt-3" style={{ borderTop: `1px solid ${COLORS.borderSoft}` }}>
        {RESULTS.map((r) => (
          <div key={r} className="flex items-center gap-1.5">
            <span style={{ width: 7, height: 7, borderRadius: 999, background: RESULT_META[r].color, display: "inline-block" }} />
            <span style={{ fontSize: 11.5, color: COLORS.textDim }}>{RESULT_META[r].label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------- weekly section -------------------------------- */

function CustomBarTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const v = payload[0].value;
  return (
    <div className="rrj-card px-3 py-2" style={{ fontSize: 12 }}>
      <div style={{ color: COLORS.textDim, marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: F.mono, color: v >= 0 ? COLORS.green : COLORS.red }}>{fmtRR(v)}</div>
    </div>
  );
}

function WeeklySection({ viewDate, enriched, currency }) {
  const { y, m } = viewDate;
  const first = new Date(y, m, 1).getDay();
  const total = daysInMonth(y, m);
  const byDate = groupBy(enriched, (t) => t.date);

  const weeks = [];
  let cur = [];
  for (let i = 0; i < first; i++) cur.push(null);
  for (let d = 1; d <= total; d++) {
    cur.push(d);
    if (cur.length === 7) { weeks.push(cur); cur = []; }
  }
  if (cur.length) { while (cur.length < 7) cur.push(null); weeks.push(cur); }

  const weekStats = weeks.map((days, idx) => {
    const validDays = days.filter(Boolean);
    const trades = validDays.flatMap((d) => byDate[dateKey(y, m, d)] || []);
    const m2 = computeMetrics(trades, 0);
    return { label: `Week ${idx + 1}`, netRR: m2.netRR, trades: trades.length, tp: m2.counts.TP, sl: m2.counts.SL, be: m2.counts.BE, nc: m2.counts.NC, pnl: m2.totalPnl, winRate: m2.winRate };
  }).filter((w) => w.trades > 0);

  return (
    <div className="rrj-card p-4 md:p-5 mb-5">
      <div className="flex items-center justify-between mb-4">
        <div style={{ fontFamily: F.display, fontSize: 16, fontWeight: 600 }}>Weekly RR Summary</div>
      </div>
      {weekStats.length === 0 ? (
        <EmptyState text="No trades logged this month yet." />
      ) : (
        <>
          <div style={{ width: "100%", height: 160 }} className="mb-4">
            <ResponsiveContainer>
              <BarChart data={weekStats} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                <CartesianGrid stroke={COLORS.borderSoft} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: COLORS.textFaint, fontSize: 11, fontFamily: F.mono }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
                <YAxis tick={{ fill: COLORS.textFaint, fontSize: 11, fontFamily: F.mono }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomBarTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                <ReferenceLine y={0} stroke={COLORS.border} />
                <Bar dataKey="netRR" radius={[4, 4, 4, 4]}>
                  {weekStats.map((w, i) => <Cell key={i} fill={w.netRR >= 0 ? COLORS.green : COLORS.red} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {weekStats.map((w, i) => (
              <div key={i} className="px-3 py-2.5" style={{ background: COLORS.panel2, borderRadius: 8, border: `1px solid ${COLORS.borderSoft}` }}>
                <div className="flex items-center justify-between mb-1">
                  <span style={{ fontSize: 12, color: COLORS.textDim }}>{w.label}</span>
                  <span style={{ fontFamily: F.mono, fontSize: 12, color: w.netRR >= 0 ? COLORS.green : COLORS.red }}>{fmtRR(w.netRR)}</span>
                </div>
                <div style={{ fontSize: 11, color: COLORS.textFaint }}>{w.trades} trades · {w.winRate.toFixed(0)}% WR · {fmtMoney(w.pnl, currency)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------- cumulative chart -------------------------------- */

function CumulativeSection({ viewDate, enriched }) {
  const { y, m } = viewDate;
  const total = daysInMonth(y, m);
  const byDate = groupBy(enriched, (t) => t.date);
  let running = 0;
  const data = [];
  for (let d = 1; d <= total; d++) {
    const trades = byDate[dateKey(y, m, d)] || [];
    if (trades.length === 0) continue;
    const dayRR = trades.reduce((s, t) => s + t.actual_rr, 0);
    running += dayRR;
    data.push({ day: d, cum: Number(running.toFixed(2)) });
  }

  return (
    <div className="rrj-card p-4 md:p-5 mb-5">
      <div style={{ fontFamily: F.display, fontSize: 16, fontWeight: 600 }} className="mb-4">Cumulative RR — {MONTHS[m]}</div>
      {data.length === 0 ? (
        <EmptyState text="Cumulative RR will appear once you log trades this month." />
      ) : (
        <div style={{ width: "100%", height: 200 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={COLORS.borderSoft} vertical={false} />
              <XAxis dataKey="day" tick={{ fill: COLORS.textFaint, fontSize: 11, fontFamily: F.mono }} axisLine={{ stroke: COLORS.border }} tickLine={false} />
              <YAxis tick={{ fill: COLORS.textFaint, fontSize: 11, fontFamily: F.mono }} axisLine={false} tickLine={false} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload || !payload.length) return null;
                  const v = payload[0].value;
                  return (
                    <div className="rrj-card px-3 py-2" style={{ fontSize: 12 }}>
                      <div style={{ color: COLORS.textDim }}>Day {label}</div>
                      <div style={{ fontFamily: F.mono, color: v >= 0 ? COLORS.green : COLORS.red }}>{fmtRR(v)}</div>
                    </div>
                  );
                }}
              />
              <ReferenceLine y={0} stroke={COLORS.border} />
              <Line type="monotone" dataKey="cum" stroke={COLORS.accent} strokeWidth={2} dot={{ r: 2.5, fill: COLORS.accent }} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- trade history -------------------------------- */

function TradeHistorySection({ enriched, currency, filters, setFilters, onEdit, onDelete, onDuplicate, isReadOnly }) {
  const rows = useMemo(() => {
    let list = [...enriched].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.created_at || 0) - (a.created_at || 0)));
    if (filters.result !== "ALL") list = list.filter((t) => t.result === filters.result);
    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      list = list.filter((t) =>
        (t.instrument || "").toLowerCase().includes(q) ||
        (t.strategy || "").toLowerCase().includes(q) ||
        (t.notes || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [enriched, filters]);

  return (
    <div className="rrj-card p-4 md:p-5 mb-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div style={{ fontFamily: F.display, fontSize: 16, fontWeight: 600 }}>Trade History</div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <Filter size={13} color={COLORS.textFaint} />
            {["ALL", ...RESULTS].map((r) => (
              <button
                key={r}
                onClick={() => setFilters((f) => ({ ...f, result: r }))}
                className="rrj-pill px-2.5 py-1"
                style={{
                  fontSize: 11.5,
                  background: filters.result === r ? (r === "ALL" ? COLORS.accent : RESULT_META[r].color) : undefined,
                  color: filters.result === r ? "#06121F" : undefined,
                  borderColor: filters.result === r ? "transparent" : undefined,
                }}
              >
                {r}
              </button>
            ))}
          </div>
          <input
            className="rrj-input px-2.5 py-1.5"
            style={{ fontSize: 12.5, width: 150 }}
            placeholder="Search instrument…"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState text="No trades match. Log a trade from the calendar to get started." />
      ) : (
        <div className="overflow-x-auto rrj-scroll">
          <table className="w-full" style={{ borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                {["Date", "Instrument", "Dir", "Result", "Risk %", "Risk $", "RR", "P&L", "Strategy", ""].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontSize: 10.5, color: COLORS.textFaint, fontFamily: F.mono, letterSpacing: 0.5 }}>
                    {h.toUpperCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const meta = RESULT_META[t.result];
                return (
                  <tr key={t.trade_id} style={{ borderBottom: `1px solid ${COLORS.borderSoft}` }}>
                    <td style={{ padding: "9px 10px", fontSize: 12.5, fontFamily: F.mono, color: COLORS.textDim }}>{t.date}</td>
                    <td style={{ padding: "9px 10px", fontSize: 12.5 }}>{t.instrument || "—"}</td>
                    <td style={{ padding: "9px 10px", fontSize: 12.5 }}>
                      {t.direction ? (
                        <span className="flex items-center gap-1" style={{ color: t.direction === "Buy" ? COLORS.green : COLORS.red }}>
                          {t.direction === "Buy" ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{t.direction}
                        </span>
                      ) : "—"}
                    </td>
                    <td style={{ padding: "9px 10px" }}>
                      <span className="px-2 py-0.5" style={{ fontSize: 11, borderRadius: 999, background: meta.dim, color: meta.color }}>{meta.short}</span>
                    </td>
                    <td style={{ padding: "9px 10px", fontSize: 12.5, fontFamily: F.mono }}>{Number(t.risk_percentage).toFixed(2)}%</td>
                    <td style={{ padding: "9px 10px", fontSize: 12.5, fontFamily: F.mono, color: COLORS.textDim }}>{fmtMoney(t.risk_amount, currency)}</td>
                    <td style={{ padding: "9px 10px", fontSize: 12.5, fontFamily: F.mono, color: t.actual_rr > 0 ? COLORS.green : t.actual_rr < 0 ? COLORS.red : COLORS.textDim }}>{fmtRR(t.actual_rr)}</td>
                    <td style={{ padding: "9px 10px", fontSize: 12.5, fontFamily: F.mono, color: t.pnl > 0 ? COLORS.green : t.pnl < 0 ? COLORS.red : COLORS.textDim }}>{fmtMoney(t.pnl, currency)}</td>
                    <td style={{ padding: "9px 10px", fontSize: 12.5, color: COLORS.textDim }}>{t.strategy || "—"}</td>
                    <td style={{ padding: "9px 10px" }}>
                      {isReadOnly ? (
                        <button className="rrj-btn p-1.5" onClick={() => onEdit(t)} title="View day"><Pencil size={12} style={{ opacity: 0.5 }} /></button>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button className="rrj-btn p-1.5" onClick={() => onEdit(t)} title="Edit / view day"><Pencil size={12} /></button>
                          <button className="rrj-btn p-1.5" onClick={() => onDuplicate(t)} title="Duplicate"><Copy size={12} /></button>
                          <button className="rrj-btn p-1.5" onClick={() => onDelete(t.trade_id)} title="Delete"><Trash2 size={12} color={COLORS.red} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- monthly analytics -------------------------------- */

function MiniStat({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: COLORS.textFaint }}>{label}</div>
      <div style={{ fontFamily: F.mono, fontSize: 15, fontWeight: 600, color: color || COLORS.text }}>{value}</div>
    </div>
  );
}

function MonthlyAnalyticsSection({ viewDate, metrics, currency }) {
  return (
    <div className="rrj-card p-4 md:p-5 mb-5">
      <div style={{ fontFamily: F.display, fontSize: 16, fontWeight: 600 }} className="mb-4">
        Monthly Analytics — {MONTHS[viewDate.m]} {viewDate.y}
      </div>
      {metrics.total === 0 ? (
        <EmptyState text="No trades this month yet — analytics will populate as you log them." />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MiniStat label="Total Trades" value={metrics.total} />
          <MiniStat label="TP / SL / BE / NC" value={`${metrics.counts.TP}/${metrics.counts.SL}/${metrics.counts.BE}/${metrics.counts.NC}`} />
          <MiniStat label="Win Rate" value={`${metrics.winRate.toFixed(1)}%`} />
          <MiniStat label="Net RR" value={fmtRR(metrics.netRR)} color={metrics.netRR >= 0 ? COLORS.green : COLORS.red} />
          <MiniStat label="Avg RR" value={fmtRR(metrics.avgRR)} />
          <MiniStat label="Total P&L" value={fmtMoney(metrics.totalPnl, currency)} color={metrics.totalPnl >= 0 ? COLORS.green : COLORS.red} />
          <MiniStat label="Growth" value={fmtPct(metrics.growthPct)} color={metrics.growthPct >= 0 ? COLORS.green : COLORS.red} />
          <MiniStat label="Profit Factor" value={metrics.profitFactor === Infinity ? "∞" : metrics.profitFactor.toFixed(2)} />
          <MiniStat label="Max Drawdown" value={`${metrics.maxDD.toFixed(2)}%`} color={metrics.maxDD > 0 ? COLORS.red : COLORS.text} />
          <MiniStat label="Longest Win Streak" value={metrics.longestWin} color={COLORS.green} />
          <MiniStat label="Longest Loss Streak" value={metrics.longestLoss} color={COLORS.red} />
          <MiniStat label="Best Trade" value={metrics.best ? fmtMoney(metrics.best.pnl, currency) : "—"} color={COLORS.green} />
          <MiniStat label="Worst Trade" value={metrics.worst ? fmtMoney(metrics.worst.pnl, currency) : "—"} color={COLORS.red} />
        </div>
      )}
    </div>
  );
}

/* -------------------------------- empty state -------------------------------- */

function EmptyState({ text }) {
  return (
    <div className="flex items-center justify-center py-8 text-center" style={{ color: COLORS.textFaint, fontSize: 13 }}>
      {text}
    </div>
  );
}

/* -------------------------------- trade modal -------------------------------- */

function emptyTradeForm(dateKeyStr, portfolio) {
  return {
    date: dateKeyStr,
    result: "TP",
    risk_percentage: portfolio.default_risk_percentage,
    riskCustom: false,
    tp_rr: portfolio.default_tp_rr,
    rrCustom: false,
    instrument: "",
    direction: "Buy",
    entry_price: "",
    stop_loss: "",
    take_profit: "",
    lot_size: "",
    strategy: "",
    timeframe: "",
    notes: "",
    screenshot_before: null,
    screenshot_after: null,
  };
}

function TradeModal({ dateKey: dk, portfolio, trades, onClose, onAdd, onEdit, onDelete, onDuplicate, isReadOnly }) {
  const [form, setForm] = useState(() => emptyTradeForm(dk, portfolio));
  const [editingId, setEditingId] = useState(null);
  const [showMore, setShowMore] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const fileRefBefore = useRef(null);
  const fileRefAfter = useRef(null);

  function startEdit(t) {
    setEditingId(t.trade_id);
    setForm({
      date: t.date,
      result: t.result,
      risk_percentage: t.risk_percentage,
      riskCustom: !RISK_PRESETS.includes(Number(t.risk_percentage)),
      tp_rr: t.tp_rr || portfolio.default_tp_rr,
      rrCustom: !RR_PRESETS.includes(Number(t.tp_rr)),
      instrument: t.instrument || "",
      direction: t.direction || "Buy",
      entry_price: t.entry_price || "",
      stop_loss: t.stop_loss || "",
      take_profit: t.take_profit || "",
      lot_size: t.lot_size || "",
      strategy: t.strategy || "",
      timeframe: t.timeframe || "",
      notes: t.notes || "",
      screenshot_before: t.screenshot_before || null,
      screenshot_after: t.screenshot_after || null,
    });
    setShowMore(true);
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyTradeForm(dk, portfolio));
    setShowMore(false);
  }

  function save() {
    const payload = {
      date: dk,
      result: form.result,
      risk_percentage: Number(form.risk_percentage) || 0,
      tp_rr: form.result === "TP" ? Number(form.tp_rr) || 1 : null,
      instrument: form.instrument || "",
      direction: form.direction,
      entry_price: form.entry_price,
      stop_loss: form.stop_loss,
      take_profit: form.take_profit,
      lot_size: form.lot_size,
      strategy: form.strategy,
      timeframe: form.timeframe,
      notes: form.notes,
      screenshot_before: form.screenshot_before,
      screenshot_after: form.screenshot_after,
    };
    if (editingId) onEdit(editingId, payload);
    else onAdd(payload);
    resetForm();
  }

  function handleFile(e, field) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, [field]: reader.result }));
    reader.readAsDataURL(file);
  }

  const dayMetrics = computeMetrics(enrichTrades(trades, portfolio.starting_capital, false), portfolio.starting_capital);

  return (
    <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center p-0 md:p-4" style={{ background: "rgba(4,6,10,0.72)" }} onClick={onClose}>
      <div
        className="rrj-fade-in w-full md:max-w-2xl rrj-card"
        style={{ maxHeight: "92vh", overflowY: "auto", borderRadius: "16px 16px 0 0" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between px-4 md:px-5 py-3.5" style={{ background: COLORS.panel, borderBottom: `1px solid ${COLORS.border}`, borderRadius: "16px 16px 0 0" }}>
          <div>
            <div style={{ fontFamily: F.display, fontSize: 16, fontWeight: 600 }}>{dk}</div>
            {trades.length > 0 && (
              <div style={{ fontSize: 11.5, color: COLORS.textDim }}>
                {trades.length} trade{trades.length > 1 ? "s" : ""} · Net {fmtRR(dayMetrics.netRR)} · {fmtMoney(dayMetrics.totalPnl, portfolio.currency)}
              </div>
            )}
          </div>
          <button className="rrj-btn p-1.5" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="px-4 md:px-5 py-4">
          {trades.length > 0 && (
            <div className="mb-5">
              <div style={{ fontSize: 12, color: COLORS.textFaint, marginBottom: 8 }}>LOGGED TRADES</div>
              <div className="flex flex-col gap-2">
                {trades.map((t) => {
                  const meta = RESULT_META[t.result];
                  return (
                    <div key={t.trade_id} className="px-3 py-2" style={{ background: COLORS.panel2, borderRadius: 8, border: `1px solid ${COLORS.borderSoft}` }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-2 py-0.5" style={{ fontSize: 11, borderRadius: 999, background: meta.dim, color: meta.color }}>{meta.short}</span>
                          <span style={{ fontSize: 12.5 }}>{t.instrument || "Untitled"}</span>
                          <span style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.textDim }}>{t.risk_percentage}% risk</span>
                          {t.result === "TP" && <span style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.textDim }}>1:{t.tp_rr}</span>}
                        </div>
                        {!isReadOnly && (
                          <div className="flex items-center gap-1">
                            <button className="rrj-btn p-1.5" onClick={() => startEdit(t)}><Pencil size={12} /></button>
                            <button className="rrj-btn p-1.5" onClick={() => onDuplicate(t)}><Copy size={12} /></button>
                            <button className="rrj-btn p-1.5" onClick={() => onDelete(t.trade_id)}><Trash2 size={12} color={COLORS.red} /></button>
                          </div>
                        )}
                      </div>
                      {(t.screenshot_before || t.screenshot_after) && (
                        <div className="flex items-center gap-2 mt-2">
                          {t.screenshot_before && (
                            <button onClick={() => setLightbox({ src: t.screenshot_before, label: "Before" })} className="flex flex-col items-start gap-1">
                              <img src={t.screenshot_before} alt="before" style={{ height: 52, borderRadius: 6, border: `1px solid ${COLORS.border}`, objectFit: "cover" }} />
                              <span style={{ fontSize: 9.5, color: COLORS.textFaint }}>Before</span>
                            </button>
                          )}
                          {t.screenshot_after && (
                            <button onClick={() => setLightbox({ src: t.screenshot_after, label: "After" })} className="flex flex-col items-start gap-1">
                              <img src={t.screenshot_after} alt="after" style={{ height: 52, borderRadius: 6, border: `1px solid ${COLORS.border}`, objectFit: "cover" }} />
                              <span style={{ fontSize: 9.5, color: COLORS.textFaint }}>After</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {lightbox && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-6"
              style={{ background: "rgba(4,6,10,0.9)" }}
              onClick={() => setLightbox(null)}
            >
              <div className="flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between w-full">
                  <span style={{ fontSize: 13, color: COLORS.textDim }}>{lightbox.label}</span>
                  <button className="rrj-btn p-1.5" onClick={() => setLightbox(null)}><X size={16} /></button>
                </div>
                <img src={lightbox.src} alt={lightbox.label} style={{ maxHeight: "80vh", maxWidth: "100%", borderRadius: 10, border: `1px solid ${COLORS.border}` }} />
              </div>
            </div>
          )}

          {isReadOnly ? (
            trades.length === 0 && (
              <div className="flex items-center justify-center py-6 text-center" style={{ color: COLORS.textFaint, fontSize: 13 }}>
                No trades logged for this day.
              </div>
            )
          ) : (
          <>
          <div style={{ fontSize: 12, color: COLORS.textFaint, marginBottom: 8 }}>{editingId ? "EDIT TRADE" : "ADD TRADE"}</div>

          <FieldLabel>Trade Result</FieldLabel>
          <div className="grid grid-cols-4 gap-2 mb-4">
            {RESULTS.map((r) => (
              <button
                key={r}
                onClick={() => setForm((f) => ({ ...f, result: r }))}
                className="rrj-pill py-2"
                style={{
                  fontSize: 12.5,
                  background: form.result === r ? RESULT_META[r].color : undefined,
                  color: form.result === r ? "#06121F" : undefined,
                  borderColor: form.result === r ? "transparent" : undefined,
                  fontWeight: form.result === r ? 600 : 400,
                }}
              >
                {r}
              </button>
            ))}
          </div>

          <FieldLabel>Risk Per Trade</FieldLabel>
          <div className="flex flex-wrap gap-2 mb-4">
            {RISK_PRESETS.map((r) => (
              <button
                key={r}
                onClick={() => setForm((f) => ({ ...f, risk_percentage: r, riskCustom: false }))}
                className="rrj-pill px-3 py-1.5"
                style={{
                  fontSize: 12.5,
                  background: !form.riskCustom && Number(form.risk_percentage) === r ? COLORS.accent : undefined,
                  color: !form.riskCustom && Number(form.risk_percentage) === r ? "#06121F" : undefined,
                  borderColor: !form.riskCustom && Number(form.risk_percentage) === r ? "transparent" : undefined,
                }}
              >
                {r}%
              </button>
            ))}
            <button
              onClick={() => setForm((f) => ({ ...f, riskCustom: true }))}
              className="rrj-pill px-3 py-1.5"
              style={{ fontSize: 12.5, background: form.riskCustom ? COLORS.accent : undefined, color: form.riskCustom ? "#06121F" : undefined, borderColor: form.riskCustom ? "transparent" : undefined }}
            >
              Custom
            </button>
            {form.riskCustom && (
              <input
                type="number" step="0.01" min="0"
                className="rrj-input px-2.5 py-1.5" style={{ width: 90, fontSize: 12.5 }}
                value={form.risk_percentage}
                onChange={(e) => setForm((f) => ({ ...f, risk_percentage: e.target.value }))}
                placeholder="%"
              />
            )}
          </div>

          {form.result === "TP" && (
            <>
              <FieldLabel>TP RR</FieldLabel>
              <div className="flex flex-wrap gap-2 mb-4">
                {RR_PRESETS.map((rr) => (
                  <button
                    key={rr}
                    onClick={() => setForm((f) => ({ ...f, tp_rr: rr, rrCustom: false }))}
                    className="rrj-pill px-3 py-1.5"
                    style={{
                      fontSize: 12.5,
                      background: !form.rrCustom && Number(form.tp_rr) === rr ? COLORS.green : undefined,
                      color: !form.rrCustom && Number(form.tp_rr) === rr ? "#06121F" : undefined,
                      borderColor: !form.rrCustom && Number(form.tp_rr) === rr ? "transparent" : undefined,
                    }}
                  >
                    1:{rr}
                  </button>
                ))}
                <button
                  onClick={() => setForm((f) => ({ ...f, rrCustom: true }))}
                  className="rrj-pill px-3 py-1.5"
                  style={{ fontSize: 12.5, background: form.rrCustom ? COLORS.green : undefined, color: form.rrCustom ? "#06121F" : undefined, borderColor: form.rrCustom ? "transparent" : undefined }}
                >
                  Custom
                </button>
                {form.rrCustom && (
                  <input
                    type="number" step="0.1" min="0"
                    className="rrj-input px-2.5 py-1.5" style={{ width: 90, fontSize: 12.5 }}
                    value={form.tp_rr}
                    onChange={(e) => setForm((f) => ({ ...f, tp_rr: e.target.value }))}
                    placeholder="RR"
                  />
                )}
              </div>
            </>
          )}

          <LivePreview form={form} portfolio={portfolio} />

          <button
            className="flex items-center gap-1.5 mt-4 mb-3"
            style={{ fontSize: 12.5, color: COLORS.accent }}
            onClick={() => setShowMore((v) => !v)}
          >
            <ChevronDown size={14} style={{ transform: showMore ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
            Optional trade details
          </button>

          {showMore && (
            <div className="grid grid-cols-2 gap-3 mb-2 rrj-fade-in">
              <TextField label="Instrument" value={form.instrument} onChange={(v) => setForm((f) => ({ ...f, instrument: v }))} placeholder="EURUSD" />
              <div>
                <FieldLabel>Direction</FieldLabel>
                <div className="flex gap-2">
                  {["Buy", "Sell"].map((d) => (
                    <button
                      key={d}
                      onClick={() => setForm((f) => ({ ...f, direction: d }))}
                      className="rrj-pill px-3 py-1.5 flex-1"
                      style={{ fontSize: 12.5, background: form.direction === d ? (d === "Buy" ? COLORS.green : COLORS.red) : undefined, color: form.direction === d ? "#06121F" : undefined, borderColor: form.direction === d ? "transparent" : undefined }}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <TextField label="Entry Price" value={form.entry_price} onChange={(v) => setForm((f) => ({ ...f, entry_price: v }))} />
              <TextField label="Stop Loss" value={form.stop_loss} onChange={(v) => setForm((f) => ({ ...f, stop_loss: v }))} />
              <TextField label="Take Profit" value={form.take_profit} onChange={(v) => setForm((f) => ({ ...f, take_profit: v }))} />
              <TextField label="Lot Size" value={form.lot_size} onChange={(v) => setForm((f) => ({ ...f, lot_size: v }))} />
              <TextField label="Strategy / Setup" value={form.strategy} onChange={(v) => setForm((f) => ({ ...f, strategy: v }))} />
              <TextField label="Timeframe" value={form.timeframe} onChange={(v) => setForm((f) => ({ ...f, timeframe: v }))} placeholder="H1, H4, D1…" />
              <div className="col-span-2">
                <FieldLabel>Notes</FieldLabel>
                <textarea
                  className="rrj-input px-3 py-2 w-full" style={{ fontSize: 13, minHeight: 64 }}
                  value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
              <div className="col-span-2 grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Screenshot — Before</FieldLabel>
                  <input ref={fileRefBefore} type="file" accept="image/*" onChange={(e) => handleFile(e, "screenshot_before")} className="hidden" />
                  {form.screenshot_before ? (
                    <div className="relative inline-block">
                      <img src={form.screenshot_before} alt="before" style={{ maxHeight: 110, borderRadius: 8, border: `1px solid ${COLORS.border}` }} />
                      <button className="rrj-btn p-1 absolute top-1 right-1" onClick={() => setForm((f) => ({ ...f, screenshot_before: null }))}><X size={12} /></button>
                    </div>
                  ) : (
                    <button className="rrj-btn px-3 py-2 flex items-center gap-2 w-full justify-center" style={{ fontSize: 12.5 }} onClick={() => fileRefBefore.current && fileRefBefore.current.click()}>
                      <ImageIcon size={14} /> Upload
                    </button>
                  )}
                </div>
                <div>
                  <FieldLabel>Screenshot — After</FieldLabel>
                  <input ref={fileRefAfter} type="file" accept="image/*" onChange={(e) => handleFile(e, "screenshot_after")} className="hidden" />
                  {form.screenshot_after ? (
                    <div className="relative inline-block">
                      <img src={form.screenshot_after} alt="after" style={{ maxHeight: 110, borderRadius: 8, border: `1px solid ${COLORS.border}` }} />
                      <button className="rrj-btn p-1 absolute top-1 right-1" onClick={() => setForm((f) => ({ ...f, screenshot_after: null }))}><X size={12} /></button>
                    </div>
                  ) : (
                    <button className="rrj-btn px-3 py-2 flex items-center gap-2 w-full justify-center" style={{ fontSize: 12.5 }} onClick={() => fileRefAfter.current && fileRefAfter.current.click()}>
                      <ImageIcon size={14} /> Upload
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 mt-5 pt-4" style={{ borderTop: `1px solid ${COLORS.borderSoft}` }}>
            {editingId && (
              <button className="rrj-btn px-4 py-2.5" style={{ fontSize: 13 }} onClick={resetForm}>Cancel edit</button>
            )}
            <button className="rrj-btn-accent px-4 py-2.5 flex-1 flex items-center justify-center gap-1.5" style={{ fontSize: 13.5 }} onClick={save}>
              <Plus size={15} /> {editingId ? "Save changes" : "Add trade"}
            </button>
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  );
}

function LivePreview({ form, portfolio }) {
  const rr = form.result === "TP" ? Number(form.tp_rr) || 0 : form.result === "SL" ? -1 : 0;
  const riskAmount = portfolio.starting_capital * ((Number(form.risk_percentage) || 0) / 100);
  const pnl = riskAmount * rr;
  return (
    <div className="flex items-center justify-between px-3 py-2.5" style={{ background: COLORS.panel2, borderRadius: 8, border: `1px solid ${COLORS.borderSoft}` }}>
      <div style={{ fontSize: 11.5, color: COLORS.textFaint }}>Preview</div>
      <div className="flex items-center gap-4">
        <span style={{ fontFamily: F.mono, fontSize: 13, color: rr > 0 ? COLORS.green : rr < 0 ? COLORS.red : COLORS.textDim }}>{fmtRR(rr)}</span>
        <span style={{ fontFamily: F.mono, fontSize: 13, color: pnl > 0 ? COLORS.green : pnl < 0 ? COLORS.red : COLORS.textDim }}>{fmtMoney(pnl, portfolio.currency)}</span>
      </div>
    </div>
  );
}

function FieldLabel({ children }) {
  return <div style={{ fontSize: 12, color: COLORS.textFaint, marginBottom: 6 }}>{children}</div>;
}

function TextField({ label, value, onChange, placeholder }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input className="rrj-input px-3 py-2 w-full" style={{ fontSize: 13 }} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/* -------------------------------- settings modal -------------------------------- */

function SettingsModal({ portfolio, onClose, onSave }) {
  const [form, setForm] = useState({
    name: portfolio.name,
    starting_capital: portfolio.starting_capital,
    currency: portfolio.currency,
    default_risk_percentage: portfolio.default_risk_percentage,
    default_tp_rr: portfolio.default_tp_rr,
    compounding_enabled: portfolio.compounding_enabled,
    max_risk_percentage: portfolio.max_risk_percentage,
    max_daily_loss_percentage: portfolio.max_daily_loss_percentage,
    max_trades_per_day: portfolio.max_trades_per_day,
  });

  function save() {
    onSave({
      ...form,
      starting_capital: Number(form.starting_capital) || 0,
      default_risk_percentage: Number(form.default_risk_percentage) || 0,
      default_tp_rr: Number(form.default_tp_rr) || 1,
      max_risk_percentage: Number(form.max_risk_percentage) || 0,
      max_daily_loss_percentage: Number(form.max_daily_loss_percentage) || 0,
      max_trades_per_day: Number(form.max_trades_per_day) || 0,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center p-0 md:p-4" style={{ background: "rgba(4,6,10,0.72)" }} onClick={onClose}>
      <div className="rrj-fade-in w-full md:max-w-lg rrj-card" style={{ maxHeight: "92vh", overflowY: "auto", borderRadius: "16px 16px 0 0" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: `1px solid ${COLORS.border}` }}>
          <div style={{ fontFamily: F.display, fontSize: 16, fontWeight: 600 }}>Risk Management Settings</div>
          <button className="rrj-btn p-1.5" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="px-5 py-4 grid grid-cols-2 gap-3">
          <div className="col-span-2"><TextField label="Portfolio name" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} /></div>
          <TextField label="Starting capital" value={form.starting_capital} onChange={(v) => setForm((f) => ({ ...f, starting_capital: v }))} />
          <div>
            <FieldLabel>Currency</FieldLabel>
            <select className="rrj-input px-3 py-2 w-full" style={{ fontSize: 13 }} value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <TextField label="Default risk %" value={form.default_risk_percentage} onChange={(v) => setForm((f) => ({ ...f, default_risk_percentage: v }))} />
          <TextField label="Default TP RR" value={form.default_tp_rr} onChange={(v) => setForm((f) => ({ ...f, default_tp_rr: v }))} />
          <TextField label="Max risk % per trade" value={form.max_risk_percentage} onChange={(v) => setForm((f) => ({ ...f, max_risk_percentage: v }))} />
          <TextField label="Max daily loss %" value={form.max_daily_loss_percentage} onChange={(v) => setForm((f) => ({ ...f, max_daily_loss_percentage: v }))} />
          <TextField label="Max trades / day" value={form.max_trades_per_day} onChange={(v) => setForm((f) => ({ ...f, max_trades_per_day: v }))} />
          <div className="col-span-2 flex items-center justify-between px-3 py-2.5 mt-1" style={{ background: COLORS.panel2, borderRadius: 8, border: `1px solid ${COLORS.borderSoft}` }}>
            <div>
              <div style={{ fontSize: 13 }}>Compounding</div>
              <div style={{ fontSize: 11, color: COLORS.textFaint }}>Risk % is based on current balance instead of starting capital</div>
            </div>
            <button
              onClick={() => setForm((f) => ({ ...f, compounding_enabled: !f.compounding_enabled }))}
              style={{ width: 40, height: 22, borderRadius: 999, background: form.compounding_enabled ? COLORS.accent : COLORS.border, position: "relative", flexShrink: 0 }}
            >
              <span style={{ position: "absolute", top: 2, left: form.compounding_enabled ? 20 : 2, width: 18, height: 18, borderRadius: 999, background: "#fff", transition: "left .15s" }} />
            </button>
          </div>
        </div>
        <div className="px-5 pb-5">
          <button className="rrj-btn-accent w-full py-2.5" style={{ fontSize: 13.5 }} onClick={save}>Save settings</button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- new portfolio modal -------------------------------- */

function NewPortfolioModal({ onClose, onCreate }) {
  const [name, setName] = useState("");
  const [capital, setCapital] = useState(10000);
  return (
    <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center p-0 md:p-4" style={{ background: "rgba(4,6,10,0.72)" }} onClick={onClose}>
      <div className="rrj-fade-in w-full md:max-w-sm rrj-card" style={{ borderRadius: "16px 16px 0 0" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: `1px solid ${COLORS.border}` }}>
          <div style={{ fontFamily: F.display, fontSize: 16, fontWeight: 600 }}>New Portfolio</div>
          <button className="rrj-btn p-1.5" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="px-5 py-4 flex flex-col gap-3">
          <TextField label="Name" value={name} onChange={setName} placeholder="e.g. 50K Prop Account" />
          <TextField label="Starting capital" value={capital} onChange={setCapital} />
        </div>
        <div className="px-5 pb-5">
          <button
            className="rrj-btn-accent w-full py-2.5" style={{ fontSize: 13.5 }}
            onClick={() => name.trim() && onCreate(name.trim(), Number(capital) || 0)}
          >
            Create portfolio
          </button>
        </div>
      </div>
    </div>
  );
}
