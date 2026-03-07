import { useState, useEffect } from 'react';
import { intelligenceApi, dataApi } from '../api/client';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, BarChart, Bar, Cell, PieChart, Pie, Legend,
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

export default function IntelligenceEngine() {
    // --- State ---
    const [activeTab, setActiveTab] = useState<'backtest' | 'regime' | 'experience' | 'model' | 'docs'>('backtest');

    // Backtest params
    const [startDate, setStartDate] = useState('2024-01-01');
    const [endDate, setEndDate] = useState('2024-06-01');
    const [initialCapital, setInitialCapital] = useState('1000000');
    const [checkInterval, setCheckInterval] = useState('15');
    const [minConfidence, setMinConfidence] = useState('0.6');
    const [switchCooldown, setSwitchCooldown] = useState('30');
    const [running, setRunning] = useState(false);
    const [backtestResult, setBacktestResult] = useState<any>(null);
    const [error, setError] = useState('');

    // Regime
    const [regimeMapping, setRegimeMapping] = useState<any>(null);
    const [expiries, setExpiries] = useState<any[]>([]);
    const [selectedExpiry, setSelectedExpiry] = useState('');
    const [regimeResult, setRegimeResult] = useState<any>(null);
    const [detectingRegime, setDetectingRegime] = useState(false);

    // Experience
    const [experienceSummary, setExperienceSummary] = useState<any>(null);
    const [experiencePerformance, setExperiencePerformance] = useState<any>(null);
    const [experienceRecords, setExperienceRecords] = useState<any[]>([]);

    // Model
    const [modelStatus, setModelStatus] = useState<any>(null);
    const [training, setTraining] = useState(false);
    const [trainResult, setTrainResult] = useState<any>(null);

    // --- Load initial data ---
    useEffect(() => {
        loadRegimeMapping();
        loadModelStatus();
        loadExperienceSummary();
        loadExpiries();
    }, []);

    const loadRegimeMapping = async () => {
        try {
            const data = await intelligenceApi.getRegimeMapping();
            setRegimeMapping(data);
        } catch (e) { console.error(e); }
    };

    const loadModelStatus = async () => {
        try {
            const data = await intelligenceApi.getModelStatus();
            setModelStatus(data);
        } catch (e) { console.error(e); }
    };

    const loadExperienceSummary = async () => {
        try {
            const data = await intelligenceApi.getExperienceSummary();
            setExperienceSummary(data);
        } catch (e) { console.error(e); }
    };

    const loadExpiries = async () => {
        try {
            const data = await dataApi.getExpiries();
            setExpiries(data.expiries || []);
            if (data.expiries?.length > 0) {
                setSelectedExpiry(data.expiries[0].folder_name);
            }
        } catch (e) { console.error(e); }
    };

    // --- Actions ---
    const runIntelligentBacktest = async () => {
        setRunning(true);
        setError('');
        setBacktestResult(null);
        try {
            const data = await intelligenceApi.runIntelligentBacktest({
                start_date: startDate || null,
                end_date: endDate || null,
                initial_capital: parseFloat(initialCapital) || 1000000,
                regime_check_interval: parseInt(checkInterval) || 15,
                min_confidence: parseFloat(minConfidence) || 0.6,
                switch_cooldown: parseInt(switchCooldown) || 30,
            });
            setBacktestResult(data);
            loadExperienceSummary();
            loadModelStatus();
        } catch (e: any) {
            setError(e.message || 'Intelligent backtest failed');
        }
        setRunning(false);
    };

    const detectRegime = async () => {
        if (!selectedExpiry) return;
        setDetectingRegime(true);
        setRegimeResult(null);
        try {
            const data = await intelligenceApi.getRegime(selectedExpiry);
            setRegimeResult(data);
        } catch (e: any) {
            setRegimeResult({ error: e.message });
        }
        setDetectingRegime(false);
    };

    const trainModel = async () => {
        setTraining(true);
        setTrainResult(null);
        try {
            const data = await intelligenceApi.trainModel();
            setTrainResult(data);
            loadModelStatus();
        } catch (e: any) {
            setTrainResult({ status: 'error', reason: e.message });
        }
        setTraining(false);
    };

    const loadExperienceData = async () => {
        try {
            const [perf, records] = await Promise.all([
                intelligenceApi.getExperiencePerformance(),
                intelligenceApi.getExperience(undefined, undefined, 100),
            ]);
            setExperiencePerformance(perf);
            setExperienceRecords(records.records || []);
        } catch (e) { console.error(e); }
    };

    useEffect(() => {
        if (activeTab === 'experience') loadExperienceData();
    }, [activeTab]);

    // --- Derived data ---
    const equityCurveData = (backtestResult?.equity_curve || []).map((ec: any, i: number) => ({
        idx: i,
        equity: ec.equity,
        timestamp: ec.timestamp,
    }));

    const strategyBreakdownData = Object.entries(backtestResult?.strategy_breakdown || {}).map(
        ([name, data]: [string, any]) => ({
            name: name.replace(/_/g, ' '),
            pnl: data.pnl,
            trades: data.trades,
            win_rate: data.win_rate,
        })
    );

    const regimeBreakdownData = Object.entries(backtestResult?.regime_breakdown || {}).map(
        ([regime, data]: [string, any]) => ({
            name: regime,
            expiries: data.expiries,
            pnl: data.pnl,
            switches: data.switches,
            color: REGIME_COLORS[regime] || '#8899b4',
        })
    );

    // --- Tabs ---
    const tabs = [
        { id: 'backtest', label: '🧠 Intelligent Backtest' },
        { id: 'regime', label: '🔍 Regime Detector' },
        { id: 'experience', label: '📊 Experience Memory' },
        { id: 'model', label: '🤖 ML Model' },
        { id: 'docs', label: '📖 How to Use' },
    ];

    return (
        <div className="fade-in">
            {/* Status Bar */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <div className="metric-card" style={{ flex: 1, minWidth: 150 }}>
                    <div className="metric-label">ML Model</div>
                    <div className="metric-value" style={{ fontSize: 18, color: modelStatus?.is_trained ? 'var(--green)' : 'var(--yellow)' }}>
                        {modelStatus?.is_trained ? '✅ Trained' : '⚠️ Untrained'}
                    </div>
                    <div className="metric-change" style={{ color: 'var(--text-muted)' }}>
                        {modelStatus?.is_trained ? 'RandomForest active' : 'Using rule-based fallback'}
                    </div>
                </div>
                <div className="metric-card" style={{ flex: 1, minWidth: 150 }}>
                    <div className="metric-label">Experience Trades</div>
                    <div className="metric-value" style={{ fontSize: 18 }}>
                        {experienceSummary?.total_trades || 0}
                    </div>
                    <div className="metric-change" style={{ color: 'var(--text-muted)' }}>
                        {experienceSummary?.unique_strategies || 0} strategies, {experienceSummary?.unique_regimes || 0} regimes
                    </div>
                </div>
                <div className="metric-card" style={{ flex: 1, minWidth: 150 }}>
                    <div className="metric-label">Total Experience PnL</div>
                    <div className={`metric-value ${(experienceSummary?.total_pnl || 0) >= 0 ? 'positive' : 'negative'}`}
                        style={{ fontSize: 18 }}>
                        ₹{(experienceSummary?.total_pnl || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                    <div className="metric-change" style={{ color: 'var(--text-muted)' }}>
                        {experienceSummary?.switches || 0} mid-expiry switches
                    </div>
                </div>
                <div className="metric-card" style={{ flex: 1, minWidth: 150 }}>
                    <div className="metric-label">Regime Mapping</div>
                    <div className="metric-value" style={{ fontSize: 18, color: 'var(--accent-primary)' }}>
                        {Object.keys(regimeMapping?.mapping || {}).length} Regimes
                    </div>
                    <div className="metric-change" style={{ color: 'var(--text-muted)' }}>
                        Auto-detect & switch
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

            {/* === TAB: Intelligent Backtest === */}
            {activeTab === 'backtest' && (
                <div>
                    <div className="card" style={{ marginBottom: 16 }}>
                        <div className="card-header">
                            <div className="card-title">🧠 Run Intelligent Meta-Strategy Backtest</div>
                            <div className="card-subtitle">AI detects market regime & selects optimal strategy dynamically</div>
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
                                    onChange={e => setCheckInterval(e.target.value)} style={{ width: 80 }}
                                    title="Minutes between regime re-evaluation" />
                            </div>
                            <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label">Min Confidence</label>
                                <input className="form-input" type="number" step="0.05" min="0" max="1"
                                    value={minConfidence} onChange={e => setMinConfidence(e.target.value)}
                                    style={{ width: 80 }} title="Minimum confidence to trigger strategy switch" />
                            </div>
                            <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label">Cooldown (min)</label>
                                <input className="form-input" type="number" value={switchCooldown}
                                    onChange={e => setSwitchCooldown(e.target.value)} style={{ width: 80 }}
                                    title="Cooldown period after a strategy switch" />
                            </div>
                            <button className="btn btn-primary" onClick={runIntelligentBacktest} disabled={running}
                                style={{ height: 42 }}>
                                {running ? '🧠 Running...' : '🧠 Run Intelligent Backtest'}
                            </button>
                        </div>
                        {error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>❌ {error}</div>}
                        {running && (
                            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div className="spinner" style={{ width: 20, height: 20 }}></div>
                                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                    Running intelligent backtest — detecting regimes, switching strategies...
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Results */}
                    {backtestResult && (
                        <>
                            {/* Summary Metrics */}
                            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                                <div className="metric-card" style={{ flex: 1 }}>
                                    <div className="metric-label">Total PnL</div>
                                    <div className={`metric-value ${backtestResult.total_pnl >= 0 ? 'positive' : 'negative'}`}>
                                        ₹{backtestResult.total_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </div>
                                </div>
                                <div className="metric-card" style={{ flex: 1 }}>
                                    <div className="metric-label">Total Trades</div>
                                    <div className="metric-value">{backtestResult.total_trades}</div>
                                </div>
                                <div className="metric-card" style={{ flex: 1 }}>
                                    <div className="metric-label">Strategy Switches</div>
                                    <div className="metric-value" style={{ color: 'var(--orange)' }}>
                                        {backtestResult.total_switches}
                                    </div>
                                </div>
                                <div className="metric-card" style={{ flex: 1 }}>
                                    <div className="metric-label">Expiries</div>
                                    <div className="metric-value">{backtestResult.total_expiries}</div>
                                </div>
                                <div className="metric-card" style={{ flex: 1 }}>
                                    <div className="metric-label">Execution Time</div>
                                    <div className="metric-value" style={{ fontSize: 18, color: 'var(--cyan)' }}>
                                        {(backtestResult.execution_time_ms / 1000).toFixed(1)}s
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
                                                formatter={(v: number) => [`₹${v.toLocaleString()}`, 'Equity']} />
                                            <Line type="monotone" dataKey="equity" stroke="#3b82f6" strokeWidth={2} dot={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>

                                <div className="card">
                                    <div className="card-header"><div className="card-title">Strategy Breakdown</div></div>
                                    <ResponsiveContainer width="100%" height={280}>
                                        <BarChart data={strategyBreakdownData} layout="vertical">
                                            <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
                                            <XAxis type="number" stroke="#4a5c78" fontSize={11}
                                                tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}K`} />
                                            <YAxis type="category" dataKey="name" stroke="#4a5c78" fontSize={11} width={120} />
                                            <Tooltip
                                                contentStyle={{ background: '#1a2235', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 12 }}
                                                formatter={(v: number) => [`₹${v.toLocaleString()}`, 'PnL']} />
                                            <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>
                                                {strategyBreakdownData.map((entry, i) => (
                                                    <Cell key={i} fill={entry.pnl >= 0 ? '#10b981' : '#ef4444'} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Regime Breakdown + Timeline */}
                            <div className="grid-2" style={{ marginBottom: 16 }}>
                                <div className="card">
                                    <div className="card-header"><div className="card-title">Regime Distribution</div></div>
                                    <ResponsiveContainer width="100%" height={280}>
                                        <PieChart>
                                            <Pie data={regimeBreakdownData} dataKey="expiries" nameKey="name"
                                                cx="50%" cy="50%" outerRadius={100} label={({ name, expiries }) => `${name} (${expiries})`}>
                                                {regimeBreakdownData.map((entry, i) => (
                                                    <Cell key={i} fill={entry.color} />
                                                ))}
                                            </Pie>
                                            <Tooltip
                                                contentStyle={{ background: '#1a2235', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 12 }} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>

                                <div className="card">
                                    <div className="card-header">
                                        <div className="card-title">Regime Switches Timeline ({backtestResult.regime_timeline?.length || 0})</div>
                                    </div>
                                    <div className="table-container" style={{ maxHeight: 280, overflowY: 'auto' }}>
                                        {(backtestResult.regime_timeline || []).length > 0 ? (
                                            <table>
                                                <thead>
                                                    <tr>
                                                        <th>Expiry</th>
                                                        <th>From → To</th>
                                                        <th>Strategy</th>
                                                        <th>Conf</th>
                                                        <th>PnL at Switch</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {(backtestResult.regime_timeline || []).map((t: any, i: number) => (
                                                        <tr key={i}>
                                                            <td style={{ fontSize: 11 }}>{t.expiry}</td>
                                                            <td>
                                                                <span className="badge badge-blue" style={{ marginRight: 4, fontSize: 10 }}>{t.from_regime}</span>
                                                                →
                                                                <span className="badge badge-purple" style={{ marginLeft: 4, fontSize: 10 }}>{t.to_regime}</span>
                                                            </td>
                                                            <td style={{ fontSize: 11 }}>{t.to_strategy}</td>
                                                            <td>{(t.confidence * 100).toFixed(0)}%</td>
                                                            <td className={t.pnl_at_switch >= 0 ? 'pnl-positive' : 'pnl-negative'}>
                                                                ₹{(t.pnl_at_switch || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        ) : (
                                            <div className="empty-state" style={{ padding: 32 }}>
                                                <p>No mid-expiry switches occurred</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Per-Expiry Results */}
                            <div className="card">
                                <div className="card-header">
                                    <div className="card-title">Per-Expiry Results ({backtestResult.expiry_results?.length || 0})</div>
                                </div>
                                <div className="table-container" style={{ maxHeight: 400, overflowY: 'auto' }}>
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>Expiry</th>
                                                <th>Initial Regime</th>
                                                <th>Initial Strategy</th>
                                                <th>Switches</th>
                                                <th>Trades</th>
                                                <th>PnL</th>
                                                <th>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(backtestResult.expiry_results || []).map((er: any, i: number) => (
                                                <tr key={i}>
                                                    <td style={{ fontWeight: 500 }}>{er.expiry}</td>
                                                    <td>
                                                        <span style={{ color: REGIME_COLORS[er.initial_regime] || 'var(--text-secondary)' }}>
                                                            {REGIME_ICONS[er.initial_regime] || '❔'} {er.initial_regime}
                                                        </span>
                                                    </td>
                                                    <td style={{ fontSize: 12 }}>{er.initial_strategy?.replace(/_/g, ' ')}</td>
                                                    <td>
                                                        {er.switches > 0 ? (
                                                            <span className="badge badge-yellow">{er.switches}</span>
                                                        ) : (
                                                            <span style={{ color: 'var(--text-muted)' }}>0</span>
                                                        )}
                                                    </td>
                                                    <td>{er.trades}</td>
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
                            </div>
                        </>
                    )}

                    {!backtestResult && !running && (
                        <div className="card">
                            <div className="empty-state">
                                <div className="empty-icon">🧠</div>
                                <h3>Intelligent Meta-Strategy Backtest</h3>
                                <p>
                                    The AI engine detects market regimes in real-time, selects the optimal strategy,
                                    and dynamically switches mid-expiry when conditions change.
                                </p>
                                <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                                    {Object.entries(regimeMapping?.mapping || {}).map(([regime, strategy]) => (
                                        <div key={regime} style={{
                                            padding: '6px 12px', borderRadius: 'var(--radius-sm)',
                                            background: `${REGIME_COLORS[regime]}15`,
                                            border: `1px solid ${REGIME_COLORS[regime]}30`,
                                            fontSize: 11, display: 'flex', alignItems: 'center', gap: 6,
                                        }}>
                                            <span>{REGIME_ICONS[regime]}</span>
                                            <span style={{ color: REGIME_COLORS[regime], fontWeight: 600 }}>{regime}</span>
                                            <span style={{ color: 'var(--text-muted)' }}>→</span>
                                            <span style={{ color: 'var(--text-secondary)' }}>{String(strategy).replace(/_/g, ' ')}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* === TAB: Regime Detector === */}
            {activeTab === 'regime' && (
                <div>
                    {/* Regime Mapping */}
                    <div className="card" style={{ marginBottom: 16 }}>
                        <div className="card-header">
                            <div className="card-title">📋 Regime → Strategy Mapping</div>
                        </div>
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                            {Object.entries(regimeMapping?.mapping || {}).map(([regime, strategy]) => (
                                <div key={regime} className="glass-card" style={{
                                    flex: 1, minWidth: 180, textAlign: 'center',
                                    borderLeft: `3px solid ${REGIME_COLORS[regime] || '#8899b4'}`,
                                }}>
                                    <div style={{ fontSize: 28, marginBottom: 6 }}>{REGIME_ICONS[regime]}</div>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: REGIME_COLORS[regime], marginBottom: 4 }}>
                                        {regime}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                        {String(strategy).replace(/_/g, ' ')}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Detect Regime for Specific Expiry */}
                    <div className="card" style={{ marginBottom: 16 }}>
                        <div className="card-header">
                            <div className="card-title">🔍 Detect Regime for Expiry</div>
                        </div>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                            <div className="form-group" style={{ margin: 0, flex: 1 }}>
                                <label className="form-label">Expiry</label>
                                <select className="form-select" value={selectedExpiry}
                                    onChange={e => setSelectedExpiry(e.target.value)}>
                                    {expiries.map((exp: any) => (
                                        <option key={exp.folder_name} value={exp.folder_name}>
                                            {exp.date_str || exp.folder_name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <button className="btn btn-primary" onClick={detectRegime} disabled={detectingRegime}
                                style={{ height: 42 }}>
                                {detectingRegime ? '🔍 Detecting...' : '🔍 Detect Regime'}
                            </button>
                        </div>
                    </div>

                    {/* Regime Detection Result */}
                    {regimeResult && !regimeResult.error && (
                        <div className="grid-2" style={{ marginBottom: 16 }}>
                            <div className="card">
                                <div className="card-header"><div className="card-title">Detected Regime</div></div>
                                <div style={{ textAlign: 'center', padding: 16 }}>
                                    <div style={{ fontSize: 48, marginBottom: 8 }}>
                                        {REGIME_ICONS[regimeResult.regime] || '❔'}
                                    </div>
                                    <div style={{
                                        fontSize: 22, fontWeight: 800,
                                        color: REGIME_COLORS[regimeResult.regime] || 'var(--text-primary)',
                                    }}>
                                        {regimeResult.regime}
                                    </div>
                                    <div style={{
                                        marginTop: 8, fontSize: 14,
                                        color: (regimeResult.confidence || 0) >= 0.7 ? 'var(--green)' : 'var(--yellow)',
                                    }}>
                                        Confidence: {((regimeResult.confidence || 0) * 100).toFixed(0)}%
                                    </div>
                                    <div style={{ marginTop: 12 }}>
                                        <span className="badge badge-blue">
                                            Recommended: {regimeResult.recommended_strategy?.replace(/_/g, ' ')}
                                        </span>
                                    </div>
                                    <div style={{ marginTop: 8 }}>
                                        <span className={`badge ${regimeResult.model_trained ? 'badge-green' : 'badge-yellow'}`}>
                                            {regimeResult.model_trained ? 'ML Model' : 'Rule-based'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="card">
                                <div className="card-header"><div className="card-title">Computed Features</div></div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {Object.entries(regimeResult.features || {}).map(([key, value]) => (
                                        <div key={key} style={{
                                            display: 'flex', justifyContent: 'space-between', padding: '6px 10px',
                                            background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)',
                                        }}>
                                            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                                {key.replace(/_/g, ' ')}
                                            </span>
                                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-primary)', fontFamily: 'monospace' }}>
                                                {typeof value === 'number' ? (value as number).toFixed(4) : String(value)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                    {regimeResult?.error && (
                        <div className="card" style={{ marginBottom: 16 }}>
                            <div style={{ color: 'var(--red)', fontSize: 13 }}>❌ {regimeResult.error}</div>
                        </div>
                    )}
                </div>
            )}

            {/* === TAB: Experience Memory === */}
            {activeTab === 'experience' && (
                <div>
                    {/* Performance Summary */}
                    {experiencePerformance?.performance && Object.keys(experiencePerformance.performance).length > 0 && (
                        <div className="card" style={{ marginBottom: 16 }}>
                            <div className="card-header"><div className="card-title">Strategy Performance by Experience</div></div>
                            <div className="table-container">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Strategy</th>
                                            <th>Trades</th>
                                            <th>Total PnL</th>
                                            <th>Avg PnL</th>
                                            <th>Win Rate</th>
                                            <th>Avg Confidence</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Object.entries(experiencePerformance.performance).map(([name, data]: [string, any]) => (
                                            <tr key={name}>
                                                <td style={{ fontWeight: 600 }}>{name.replace(/_/g, ' ')}</td>
                                                <td>{data.total_trades}</td>
                                                <td className={data.total_pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}>
                                                    ₹{data.total_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                </td>
                                                <td className={data.avg_pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}>
                                                    ₹{data.avg_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                </td>
                                                <td>{data.win_rate.toFixed(1)}%</td>
                                                <td>{(data.avg_confidence * 100).toFixed(0)}%</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Trade Records */}
                    <div className="card">
                        <div className="card-header">
                            <div className="card-title">Trade Records ({experienceRecords.length})</div>
                        </div>
                        {experienceRecords.length > 0 ? (
                            <div className="table-container" style={{ maxHeight: 400, overflowY: 'auto' }}>
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Expiry</th>
                                            <th>Regime</th>
                                            <th>Strategy</th>
                                            <th>PnL</th>
                                            <th>Exit Reason</th>
                                            <th>Switch?</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {experienceRecords.map((r: any, i: number) => (
                                            <tr key={i}>
                                                <td style={{ fontSize: 11 }}>{r.expiry}</td>
                                                <td>
                                                    <span style={{ color: REGIME_COLORS[r.regime], fontSize: 12 }}>
                                                        {REGIME_ICONS[r.regime]} {r.regime}
                                                    </span>
                                                </td>
                                                <td style={{ fontSize: 12 }}>{r.strategy_name?.replace(/_/g, ' ')}</td>
                                                <td className={r.pnl >= 0 ? 'pnl-positive' : 'pnl-negative'} style={{ fontWeight: 600 }}>
                                                    ₹{(r.pnl || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                </td>
                                                <td><span className="badge badge-blue" style={{ fontSize: 10 }}>{r.exit_reason}</span></td>
                                                <td>
                                                    {r.was_switch ? (
                                                        <span className="badge badge-yellow" style={{ fontSize: 10 }}>
                                                            from {r.switch_from?.replace(/_/g, ' ')}
                                                        </span>
                                                    ) : '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="empty-state">
                                <div className="empty-icon">📊</div>
                                <h3>No Experience Data</h3>
                                <p>Run an intelligent backtest to populate the experience memory.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* === TAB: ML Model === */}
            {activeTab === 'model' && (
                <div>
                    <div className="grid-2" style={{ marginBottom: 16 }}>
                        <div className="card">
                            <div className="card-header"><div className="card-title">🤖 ML Model Status</div></div>
                            <div style={{ textAlign: 'center', padding: 24 }}>
                                <div style={{ fontSize: 48, marginBottom: 12 }}>
                                    {modelStatus?.is_trained ? '🟢' : '🟡'}
                                </div>
                                <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
                                    {modelStatus?.is_trained ? 'Model Trained & Active' : 'Model Not Trained'}
                                </div>
                                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                                    {modelStatus?.is_trained
                                        ? 'RandomForestClassifier is actively predicting regimes with probability-based confidence.'
                                        : 'The system is using rule-based fallback. Run backtests or click Train to build the ML model.'}
                                </p>
                                <button className="btn btn-primary" onClick={trainModel} disabled={training}>
                                    {training ? '🤖 Training...' : '🤖 Train ML Model'}
                                </button>
                            </div>
                        </div>

                        <div className="card">
                            <div className="card-header"><div className="card-title">Feature Importance</div></div>
                            {modelStatus?.feature_importance && Object.keys(modelStatus.feature_importance).length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {Object.entries(modelStatus.feature_importance)
                                        .sort(([, a]: any, [, b]: any) => b - a)
                                        .map(([name, value]: [string, any]) => (
                                            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <span style={{ fontSize: 12, color: 'var(--text-secondary)', width: 130, flexShrink: 0 }}>
                                                    {name.replace(/_/g, ' ')}
                                                </span>
                                                <div style={{
                                                    flex: 1, height: 20, background: 'var(--bg-input)',
                                                    borderRadius: 4, overflow: 'hidden', position: 'relative',
                                                }}>
                                                    <div style={{
                                                        width: `${(value * 100) / Math.max(...Object.values(modelStatus.feature_importance).map(Number))}%`,
                                                        height: '100%',
                                                        background: 'var(--accent-gradient)',
                                                        borderRadius: 4,
                                                        transition: 'width 0.5s ease',
                                                    }} />
                                                </div>
                                                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-primary)', width: 50, textAlign: 'right' }}>
                                                    {(value * 100).toFixed(1)}%
                                                </span>
                                            </div>
                                        ))}
                                </div>
                            ) : (
                                <div className="empty-state" style={{ padding: 32 }}>
                                    <p>Train the model to see feature importances</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Training Result */}
                    {trainResult && (
                        <div className="card">
                            <div className="card-header"><div className="card-title">Training Result</div></div>
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                                <div style={{
                                    padding: 16, background: trainResult.status === 'trained' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                                    borderRadius: 'var(--radius-sm)',
                                    border: `1px solid ${trainResult.status === 'trained' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)'}`,
                                    flex: 1,
                                }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, color: trainResult.status === 'trained' ? 'var(--green)' : 'var(--yellow)', marginBottom: 6 }}>
                                        STATUS
                                    </div>
                                    <div style={{ fontSize: 18, fontWeight: 700 }}>{trainResult.status?.toUpperCase()}</div>
                                    {trainResult.reason && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{trainResult.reason}</div>}
                                </div>
                                {trainResult.train_accuracy != null && (
                                    <div style={{ padding: 16, background: 'rgba(59, 130, 246, 0.1)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(59, 130, 246, 0.2)', flex: 1 }}>
                                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-primary)', marginBottom: 6 }}>ACCURACY</div>
                                        <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent-primary)' }}>{(trainResult.train_accuracy * 100).toFixed(1)}%</div>
                                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{trainResult.samples} training samples</div>
                                    </div>
                                )}
                                {trainResult.class_distribution && (
                                    <div style={{ padding: 16, background: 'rgba(168, 85, 247, 0.1)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(168, 85, 247, 0.2)', flex: 1 }}>
                                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--purple)', marginBottom: 6 }}>CLASS DISTRIBUTION</div>
                                        {Object.entries(trainResult.class_distribution).map(([cls, count]) => (
                                            <div key={cls} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
                                                <span style={{ color: REGIME_COLORS[cls] || 'var(--text-secondary)' }}>{cls}</span>
                                                <span style={{ fontWeight: 600 }}>{String(count)}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
            {/* === TAB: Documentation === */}
            {activeTab === 'docs' && (
                <div>
                    {/* Overview */}
                    <div className="card" style={{ marginBottom: 16 }}>
                        <div className="card-header"><div className="card-title">📖 Intelligence Engine — Overview</div></div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                            <p style={{ marginBottom: 12 }}>
                                The <strong style={{ color: 'var(--text-primary)' }}>Intelligence Engine</strong> is an AI-powered meta-strategy system that automatically detects
                                market conditions (regimes) and selects the optimal options strategy for the current environment.
                                Unlike traditional backtesting, it can <strong style={{ color: 'var(--orange)' }}>switch strategies mid-expiry</strong> when
                                market conditions change.
                            </p>
                            <div style={{
                                padding: '12px 16px', background: 'rgba(59, 130, 246, 0.08)',
                                borderRadius: 'var(--radius-sm)', border: '1px solid rgba(59, 130, 246, 0.15)',
                                marginBottom: 12, fontSize: 12,
                            }}>
                                <strong style={{ color: 'var(--accent-primary)' }}>How It Works:</strong>
                                <span style={{ color: 'var(--text-secondary)' }}> Market Data → Feature Extraction (10 features) → Regime Detection (ML or Rules) → Strategy Selection → Trade Execution → Experience Memory → Continuous Learning</span>
                            </div>
                        </div>
                    </div>

                    {/* Getting Started */}
                    <div className="card" style={{ marginBottom: 16 }}>
                        <div className="card-header"><div className="card-title">🚀 Getting Started — Recommended Workflow</div></div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {[
                                { step: '1', title: 'Run your first intelligent backtest', desc: 'Go to the "🧠 Intelligent Backtest" tab. Set a date range, keep default parameters, and click "Run Intelligent Backtest". The AI will detect regimes and select strategies automatically.', color: 'var(--accent-primary)' },
                                { step: '2', title: 'Review results & switches', desc: 'After the backtest completes, review the equity curve, strategy breakdown, and regime switches timeline. Check which regimes were detected and how strategy switches affected PnL.', color: 'var(--green)' },
                                { step: '3', title: 'Explore regime detection', desc: 'Switch to "🔍 Regime Detector" and pick any expiry to see what regime the AI detects and the 10 computed features. This helps you understand the AI\'s reasoning.', color: 'var(--cyan)' },
                                { step: '4', title: 'Check experience memory', desc: 'After running backtests, visit "📊 Experience Memory" to see accumulated trade results. Performance is tracked per strategy and per regime.', color: 'var(--purple)' },
                                { step: '5', title: 'Train the ML model', desc: 'Once you have enough experience data (10+ trades), go to "🤖 ML Model" and train the model. This upgrades detection from rule-based to ML-powered with confidence scores.', color: 'var(--orange)' },
                            ].map(item => (
                                <div key={item.step} style={{
                                    display: 'flex', gap: 14, padding: '12px 16px',
                                    background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)',
                                    borderLeft: `3px solid ${item.color}`,
                                }}>
                                    <div style={{
                                        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                                        background: `${item.color}20`, color: item.color,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontWeight: 800, fontSize: 13,
                                    }}>{item.step}</div>
                                    <div>
                                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13, marginBottom: 2 }}>{item.title}</div>
                                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.desc}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Tab Guides */}
                    <div className="grid-2" style={{ marginBottom: 16 }}>
                        {/* Intelligent Backtest Guide */}
                        <div className="card">
                            <div className="card-header"><div className="card-title">🧠 Intelligent Backtest Tab</div></div>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                                <p style={{ marginBottom: 10 }}>Runs a full meta-strategy backtest where the AI dynamically chooses strategies.</p>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6, fontSize: 13 }}>Parameters:</div>
                                {[
                                    { name: 'Start / End Date', desc: 'Date range for the backtest. Must have data loaded for this period.' },
                                    { name: 'Initial Capital', desc: 'Starting portfolio value (₹). Used for equity curve calculation.' },
                                    { name: 'Check Interval (min)', desc: 'How often the AI re-evaluates the market regime during each expiry session. Default: 15 min. Lower = more responsive but more churn.' },
                                    { name: 'Min Confidence', desc: 'Minimum confidence score (0.0–1.0) required to trigger a strategy switch. Default: 0.6. Higher = fewer but more confident switches.' },
                                    { name: 'Cooldown (min)', desc: 'Minimum time after a switch before another switch can happen. Prevents excessive churning. Default: 30 min.' },
                                ].map(p => (
                                    <div key={p.name} style={{ padding: '6px 10px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', marginBottom: 4 }}>
                                        <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{p.name}</span>
                                        <span style={{ color: 'var(--text-muted)' }}> — </span>
                                        <span>{p.desc}</span>
                                    </div>
                                ))}
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginTop: 10, marginBottom: 6, fontSize: 13 }}>Results Include:</div>
                                <ul style={{ paddingLeft: 20, margin: 0 }}>
                                    <li>Equity curve showing capital growth over time</li>
                                    <li>Strategy breakdown — PnL contribution per strategy</li>
                                    <li>Regime distribution — pie chart of detected regimes</li>
                                    <li>Switches timeline — every mid-expiry regime change</li>
                                    <li>Per-expiry table with regime, strategy, switches, and PnL</li>
                                </ul>
                            </div>
                        </div>

                        {/* Regime Detector Guide */}
                        <div className="card">
                            <div className="card-header"><div className="card-title">🔍 Regime Detector Tab</div></div>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                                <p style={{ marginBottom: 10 }}>Inspect the regime detection engine in detail for any expiry.</p>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6, fontSize: 13 }}>Regime Mapping:</div>
                                <p style={{ marginBottom: 10 }}>The top section shows which strategy the AI selects for each regime. These are the default mappings based on options theory.</p>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6, fontSize: 13 }}>Detect Regime:</div>
                                <ul style={{ paddingLeft: 20, margin: 0, marginBottom: 10 }}>
                                    <li>Select an expiry from the dropdown</li>
                                    <li>Click "Detect Regime" to compute features and classify</li>
                                    <li>View the detected regime, confidence score, and all 10 computed features</li>
                                    <li>Badge shows whether ML model or rule-based fallback was used</li>
                                </ul>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6, fontSize: 13 }}>10 Computed Features:</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                                    {[
                                        ['Realized Volatility', 'Standard deviation of returns'],
                                        ['ATR', 'Average True Range (14-bar)'],
                                        ['VWAP Distance', '% distance from VWAP'],
                                        ['Trend Strength', 'EMA minus price normalized'],
                                        ['Momentum', 'Rate of change over lookback'],
                                        ['Volume Spike', 'Volume vs rolling average'],
                                        ['IV Percentile', 'Implied vol rank (0-100)'],
                                        ['IV Skew', 'OTM Put IV minus OTM Call IV'],
                                        ['Put Call Ratio', 'Put volume / Call volume'],
                                        ['OI Change', 'Total OI % change'],
                                    ].map(([name, desc]) => (
                                        <div key={name} style={{ fontSize: 11, padding: '3px 6px', background: 'var(--bg-input)', borderRadius: 4 }}>
                                            <span style={{ color: 'var(--accent-primary)' }}>{name}</span>: {desc}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="grid-2" style={{ marginBottom: 16 }}>
                        {/* Experience Memory Guide */}
                        <div className="card">
                            <div className="card-header"><div className="card-title">📊 Experience Memory Tab</div></div>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                                <p style={{ marginBottom: 10 }}>Stores all trade results from intelligent backtests in a high-performance Parquet file for analysis and continuous learning.</p>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6, fontSize: 13 }}>Strategy Performance:</div>
                                <p style={{ marginBottom: 10 }}>
                                    Shows aggregated metrics per strategy: total trades, total PnL, average PnL per trade, win rate, and average confidence.
                                    Use this to understand which strategies perform best in which regimes.
                                </p>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6, fontSize: 13 }}>Trade Records:</div>
                                <ul style={{ paddingLeft: 20, margin: 0 }}>
                                    <li>Every trade is stored with its regime context</li>
                                    <li>"Switch?" column shows if the trade resulted from a mid-expiry strategy switch</li>
                                    <li>Exit reasons: time_exit, stop_loss, target_profit, regime_switch, data_end</li>
                                    <li>Data accumulates across multiple backtest runs</li>
                                </ul>
                            </div>
                        </div>

                        {/* ML Model Guide */}
                        <div className="card">
                            <div className="card-header"><div className="card-title">🤖 ML Model Tab</div></div>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                                <p style={{ marginBottom: 10 }}>Manages the RandomForest machine learning model used for regime detection.</p>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6, fontSize: 13 }}>Two Modes:</div>
                                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                                    <div style={{ flex: 1, padding: 8, background: 'rgba(245, 158, 11, 0.08)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(245, 158, 11, 0.15)' }}>
                                        <div style={{ fontWeight: 600, color: 'var(--yellow)', fontSize: 11, marginBottom: 4 }}>⚠️ RULE-BASED (Fallback)</div>
                                        <div style={{ fontSize: 11 }}>Uses predefined threshold rules on features. Always available, no training needed.</div>
                                    </div>
                                    <div style={{ flex: 1, padding: 8, background: 'rgba(16, 185, 129, 0.08)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(16, 185, 129, 0.15)' }}>
                                        <div style={{ fontWeight: 600, color: 'var(--green)', fontSize: 11, marginBottom: 4 }}>✅ ML-POWERED</div>
                                        <div style={{ fontSize: 11 }}>RandomForest trained on experience data. Provides probability-based confidence scores.</div>
                                    </div>
                                </div>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6, fontSize: 13 }}>Training:</div>
                                <ul style={{ paddingLeft: 20, margin: 0, marginBottom: 10 }}>
                                    <li>Requires at least 10 trade records in Experience Memory</li>
                                    <li>Click "Train ML Model" to build the classifier</li>
                                    <li>Model auto-trains after each intelligent backtest run</li>
                                    <li>Saved to disk — persists across restarts</li>
                                </ul>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6, fontSize: 13 }}>Feature Importance:</div>
                                <p>Shows which market features contribute most to regime classification. Higher bars mean the feature has more predictive power.</p>
                            </div>
                        </div>
                    </div>

                    {/* Regime Glossary */}
                    <div className="card">
                        <div className="card-header"><div className="card-title">📚 Market Regimes — Glossary</div></div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {[
                                { regime: 'RANGE_BOUND', icon: '↔️', strategy: 'Iron Condor', desc: 'Market is moving sideways with low momentum and low ATR. Ideal for premium-selling strategies that profit from time decay.', features: 'Low ATR, Low Momentum, Low Trend Strength' },
                                { regime: 'TREND_UP', icon: '📈', strategy: 'Bull Call Spread', desc: 'Market shows strong upward momentum with positive trend strength. Directional bullish strategies capture the move with defined risk.', features: 'High Positive Momentum, Positive Trend Strength' },
                                { regime: 'TREND_DOWN', icon: '📉', strategy: 'Bear Put Spread', desc: 'Market shows strong downward momentum with negative trend strength. Directional bearish strategies profit from the decline.', features: 'High Negative Momentum, Negative Trend Strength' },
                                { regime: 'HIGH_VOLATILITY', icon: '🌊', strategy: 'Long Straddle', desc: 'High realized volatility detected. Long volatility strategies profit from large price swings in either direction.', features: 'High Realized Volatility, High ATR' },
                                { regime: 'LOW_VOLATILITY', icon: '😴', strategy: 'Short Strangle', desc: 'Low realized volatility environment. Short volatility strategies sell options to collect premium in a calm market.', features: 'Low Realized Volatility, Low ATR' },
                            ].map(r => (
                                <div key={r.regime} style={{
                                    display: 'flex', gap: 14, padding: '14px 16px',
                                    background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)',
                                    borderLeft: `3px solid ${REGIME_COLORS[r.regime]}`,
                                }}>
                                    <div style={{ fontSize: 28, flexShrink: 0 }}>{r.icon}</div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                            <span style={{ fontWeight: 700, color: REGIME_COLORS[r.regime], fontSize: 13 }}>{r.regime}</span>
                                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>→</span>
                                            <span className="badge badge-blue" style={{ fontSize: 10 }}>{r.strategy}</span>
                                        </div>
                                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{r.desc}</div>
                                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                            <strong>Key Features:</strong> {r.features}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
