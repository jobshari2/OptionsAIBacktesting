import { useState, useEffect } from 'react';
import { backtestApi, strategyApi } from '../api/client';
import { useBacktestStore } from '../stores/appStore';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';

export default function BacktestDashboard() {
    const { currentResult, setCurrentResult, isRunning, setIsRunning, results, setResults } = useBacktestStore();
    const [strategies, setStrategies] = useState<any[]>([]);
    const [selectedStrategy, setSelectedStrategy] = useState('');
    const [startDate, setStartDate] = useState('2024-01-01');
    const [endDate, setEndDate] = useState('2025-01-01');
    const [capital, setCapital] = useState('1000000');
    const [error, setError] = useState('');
    const [progress, setProgress] = useState<any>(null);
    const [currentRunId, setCurrentRunId] = useState<string | null>(null);

    useEffect(() => {
        loadStrategies();
        loadResults();
    }, []);

    const loadStrategies = async () => {
        try {
            const data = await strategyApi.list();
            setStrategies(data.strategies || []);
            if (data.strategies?.length > 0) setSelectedStrategy(data.strategies[0].name);
        } catch (e) { console.error(e); }
    };

    const loadResults = async () => {
        try {
            const data = await backtestApi.listResults();
            setResults(data.results || []);
        } catch (e) { console.error(e); }
    };

    const runBacktest = async () => {
        if (!selectedStrategy) { setError('Select a strategy'); return; }
        setIsRunning(true);
        setError('');
        setCurrentResult(null);
        setCurrentRunId(null);
        setProgress({ status: 'starting', completed: 0, total: 0 });

        try {
            const result = await backtestApi.run({
                strategy_name: selectedStrategy,
                start_date: startDate || null,
                end_date: endDate || null,
                initial_capital: parseFloat(capital) || 1000000,
            });

            const runId = result.run_id;
            setCurrentRunId(runId);

            // Poll for status
            const pollInterval = setInterval(async () => {
                try {
                    const statusData = await backtestApi.getStatus(runId);
                    setProgress(statusData);

                    if (statusData.status === 'completed') {
                        clearInterval(pollInterval);
                        const finalResult = await backtestApi.getResult(runId);
                        setCurrentResult(finalResult);
                        loadResults();
                        setIsRunning(false);
                        setProgress(null);
                    } else if (statusData.status === 'error') {
                        clearInterval(pollInterval);
                        setError(`Backtest failed: ${statusData.error || 'Unknown error'}`);
                        setIsRunning(false);
                        setProgress(null);
                    }
                } catch (e: any) {
                    clearInterval(pollInterval);
                    setError(e.message || 'Failed to check status');
                    setIsRunning(false);
                    setProgress(null);
                }
            }, 1000);

        } catch (e: any) {
            setError(e.message || 'Backtest failed to start');
            setIsRunning(false);
            setProgress(null);
            setCurrentRunId(null);
        }
    };

    const stopBacktest = async () => {
        if (!currentRunId) return;
        try {
            await backtestApi.stop(currentRunId);
            setProgress((prev: any) => ({ ...prev, status: 'stopping' }));
        } catch (e: any) {
            setError(e.message || 'Failed to stop backtest');
        }
    };

    const metrics = currentResult?.metrics || {};
    const equityCurve = (currentResult?.equity_curve || []).map((p: any, i: number) => ({
        ...p,
        index: i,
        equity: typeof p.equity === 'number' ? p.equity : parseFloat(capital),
    }));

    const expiryResults = (currentResult?.expiry_results || []).map((r: any) => ({
        ...r,
        pnlColor: r.pnl >= 0 ? '#10b981' : '#ef4444',
    }));

    return (
        <div className="fade-in">
            {/* Controls */}
            <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-header">
                    <div className="card-title">Run Backtest</div>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div className="form-group" style={{ flex: 1, minWidth: 180, margin: 0 }}>
                        <label className="form-label">Strategy</label>
                        <select className="form-select" value={selectedStrategy}
                            onChange={e => setSelectedStrategy(e.target.value)}>
                            {strategies.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                        </select>
                    </div>
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
                        <label className="form-label">Capital (₹)</label>
                        <input className="form-input" type="number" value={capital}
                            onChange={e => setCapital(e.target.value)} style={{ width: 140 }} />
                    </div>
                    <button className="btn btn-primary" onClick={runBacktest} disabled={isRunning || progress?.status === 'stopping'}
                        style={{ height: 42 }}>
                        {isRunning ? '⏳ Running...' : '⚡ Run Backtest'}
                    </button>
                    {isRunning && (
                        <button className="btn" onClick={stopBacktest} disabled={progress?.status === 'stopping'}
                            style={{ height: 42, background: 'rgba(239, 68, 68, 0.1)', color: 'var(--red)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                            {progress?.status === 'stopping' ? 'Stopping...' : 'Stop'}
                        </button>
                    )}
                </div>
                {error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{error}</div>}
                {isRunning && progress && progress.status !== 'completed' && (
                    <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                            <span>
                                {progress.status === 'starting' ? 'Initializing...' :
                                    `Simulating Expiry: ${progress.current_expiry || '...'}`}
                            </span>
                            <span style={{ color: 'var(--text-muted)' }}>
                                {progress.total > 0 ? `${progress.completed} / ${progress.total} Expiries` : 'Loading...'}
                            </span>
                        </div>
                        {progress.total > 0 && (
                            <div style={{ width: '100%', height: 6, background: 'var(--bg-card)', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{
                                    width: `${(progress.completed / progress.total) * 100}%`,
                                    height: '100%',
                                    background: 'var(--accent)',
                                    transition: 'width 0.3s ease'
                                }} />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Results */}
            {currentResult && (
                <>
                    {/* Key Metrics */}
                    <div className="grid-4" style={{ marginBottom: 20 }}>
                        {[
                            { label: 'Net PnL', value: `₹${(currentResult.total_pnl || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, cls: (currentResult.total_pnl || 0) >= 0 ? 'positive' : 'negative' },
                            { label: 'Win Rate', value: `${(currentResult.win_rate || metrics.win_rate || 0).toFixed(1)}%`, cls: (currentResult.win_rate || metrics.win_rate || 0) >= 50 ? 'positive' : 'negative' },
                            { label: 'Sharpe Ratio', value: (metrics.sharpe_ratio || 0).toFixed(2), cls: (metrics.sharpe_ratio || 0) > 0 ? 'positive' : 'negative' },
                            { label: 'Max Drawdown', value: `${(metrics.max_drawdown?.max_drawdown_pct || 0).toFixed(1)}%`, cls: 'negative' },
                            { label: 'Total Trades', value: String(currentResult.total_trades || 0), cls: '' },
                            { label: 'Profit Factor', value: (metrics.profit_factor || 0) === Infinity ? '∞' : (metrics.profit_factor || 0).toFixed(2), cls: (metrics.profit_factor || 0) > 1 ? 'positive' : 'negative' },
                            { label: 'Sortino Ratio', value: (metrics.sortino_ratio || 0).toFixed(2), cls: (metrics.sortino_ratio || 0) > 0 ? 'positive' : 'negative' },
                            { label: 'Execution', value: `${(currentResult.execution_time_ms || 0).toFixed(0)}ms`, cls: '' },
                        ].map((m, i) => (
                            <div key={i} className="metric-card">
                                <div className="metric-label">{m.label}</div>
                                <div className={`metric-value ${m.cls}`} style={{ fontSize: 22 }}>{m.value}</div>
                            </div>
                        ))}
                    </div>

                    {/* Equity Curve */}
                    <div className="card" style={{ marginBottom: 20 }}>
                        <div className="card-header"><div className="card-title">Equity Curve</div></div>
                        <ResponsiveContainer width="100%" height={350}>
                            <AreaChart data={equityCurve}>
                                <defs>
                                    <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
                                <XAxis dataKey="index" stroke="#4a5c78" fontSize={11} />
                                <YAxis stroke="#4a5c78" fontSize={11}
                                    tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} />
                                <Tooltip
                                    contentStyle={{ background: '#1a2235', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 12 }}
                                    formatter={(v: any) => [`₹${Number(v).toLocaleString()}`, 'Equity']}
                                />
                                <Area type="monotone" dataKey="equity" stroke="#3b82f6" fill="url(#eqGrad)" strokeWidth={2} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>

                    {/* Expiry-wise PnL */}
                    <div className="card">
                        <div className="card-header"><div className="card-title">PnL by Expiry</div></div>
                        <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={expiryResults.filter((r: any) => r.status === 'success')}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
                                <XAxis dataKey="expiry" stroke="#4a5c78" fontSize={10} angle={-45} textAnchor="end" height={60} />
                                <YAxis stroke="#4a5c78" fontSize={11} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} />
                                <Tooltip contentStyle={{ background: '#1a2235', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 12 }} />
                                <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                                    {expiryResults.filter((r: any) => r.status === 'success').map((entry: any, i: number) => (
                                        <Cell key={i} fill={entry.pnl >= 0 ? '#10b981' : '#ef4444'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </>
            )}

            {/* Previous Results */}
            {results.length > 0 && (
                <div className="card" style={{ marginTop: 20 }}>
                    <div className="card-header"><div className="card-title">Previous Runs</div></div>
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr><th>Run ID</th><th>Strategy</th><th>PnL</th><th>Win Rate</th><th>Trades</th><th>Period</th></tr>
                            </thead>
                            <tbody>
                                {results.slice(0, 10).map((r: any, i: number) => (
                                    <tr key={i} style={{ cursor: 'pointer' }}
                                        onClick={async () => { try { const d = await backtestApi.getResult(r.run_id); setCurrentResult(d); } catch (e) { } }}>
                                        <td><code style={{ fontSize: 11 }}>{r.run_id}</code></td>
                                        <td style={{ fontWeight: 600 }}>{r.strategy_name || r.strategy}</td>
                                        <td className={r.total_pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}>
                                            ₹{(r.total_pnl || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                        </td>
                                        <td>{(r.win_rate || 0).toFixed(1)}%</td>
                                        <td>{r.total_trades || 0}</td>
                                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                            {r.start_date} → {r.end_date}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
