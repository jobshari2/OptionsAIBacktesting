import { useState, useEffect, useRef } from 'react';
import { adaptiveApi } from '../api/client';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, BarChart, Bar, Cell, AreaChart, Area,
    PieChart, Pie,
} from 'recharts';

const REGIME_COLORS: Record<string, string> = {
    RANGE_BOUND: '#06b6d4',
    TREND_UP: '#10b981',
    TREND_DOWN: '#ef4444',
    HIGH_VOLATILITY: '#f97316',
    LOW_VOLATILITY: '#a855f7',
};

const REGIME_ICONS: Record<string, string> = {
    RANGE_BOUND: '↔️',
    TREND_UP: '📈',
    TREND_DOWN: '📉',
    HIGH_VOLATILITY: '🌊',
    LOW_VOLATILITY: '😴',
};

const ADJ_TYPE_COLORS: Record<string, string> = {
    condor_breakout: '#f59e0b',
    risk_reduction: '#ef4444',
    trend_reversal: '#3b82f6',
    time_decay: '#8b5cf6',
};

const ADJ_TYPE_ICONS: Record<string, string> = {
    condor_breakout: '💥',
    risk_reduction: '🛡️',
    trend_reversal: '🔄',
    time_decay: '⏳',
};

export default function AdaptiveDashboard() {
    // --- State ---
    const [activeTab, setActiveTab] = useState<'backtest' | 'risk' | 'adjustments' | 'greeks'>('backtest');
    const [showDocs, setShowDocs] = useState(false);

    // Backtest params
    const [startDate, setStartDate] = useState('2024-01-01');
    const [endDate, setEndDate] = useState('2024-06-01');
    const [initialCapital, setInitialCapital] = useState('1000000');
    const [checkInterval, setCheckInterval] = useState('15');
    const [minConfidence, setMinConfidence] = useState('0.6');
    const [switchCooldown] = useState('30');
    const [maxDelta, setMaxDelta] = useState('500');
    const [enableAdjustments, setEnableAdjustments] = useState(true);
    const [running, setRunning] = useState(false);
    const [runId, setRunId] = useState('');
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState('');
    const [statusMsg, setStatusMsg] = useState('');
    const [selectedResultExpiry, setSelectedResultExpiry] = useState<string | null>(null);
    const pollRef = useRef<any>(null);

    // Expiry multi-select
    const [availableExpiries, setAvailableExpiries] = useState<{ folder_name: string, date_str: string }[]>([]);
    const [selectedExpiries, setSelectedExpiries] = useState<string[]>([]);
    const [loadingExpiries, setLoadingExpiries] = useState(false);
    const [expirySearchTerm, setExpirySearchTerm] = useState('');

    // --- Load expiries ---
    const loadExpiries = async () => {
        setLoadingExpiries(true);
        try {
            const data = await adaptiveApi.listExpiries();
            setAvailableExpiries(data.expiries || []);
        } catch (e: any) {
            console.error('Failed to load expiries:', e);
        }
        setLoadingExpiries(false);
    };

    useEffect(() => { loadExpiries(); }, []);

    // --- Poll for status ---
    const startPolling = (rid: string) => {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
            try {
                const status = await adaptiveApi.getStatus(rid);
                setStatusMsg(status.message || status.status);
                if (status.status === 'completed') {
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                    // Fetch full result
                    const fullResult = await adaptiveApi.getResult(rid);
                    setResult(fullResult);
                    setRunning(false);
                    setStatusMsg('');
                } else if (status.status === 'error' || status.status === 'stopped') {
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                    setRunning(false);
                    if (status.status === 'error') setError(status.message || 'Backtest failed');
                    setStatusMsg(status.status === 'stopped' ? 'Stopped by user' : '');
                }
            } catch (e) {
                // ignore polling errors
            }
        }, 2000);
    };

    useEffect(() => {
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, []);

    // --- Actions ---
    const runAdaptiveBacktest = async () => {
        setRunning(true);
        setError('');
        setResult(null);
        setStatusMsg('Starting...');
        try {
            const data = await adaptiveApi.run({
                start_date: startDate || null,
                end_date: endDate || null,
                initial_capital: parseFloat(initialCapital) || 1000000,
                regime_check_interval: Math.max(1, parseInt(checkInterval) || 15),
                min_confidence: parseFloat(minConfidence) || 0.6,
                switch_cooldown: parseInt(switchCooldown) || 30,
                max_delta: parseFloat(maxDelta) || 500,
                enable_adjustments: enableAdjustments,
                selected_expiries: selectedExpiries.length > 0 ? selectedExpiries : null,
            });
            setRunId(data.run_id);
            startPolling(data.run_id);
        } catch (e: any) {
            setError(e.message || 'Adaptive backtest failed');
            setRunning(false);
        }
    };

    const stopBacktest = async () => {
        if (!runId) return;
        try {
            await adaptiveApi.stop(runId);
            setStatusMsg('Stopping...');
        } catch (e: any) {
            setError(e.message || 'Failed to stop');
        }
    };

    // Expiry selection helpers
    const updateDatesFromSelection = (selection: string[]) => {
        if (selection.length > 0) {
            let minDateObj: Date | null = null;
            let maxDateObj: Date | null = null;

            selection.forEach(selFolder => {
                const exp = availableExpiries.find(e => e.folder_name === selFolder);
                if (exp && exp.date_str) {
                    const parts = exp.date_str.split('/'); // Assuming DD/MM/YYYY
                    if (parts.length === 3) {
                        const day = parseInt(parts[0], 10);
                        const month = parseInt(parts[1], 10) - 1; // JS months are 0-indexed
                        const year = parseInt(parts[2], 10);

                        const dateObj = new Date(Date.UTC(year, month, day));

                        if (!minDateObj || dateObj < minDateObj) minDateObj = dateObj;
                        if (!maxDateObj || dateObj > maxDateObj) maxDateObj = dateObj;
                    }
                }
            });

            if (minDateObj && maxDateObj) {
                const startDateObj = new Date(minDateObj);
                startDateObj.setUTCDate(startDateObj.getUTCDate() - 10);

                setStartDate(startDateObj.toISOString().split('T')[0]);
                setEndDate((maxDateObj as Date).toISOString().split('T')[0]);
            }
        }
    };

    const toggleExpiry = (folder: string) => {
        const isSelected = selectedExpiries.includes(folder);
        const newSelected = isSelected
            ? selectedExpiries.filter(f => f !== folder)
            : [...selectedExpiries, folder];

        setSelectedExpiries(newSelected);
        updateDatesFromSelection(newSelected);
    };

    const selectAllExpiries = () => {
        const all = availableExpiries.map(e => e.folder_name);
        setSelectedExpiries(all);
        updateDatesFromSelection(all);
    };

    const clearExpiries = () => {
        setSelectedExpiries([]);
    };

    const filteredExpiries = expirySearchTerm
        ? availableExpiries.filter(e =>
            e.folder_name.toLowerCase().includes(expirySearchTerm.toLowerCase()) ||
            e.date_str.includes(expirySearchTerm))
        : availableExpiries;

    // --- Derived data ---
    const equityCurveData = (result?.equity_curve || []).map((ec: any, i: number) => ({
        idx: i, equity: ec.equity, timestamp: ec.timestamp,
    }));

    const greeksTimelineData = (result?.greeks_timeline || []).map((g: any, i: number) => ({
        idx: i, timestamp: g.timestamp?.substring(11, 16) || i,
        delta: g.net_delta, gamma: g.net_gamma * 100,
        theta: g.net_theta, vega: g.net_vega,
        pnl: g.total_pnl, spot: g.spot_price,
    }));

    const strategyBreakdownData = Object.entries(result?.strategy_breakdown || {}).map(
        ([name, data]: [string, any]) => ({
            name: name.replace(/_/g, ' '), pnl: data.pnl,
            trades: data.trades, win_rate: data.win_rate,
        })
    );

    const regimeBreakdownData = Object.entries(result?.regime_breakdown || {}).map(
        ([regime, data]: [string, any]) => ({
            name: regime, expiries: data.expiries,
            pnl: data.pnl, color: REGIME_COLORS[regime] || '#8899b4',
        })
    );

    const adjustmentsByType = (result?.adjustment_history || []).reduce((acc: any, a: any) => {
        acc[a.adjustment_type] = (acc[a.adjustment_type] || 0) + 1;
        return acc;
    }, {});

    const riskEventsByType = (result?.risk_events || []).reduce((acc: any, e: any) => {
        acc[e.event_type] = (acc[e.event_type] || 0) + 1;
        return acc;
    }, {});

    // --- Tabs ---
    const tabs = [
        { id: 'backtest', label: '⚡ Adaptive Backtest' },
        { id: 'risk', label: '🛡️ Risk Dashboard' },
        { id: 'adjustments', label: '🔄 Adjustments' },
        { id: 'greeks', label: '📐 Greeks Monitor' },
    ];

    return (
        <div className="fade-in">
            {/* Header Stats */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <div className="metric-card" style={{ flex: 1, minWidth: 140 }}>
                    <div className="metric-label">Total PnL</div>
                    <div className={`metric-value ${(result?.total_pnl || 0) >= 0 ? 'positive' : 'negative'}`}
                        style={{ fontSize: 18 }}>
                        ₹{(result?.total_pnl || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                </div>
                <div className="metric-card" style={{ flex: 1, minWidth: 140 }}>
                    <div className="metric-label">Trades</div>
                    <div className="metric-value" style={{ fontSize: 18 }}>{result?.total_trades || 0}</div>
                </div>
                <div className="metric-card" style={{ flex: 1, minWidth: 140 }}>
                    <div className="metric-label">Strategy Switches</div>
                    <div className="metric-value" style={{ fontSize: 18, color: 'var(--orange)' }}>
                        {result?.total_switches || 0}
                    </div>
                </div>
                <div className="metric-card" style={{ flex: 1, minWidth: 140 }}>
                    <div className="metric-label">Adjustments</div>
                    <div className="metric-value" style={{ fontSize: 18, color: 'var(--yellow)' }}>
                        {result?.total_adjustments || 0}
                    </div>
                </div>
                <div className="metric-card" style={{ flex: 1, minWidth: 140 }}>
                    <div className="metric-label">Risk Events</div>
                    <div className="metric-value" style={{ fontSize: 18, color: 'var(--red)' }}>
                        {(result?.risk_events || []).length}
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="tabs">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        className={`tab ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.id as any)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* === TAB: Adaptive Backtest === */}
            {activeTab === 'backtest' && (
                <div>
                    {/* Documentation Section */}
                    <div className="card" style={{ marginBottom: 16 }}>
                        <div className="card-header" style={{ cursor: 'pointer', userSelect: 'none' }}
                            onClick={() => setShowDocs(!showDocs)}>
                            <div className="card-title">📖 How to Use This Screen</div>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                {showDocs ? '▲ Collapse' : '▼ Expand'}
                            </span>
                        </div>
                        {showDocs && (
                            <div style={{ padding: '0 4px', lineHeight: 1.7, fontSize: 13 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                                    <div>
                                        <h4 style={{ color: 'var(--accent-primary)', marginBottom: 8, fontSize: 14 }}>🚀 Quick Start</h4>
                                        <ol style={{ paddingLeft: 18, margin: 0, color: 'var(--text-secondary)' }}>
                                            <li>Set your <b>Start/End dates</b> to define the backtest period</li>
                                            <li>Optionally select specific <b>expiries</b> from the dropdown (leave empty to use all)</li>
                                            <li>Configure risk parameters (<b>Max Risk %</b>, <b>Max Δ Delta</b>)</li>
                                            <li>Click <b>⚡ Run Adaptive Backtest</b> — it runs in the background</li>
                                            <li>Use the <b>🛑 Stop</b> button to terminate early if needed</li>
                                            <li>Review results across the 4 tabs: Backtest, Risk, Adjustments, Greeks</li>
                                        </ol>
                                    </div>
                                    <div>
                                        <h4 style={{ color: 'var(--accent-primary)', marginBottom: 8, fontSize: 14 }}>⚙️ Parameters Guide</h4>
                                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                                                <b>Check Interval</b><span>Minutes between regime re-evaluation (min: 1)</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                                                <b>Min Confidence</b><span>Regime detection threshold (0–1). Higher = fewer switches</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                                                <b>Max Risk %</b><span>Maximum loss per trade as % of capital</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                                                <b>Max Δ</b><span>Maximum absolute portfolio delta exposure</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                                                <b>Adjustments</b><span>Enable/disable Cottle-style strategy conversions</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                                                <b>Selected Expiries</b><span>Run on specific dates only (empty = all)</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                    <div>
                                        <h4 style={{ color: 'var(--accent-primary)', marginBottom: 8, fontSize: 14 }}>🔄 Adjustment Types</h4>
                                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                            <div style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                                                <b style={{ color: '#f59e0b' }}>💥 Condor Breakout</b> — Convert iron condor to vertical spread when spot breaches a wing
                                            </div>
                                            <div style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                                                <b style={{ color: '#ef4444' }}>🛡️ Risk Reduction</b> — Reduce straddle/strangle to single-sided when IV spikes
                                            </div>
                                            <div style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                                                <b style={{ color: '#3b82f6' }}>🔄 Trend Reversal</b> — Flip directional bias when regime transitions
                                            </div>
                                            <div style={{ padding: '4px 0' }}>
                                                <b style={{ color: '#8b5cf6' }}>⏳ Time Decay</b> — Convert to calendar spread for theta optimization
                                            </div>
                                        </div>
                                    </div>
                                    <div>
                                        <h4 style={{ color: 'var(--accent-primary)', marginBottom: 8, fontSize: 14 }}>📊 Tabs Overview</h4>
                                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                            <div style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                                                <b>⚡ Adaptive Backtest</b> — Configure & run, see equity curve, regime & strategy breakdown
                                            </div>
                                            <div style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                                                <b>🛡️ Risk Dashboard</b> — Risk events log, breach alerts, drawdown tracking
                                            </div>
                                            <div style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                                                <b>🔄 Adjustments</b> — View every strategy conversion with reason and PnL impact
                                            </div>
                                            <div style={{ padding: '4px 0' }}>
                                                <b>📐 Greeks Monitor</b> — Delta, Theta, Vega exposure charts over time
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Backtest Controls Card */}
                    <div className="card" style={{ marginBottom: 16 }}>
                        <div className="card-header">
                            <div className="card-title">⚡ Run Adaptive Backtest</div>
                            <div className="card-subtitle">Full engine: regime detection → strategy selection → adjustments → risk management → Greeks monitoring</div>
                        </div>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                            <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label">Start Date</label>
                                <input className="form-input" type="date" value={startDate}
                                    onChange={e => setStartDate(e.target.value)} />
                            </div>
                            <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label">End Date</label>
                                <input className="form-input" type="date" value={endDate}
                                    onChange={e => setEndDate(e.target.value)} />
                            </div>
                            <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label">Initial Capital</label>
                                <input className="form-input" type="number" value={initialCapital}
                                    onChange={e => setInitialCapital(e.target.value)} style={{ width: 130 }} />
                            </div>
                            <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label">Check Interval (min)</label>
                                <input className="form-input" type="number" value={checkInterval}
                                    onChange={e => setCheckInterval(e.target.value)}
                                    min="1" step="1"
                                    style={{ width: 80 }} title="Regime re-evaluation interval in minutes (min: 1)" />
                            </div>
                            <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label">Min Confidence</label>
                                <input className="form-input" type="number" step="0.05" min="0" max="1"
                                    value={minConfidence} onChange={e => setMinConfidence(e.target.value)}
                                    style={{ width: 80 }} />
                            </div>
                            <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label">Max Δ</label>
                                <input className="form-input" type="number" step="50" min="50" max="2000"
                                    value={maxDelta} onChange={e => setMaxDelta(e.target.value)}
                                    style={{ width: 80 }} title="Maximum portfolio delta exposure" />
                            </div>
                            <div className="form-group" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <input type="checkbox" checked={enableAdjustments}
                                    onChange={e => setEnableAdjustments(e.target.checked)}
                                    style={{ width: 16, height: 16 }} id="adj-toggle" />
                                <label htmlFor="adj-toggle" className="form-label" style={{ marginBottom: 0, cursor: 'pointer' }}>Adjustments</label>
                            </div>
                            <button className="btn btn-primary" onClick={runAdaptiveBacktest} disabled={running}
                                style={{ height: 42 }}>
                                {running ? '⚡ Running...' : '⚡ Run Adaptive Backtest'}
                            </button>
                            {running && (
                                <button className="btn" onClick={stopBacktest}
                                    style={{ height: 42, background: 'var(--red)', color: '#fff', border: 'none', fontWeight: 700 }}>
                                    🛑 Stop
                                </button>
                            )}
                        </div>

                        {/* Expiry Multi-Select */}
                        <div style={{ marginTop: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                <label className="form-label" style={{ marginBottom: 0, fontSize: 12 }}>
                                    📅 Select Expiries ({selectedExpiries.length}/{availableExpiries.length})
                                </label>
                                <button className="btn" onClick={selectAllExpiries}
                                    style={{ fontSize: 10, padding: '2px 8px', height: 22 }}>Select All</button>
                                <button className="btn" onClick={clearExpiries}
                                    style={{ fontSize: 10, padding: '2px 8px', height: 22 }}>Clear</button>
                                <button className="btn" onClick={loadExpiries} disabled={loadingExpiries}
                                    style={{ fontSize: 10, padding: '2px 8px', height: 22 }}>
                                    {loadingExpiries ? '...' : '↻ Refresh'}
                                </button>
                                <input className="form-input" type="text" placeholder="Search expiries..."
                                    value={expirySearchTerm} onChange={e => setExpirySearchTerm(e.target.value)}
                                    style={{ width: 160, height: 22, fontSize: 11, padding: '2px 6px' }} />
                            </div>
                            <div style={{
                                display: 'flex', flexWrap: 'wrap', gap: 4,
                                maxHeight: 100, overflowY: 'auto',
                                padding: '6px 8px', background: 'var(--bg-input)',
                                borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
                            }}>
                                {loadingExpiries ? (
                                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Loading expiries...</span>
                                ) : filteredExpiries.length === 0 ? (
                                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No expiries found</span>
                                ) : (
                                    filteredExpiries.map(exp => (
                                        <div key={exp.folder_name}
                                            onClick={() => toggleExpiry(exp.folder_name)}
                                            style={{
                                                padding: '2px 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
                                                fontWeight: 600, userSelect: 'none', transition: 'all 0.15s',
                                                background: selectedExpiries.includes(exp.folder_name) ? 'var(--accent-primary)' : 'transparent',
                                                color: selectedExpiries.includes(exp.folder_name) ? '#fff' : 'var(--text-secondary)',
                                                border: `1px solid ${selectedExpiries.includes(exp.folder_name) ? 'var(--accent-primary)' : 'var(--border)'}`,
                                            }}>
                                            {exp.date_str}
                                        </div>
                                    ))
                                )}
                            </div>
                            {selectedExpiries.length === 0 && (
                                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                                    No expiries selected — all available expiries in the date range will be used
                                </div>
                            )}
                        </div>

                        {error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>❌ {error}</div>}
                        {running && (
                            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div className="spinner" style={{ width: 20, height: 20 }}></div>
                                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                    {statusMsg || 'Running adaptive engine — regime detection, adjustments, risk monitoring...'}
                                </span>
                            </div>
                        )}
                        {statusMsg === 'Stopped by user' && !running && (
                            <div style={{ color: 'var(--orange)', fontSize: 13, marginTop: 8 }}>⚠️ Backtest was stopped by user</div>
                        )}
                    </div>

                    {/* Results */}
                    {result && (
                        <>
                            {/* Summary Metrics Row */}
                            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                                <div className="metric-card" style={{ flex: 1 }}>
                                    <div className="metric-label">Expiries</div>
                                    <div className="metric-value">{result.total_expiries}</div>
                                </div>
                                <div className="metric-card" style={{ flex: 1 }}>
                                    <div className="metric-label">Execution Time</div>
                                    <div className="metric-value" style={{ fontSize: 18, color: 'var(--cyan)' }}>
                                        {(result.execution_time_ms / 1000).toFixed(1)}s
                                    </div>
                                </div>
                                <div className="metric-card" style={{ flex: 1 }}>
                                    <div className="metric-label">Greeks Snapshots</div>
                                    <div className="metric-value" style={{ fontSize: 18, color: 'var(--accent-primary)' }}>
                                        {result.greeks_summary?.snapshots || 0}
                                    </div>
                                </div>
                                <div className="metric-card" style={{ flex: 1 }}>
                                    <div className="metric-label">Max Delta</div>
                                    <div className="metric-value" style={{ fontSize: 18 }}>
                                        {result.greeks_summary?.max_delta?.toFixed(0) || '—'}
                                    </div>
                                </div>
                            </div>

                            {/* Equity Curve + Strategy Breakdown */}
                            <div className="grid-2" style={{ marginBottom: 16 }}>
                                <div className="card">
                                    <div className="card-header"><div className="card-title">Equity Curve</div></div>
                                    <ResponsiveContainer width="100%" height={280}>
                                        <LineChart data={equityCurveData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
                                            <XAxis dataKey="idx" stroke="#4a5c78" fontSize={11} />
                                            <YAxis stroke="#4a5c78" fontSize={11}
                                                tickFormatter={(v: number) => `₹${(v / 100000).toFixed(0)}L`} />
                                            <Tooltip
                                                contentStyle={{ background: '#1a2235', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 12 }}
                                                formatter={(v: any) => [`₹${Number(v).toLocaleString()}`, 'Equity']} />
                                            <Line type="monotone" dataKey="equity" stroke="#3b82f6" strokeWidth={2} dot={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>

                                <div className="card">
                                    <div className="card-header"><div className="card-title">Strategy PnL Breakdown</div></div>
                                    <ResponsiveContainer width="100%" height={280}>
                                        <BarChart data={strategyBreakdownData} layout="vertical">
                                            <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
                                            <XAxis type="number" stroke="#4a5c78" fontSize={11}
                                                tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}K`} />
                                            <YAxis type="category" dataKey="name" stroke="#4a5c78" fontSize={11} width={120} />
                                            <Tooltip
                                                contentStyle={{ background: '#1a2235', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 12 }}
                                                formatter={(v: any) => [`₹${Number(v).toLocaleString()}`, 'PnL']} />
                                            <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>
                                                {strategyBreakdownData.map((entry, i) => (
                                                    <Cell key={i} fill={entry.pnl >= 0 ? '#10b981' : '#ef4444'} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Regime Distribution + Per-Expiry Table */}
                            <div className="grid-2" style={{ marginBottom: 16 }}>
                                <div className="card">
                                    <div className="card-header"><div className="card-title">Regime Distribution</div></div>
                                    <ResponsiveContainer width="100%" height={280}>
                                        <PieChart>
                                            <Pie data={regimeBreakdownData} dataKey="expiries" nameKey="name"
                                                cx="50%" cy="50%" outerRadius={100}
                                                label={({ name, expiries }: any) => `${name} (${expiries})`}>
                                                {regimeBreakdownData.map((entry, i) => (
                                                    <Cell key={i} fill={entry.color} />
                                                ))}
                                            </Pie>
                                            <Tooltip contentStyle={{ background: '#1a2235', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 12 }} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>

                                <div className="card">
                                    <div className="card-header">
                                        <div className="card-title">Per-Expiry Results ({result.expiry_results?.length || 0})</div>
                                    </div>
                                    <div className="table-container" style={{ maxHeight: 280, overflowY: 'auto' }}>
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th>Expiry</th>
                                                    <th>Regime</th>
                                                    <th>Strategy</th>
                                                    <th>PnL</th>
                                                    <th>Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(result.expiry_results || []).map((er: any, i: number) => (
                                                    <tr
                                                        key={i}
                                                        onClick={() => setSelectedResultExpiry(er.expiry)}
                                                        style={{
                                                            cursor: 'pointer',
                                                            backgroundColor: selectedResultExpiry === er.expiry ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                                                            borderLeft: selectedResultExpiry === er.expiry ? '3px solid var(--accent-primary)' : '3px solid transparent'
                                                        }}
                                                    >
                                                        <td style={{ fontWeight: 500, fontSize: 11 }}>{er.expiry}</td>
                                                        <td>
                                                            <span style={{ color: REGIME_COLORS[er.initial_regime] || '#8899b4', fontSize: 11 }}>
                                                                {REGIME_ICONS[er.initial_regime] || '❔'} {er.initial_regime}
                                                            </span>
                                                        </td>
                                                        <td style={{ fontSize: 11 }}>{er.initial_strategy?.replace(/_/g, ' ')}</td>
                                                        <td className={er.pnl >= 0 ? 'pnl-positive' : 'pnl-negative'} style={{ fontWeight: 600 }}>
                                                            ₹{(er.pnl || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                        </td>
                                                        <td>
                                                            <span className={`badge ${er.status === 'success' ? 'badge-green' : 'badge-red'}`}>
                                                                {er.status}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div style={{ padding: '8px 16px', fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
                                        Click on an expiry row to view detailed trades.
                                    </div>
                                </div>
                            </div>

                            {/* Trade Detail View for Selected Expiry */}
                            {selectedResultExpiry && (
                                <div className="card" style={{ marginBottom: 16 }}>
                                    <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div className="card-title">Detailed Trades for {selectedResultExpiry}</div>
                                        <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => setSelectedResultExpiry(null)}>Close</button>
                                    </div>
                                    <div className="table-container" style={{ overflowX: 'auto' }}>
                                        <table style={{ minWidth: 800 }}>
                                            <thead>
                                                <tr>
                                                    <th>Entry Time</th>
                                                    <th>Exit Time</th>
                                                    <th>Strategy</th>
                                                    <th>Exit Reason</th>
                                                    <th>Leg Details (Strike / Type / Entry → Exit)</th>
                                                    <th style={{ textAlign: 'right' }}>Trade PnL</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(result.trades || []).filter((t: any) => t.expiry === selectedResultExpiry).map((trade: any, i: number) => (
                                                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                                                        <td style={{ fontSize: 11, fontFamily: 'monospace', verticalAlign: 'top', paddingTop: 12 }}>
                                                            {trade.entry_time.substring(11, 19)}
                                                        </td>
                                                        <td style={{ fontSize: 11, fontFamily: 'monospace', verticalAlign: 'top', paddingTop: 12 }}>
                                                            {trade.exit_time.substring(11, 19)}
                                                        </td>
                                                        <td style={{ fontSize: 11, verticalAlign: 'top', paddingTop: 12 }}>
                                                            <span className="badge badge-accent">{trade.strategy_name.replace(/_/g, ' ')}</span>
                                                        </td>
                                                        <td style={{ fontSize: 11, verticalAlign: 'top', paddingTop: 12 }}>
                                                            {trade.exit_reason === 'stop_loss' ? <span className="badge badge-red">Stop Loss</span>
                                                                : trade.exit_reason === 'target_profit' ? <span className="badge badge-green">Target</span>
                                                                    : trade.exit_reason === 'time_exit' ? <span className="badge badge-blue">Time Exit</span>
                                                                        : <span className="badge" style={{ background: 'var(--bg-lighter)' }}>{trade.exit_reason || 'Close'}</span>}
                                                        </td>
                                                        <td style={{ padding: '8px 12px' }}>
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                                {(trade.legs || []).map((leg: any, j: number) => {
                                                                    const isBuy = leg.direction === 'buy';
                                                                    return (
                                                                        <div key={j} style={{
                                                                            display: 'flex', alignItems: 'center', gap: 8,
                                                                            fontSize: 11, padding: '4px 8px',
                                                                            background: 'var(--bg-darker)', borderRadius: 4,
                                                                            borderLeft: isBuy ? '2px solid var(--green)' : '2px solid var(--red)'
                                                                        }}>
                                                                            <span style={{ fontWeight: 600, width: 40, color: isBuy ? 'var(--green)' : 'var(--red)' }}>
                                                                                {isBuy ? 'BUY' : 'SELL'}
                                                                            </span>
                                                                            <span style={{ fontFamily: 'monospace', fontWeight: 600, width: 60 }}>
                                                                                {leg.strike} {leg.right}
                                                                            </span>
                                                                            <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                                                                                {leg.quantity} lots
                                                                            </span>
                                                                            <span style={{ marginLeft: 'auto', fontFamily: 'monospace' }}>
                                                                                ₹{leg.entry_price.toFixed(1)} <span style={{ color: 'var(--text-muted)' }}>→</span> ₹{leg.exit_price.toFixed(1)}
                                                                            </span>
                                                                            <span style={{
                                                                                fontFamily: 'monospace', fontWeight: 600, width: 60, textAlign: 'right',
                                                                                color: leg.pnl_points >= 0 ? 'var(--green)' : 'var(--red)'
                                                                            }}>
                                                                                {leg.pnl_points > 0 ? '+' : ''}{leg.pnl_points.toFixed(1)} pts
                                                                            </span>
                                                                        </div>
                                                                    );
                                                                })}
                                                                {(!trade.legs || trade.legs.length === 0) && (
                                                                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No leg details available</span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td style={{ textAlign: 'right', verticalAlign: 'top', paddingTop: 12 }}>
                                                            <div className={trade.pnl >= 0 ? 'pnl-positive' : 'pnl-negative'} style={{ fontWeight: 800, fontSize: 14 }}>
                                                                ₹{(trade.pnl || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                            </div>
                                                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                                                                Spot: {trade.spot_at_entry?.toFixed(0)} → {trade.spot_at_exit?.toFixed(0)}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                                {(result.trades || []).filter((t: any) => t.expiry === selectedResultExpiry).length === 0 && (
                                                    <tr>
                                                        <td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                                                            No trades executed for this expiry
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {!result && !running && (
                        <div className="card">
                            <div className="empty-state">
                                <div className="empty-icon">⚡</div>
                                <h3>Adaptive Options Trading Engine</h3>
                                <p style={{ maxWidth: 600 }}>
                                    The adaptive engine combines regime detection, strategy selection,
                                    dynamic adjustments (Cottle framework), risk management, and Greeks monitoring
                                    into a single unified backtesting pipeline.
                                </p>
                                <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                                    {['condor_breakout', 'risk_reduction', 'trend_reversal', 'time_decay'].map(type => (
                                        <div key={type} style={{
                                            padding: '6px 12px', borderRadius: 'var(--radius-sm)',
                                            background: `${ADJ_TYPE_COLORS[type]}15`,
                                            border: `1px solid ${ADJ_TYPE_COLORS[type]}30`,
                                            fontSize: 11, display: 'flex', alignItems: 'center', gap: 6,
                                        }}>
                                            <span>{ADJ_TYPE_ICONS[type]}</span>
                                            <span style={{ color: ADJ_TYPE_COLORS[type], fontWeight: 600 }}>
                                                {type.replace(/_/g, ' ')}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* === TAB: Risk Dashboard === */}
            {activeTab === 'risk' && (
                <div>
                    {result ? (
                        <>
                            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                                <div className="metric-card" style={{ flex: 1, minWidth: 150 }}>
                                    <div className="metric-label">Total Risk Events</div>
                                    <div className="metric-value" style={{ fontSize: 22, color: 'var(--red)' }}>
                                        {result.risk_summary?.total_events || 0}
                                    </div>
                                </div>
                                <div className="metric-card" style={{ flex: 1, minWidth: 150 }}>
                                    <div className="metric-label">Peak Equity</div>
                                    <div className="metric-value" style={{ fontSize: 18, color: 'var(--green)' }}>
                                        ₹{(result.risk_summary?.peak_equity || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </div>
                                </div>
                                <div className="metric-card" style={{ flex: 1, minWidth: 150 }}>
                                    <div className="metric-label">Max Draw↓</div>
                                    <div className="metric-value" style={{ fontSize: 18, color: 'var(--red)' }}>
                                        ₹{(result.greeks_summary?.max_drawdown || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </div>
                                </div>
                                <div className="metric-card" style={{ flex: 1, minWidth: 150 }}>
                                    <div className="metric-label">Risk Limit</div>
                                    <div className="metric-value" style={{ fontSize: 18 }}>
                                        {result.risk_summary?.limits?.max_risk_pct || 2}%
                                    </div>
                                    <div className="metric-change" style={{ color: 'var(--text-muted)' }}>per trade</div>
                                </div>
                            </div>

                            {Object.keys(riskEventsByType).length > 0 && (
                                <div className="card" style={{ marginBottom: 16 }}>
                                    <div className="card-header"><div className="card-title">Risk Events by Type</div></div>
                                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                        {Object.entries(riskEventsByType).map(([type, count]: [string, any]) => (
                                            <div key={type} className="glass-card" style={{
                                                flex: 1, minWidth: 160, textAlign: 'center',
                                                borderLeft: '3px solid var(--red)',
                                            }}>
                                                <div style={{ fontSize: 28, marginBottom: 4 }}>
                                                    {type === 'delta_breach' ? '📊' : type === 'stop_loss' ? '🛑' :
                                                        type === 'max_loss' ? '💸' : type === 'max_drawdown' ? '📉' : '⚠️'}
                                                </div>
                                                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--red)' }}>{count}</div>
                                                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                                                    {type.replace(/_/g, ' ')}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="card">
                                <div className="card-header">
                                    <div className="card-title">Risk Event Log ({(result.risk_events || []).length})</div>
                                </div>
                                {(result.risk_events || []).length > 0 ? (
                                    <div className="table-container" style={{ maxHeight: 400, overflowY: 'auto' }}>
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th>Time</th><th>Type</th><th>Strategy</th>
                                                    <th>Description</th><th>Value</th><th>Threshold</th><th>Action</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(result.risk_events || []).map((e: any, i: number) => (
                                                    <tr key={i}>
                                                        <td style={{ fontSize: 10, fontFamily: 'monospace' }}>{e.timestamp?.substring(11, 19)}</td>
                                                        <td><span className="badge badge-red" style={{ fontSize: 10 }}>{e.event_type}</span></td>
                                                        <td style={{ fontSize: 11 }}>{e.strategy_name?.replace(/_/g, ' ')}</td>
                                                        <td style={{ fontSize: 11, maxWidth: 300 }}>{e.description}</td>
                                                        <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{e.current_value?.toFixed(1)}</td>
                                                        <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{e.threshold?.toFixed(1)}</td>
                                                        <td><span className="badge badge-yellow" style={{ fontSize: 10 }}>{e.action_taken}</span></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="empty-state" style={{ padding: 32 }}>
                                        <div className="empty-icon">✅</div>
                                        <p>No risk limits were breached during this backtest</p>
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="card">
                            <div className="empty-state">
                                <div className="empty-icon">🛡️</div>
                                <h3>Risk Dashboard</h3>
                                <p>Run an adaptive backtest to view risk analytics</p>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* === TAB: Adjustments === */}
            {activeTab === 'adjustments' && (
                <div>
                    {result ? (
                        <>
                            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                                {Object.entries(adjustmentsByType).map(([type, count]: [string, any]) => (
                                    <div key={type} className="metric-card" style={{ flex: 1, minWidth: 150 }}>
                                        <div className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <span>{ADJ_TYPE_ICONS[type] || '🔧'}</span>
                                            {type.replace(/_/g, ' ')}
                                        </div>
                                        <div className="metric-value" style={{
                                            fontSize: 22, color: ADJ_TYPE_COLORS[type] || 'var(--accent-primary)'
                                        }}>
                                            {count}
                                        </div>
                                    </div>
                                ))}
                                {Object.keys(adjustmentsByType).length === 0 && (
                                    <div className="metric-card" style={{ flex: 1 }}>
                                        <div className="metric-label">No Adjustments</div>
                                        <div className="metric-value" style={{ fontSize: 18, color: 'var(--green)' }}>
                                            Positions held steady
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="card">
                                <div className="card-header">
                                    <div className="card-title">🔄 Adjustment Timeline ({(result.adjustment_history || []).length})</div>
                                    <div className="card-subtitle">Strategy conversions detected by the adjustment engine</div>
                                </div>
                                {(result.adjustment_history || []).length > 0 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                        {(result.adjustment_history || []).map((adj: any, i: number) => (
                                            <div key={i} style={{
                                                padding: '14px 16px',
                                                background: 'var(--bg-input)',
                                                borderRadius: 'var(--radius-sm)',
                                                borderLeft: `4px solid ${ADJ_TYPE_COLORS[adj.adjustment_type] || '#8899b4'}`,
                                            }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <span style={{ fontSize: 20 }}>{ADJ_TYPE_ICONS[adj.adjustment_type] || '🔧'}</span>
                                                        <span style={{
                                                            fontSize: 13, fontWeight: 700,
                                                            color: ADJ_TYPE_COLORS[adj.adjustment_type] || 'var(--accent-primary)',
                                                        }}>
                                                            {(adj.adjustment_type || '').replace(/_/g, ' ').toUpperCase()}
                                                        </span>
                                                    </div>
                                                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                                                        {adj.timestamp?.substring(0, 19)}
                                                    </span>
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                                    <span className="badge badge-blue" style={{ fontSize: 10 }}>
                                                        {adj.from_strategy?.replace(/_/g, ' ')}
                                                    </span>
                                                    <span style={{ color: 'var(--text-muted)' }}>→</span>
                                                    <span className="badge badge-green" style={{ fontSize: 10 }}>
                                                        {adj.to_strategy?.replace(/_/g, ' ')}
                                                    </span>
                                                    <span style={{ marginLeft: 'auto', fontWeight: 600, fontSize: 12 }}
                                                        className={adj.pnl_at_adjustment >= 0 ? 'pnl-positive' : 'pnl-negative'}>
                                                        PnL: ₹{(adj.pnl_at_adjustment || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                    </span>
                                                </div>
                                                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                                                    {adj.reason}
                                                </div>
                                                {adj.spot_price > 0 && (
                                                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                                                        Spot: {adj.spot_price.toFixed(0)}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="empty-state" style={{ padding: 32 }}>
                                        <div className="empty-icon">✅</div>
                                        <h3>No Adjustments Needed</h3>
                                        <p>All positions matched their market regimes throughout the backtest</p>
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="card">
                            <div className="empty-state">
                                <div className="empty-icon">🔄</div>
                                <h3>Adjustment History</h3>
                                <p>Run an adaptive backtest to see strategy conversions</p>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* === TAB: Greeks Monitor === */}
            {activeTab === 'greeks' && (
                <div>
                    {result && greeksTimelineData.length > 0 ? (
                        <>
                            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                                <div className="metric-card" style={{ flex: 1, minWidth: 140 }}>
                                    <div className="metric-label">Avg Δ Delta</div>
                                    <div className="metric-value" style={{ fontSize: 18 }}>
                                        {result.greeks_summary?.avg_delta?.toFixed(1) || '—'}
                                    </div>
                                </div>
                                <div className="metric-card" style={{ flex: 1, minWidth: 140 }}>
                                    <div className="metric-label">Max Δ Delta</div>
                                    <div className="metric-value" style={{ fontSize: 18, color: 'var(--orange)' }}>
                                        {result.greeks_summary?.max_delta?.toFixed(1) || '—'}
                                    </div>
                                </div>
                                <div className="metric-card" style={{ flex: 1, minWidth: 140 }}>
                                    <div className="metric-label">Avg Θ Theta</div>
                                    <div className="metric-value" style={{ fontSize: 18, color: 'var(--cyan)' }}>
                                        {result.greeks_summary?.avg_theta?.toFixed(1) || '—'}
                                    </div>
                                </div>
                                <div className="metric-card" style={{ flex: 1, minWidth: 140 }}>
                                    <div className="metric-label">Max ν Vega</div>
                                    <div className="metric-value" style={{ fontSize: 18, color: 'var(--purple)' }}>
                                        {result.greeks_summary?.max_vega?.toFixed(1) || '—'}
                                    </div>
                                </div>
                                <div className="metric-card" style={{ flex: 1, minWidth: 140 }}>
                                    <div className="metric-label">Snapshots</div>
                                    <div className="metric-value" style={{ fontSize: 18, color: 'var(--accent-primary)' }}>
                                        {result.greeks_summary?.snapshots || 0}
                                    </div>
                                </div>
                            </div>

                            <div className="card" style={{ marginBottom: 16 }}>
                                <div className="card-header"><div className="card-title">📐 Portfolio Delta Over Time</div></div>
                                <ResponsiveContainer width="100%" height={260}>
                                    <AreaChart data={greeksTimelineData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
                                        <XAxis dataKey="idx" stroke="#4a5c78" fontSize={10} />
                                        <YAxis stroke="#4a5c78" fontSize={11} />
                                        <Tooltip
                                            contentStyle={{ background: '#1a2235', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 12 }}
                                            formatter={(v: any, name: any) => [Number(v).toFixed(2), name]} />
                                        <Area type="monotone" dataKey="delta" stroke="#3b82f6" fill="#3b82f622" strokeWidth={2} name="Delta" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>

                            <div className="grid-2" style={{ marginBottom: 16 }}>
                                <div className="card">
                                    <div className="card-header"><div className="card-title">Θ Theta Exposure</div></div>
                                    <ResponsiveContainer width="100%" height={240}>
                                        <AreaChart data={greeksTimelineData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
                                            <XAxis dataKey="idx" stroke="#4a5c78" fontSize={10} />
                                            <YAxis stroke="#4a5c78" fontSize={11} />
                                            <Tooltip
                                                contentStyle={{ background: '#1a2235', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 12 }}
                                                formatter={(v: any) => [Number(v).toFixed(2), 'Theta']} />
                                            <Area type="monotone" dataKey="theta" stroke="#06b6d4" fill="#06b6d422" strokeWidth={2} name="Theta" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>

                                <div className="card">
                                    <div className="card-header"><div className="card-title">ν Vega Exposure</div></div>
                                    <ResponsiveContainer width="100%" height={240}>
                                        <AreaChart data={greeksTimelineData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
                                            <XAxis dataKey="idx" stroke="#4a5c78" fontSize={10} />
                                            <YAxis stroke="#4a5c78" fontSize={11} />
                                            <Tooltip
                                                contentStyle={{ background: '#1a2235', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 12 }}
                                                formatter={(v: any) => [Number(v).toFixed(2), 'Vega']} />
                                            <Area type="monotone" dataKey="vega" stroke="#a855f7" fill="#a855f722" strokeWidth={2} name="Vega" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            <div className="card">
                                <div className="card-header"><div className="card-title">📈 Greeks PnL Timeline</div></div>
                                <ResponsiveContainer width="100%" height={240}>
                                    <LineChart data={greeksTimelineData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
                                        <XAxis dataKey="idx" stroke="#4a5c78" fontSize={10} />
                                        <YAxis stroke="#4a5c78" fontSize={11}
                                            tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}K`} />
                                        <Tooltip
                                            contentStyle={{ background: '#1a2235', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 12 }}
                                            formatter={(v: any) => [`₹${Number(v).toLocaleString()}`, 'PnL']} />
                                        <Line type="monotone" dataKey="pnl" stroke="#10b981" strokeWidth={2} dot={false} name="PnL" />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </>
                    ) : (
                        <div className="card">
                            <div className="empty-state">
                                <div className="empty-icon">📐</div>
                                <h3>Greeks Monitor</h3>
                                <p>Run an adaptive backtest to visualize portfolio Greeks exposure over time</p>
                                <div style={{ marginTop: 16, display: 'flex', gap: 16, justifyContent: 'center' }}>
                                    {['Δ Delta', 'Γ Gamma', 'Θ Theta', 'ν Vega'].map(g => (
                                        <div key={g} style={{
                                            padding: '8px 16px', borderRadius: 'var(--radius-sm)',
                                            background: 'var(--bg-input)', fontSize: 13,
                                            fontWeight: 600, color: 'var(--text-secondary)',
                                        }}>{g}</div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
