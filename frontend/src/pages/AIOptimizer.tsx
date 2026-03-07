import { useState, useEffect } from 'react';
import { aiApi, strategyApi } from '../api/client';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer,
} from 'recharts';

export default function AIOptimizer() {
    const [strategies, setStrategies] = useState<any[]>([]);
    const [selectedStrategy, setSelectedStrategy] = useState('');
    const [startDate, setStartDate] = useState('2024-01-01');
    const [endDate, setEndDate] = useState('2024-06-01');
    const [objective, setObjective] = useState('sharpe');
    const [iterations, setIterations] = useState('20');
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [history, setHistory] = useState<any[]>([]);
    const [suggestions, setSuggestions] = useState<any>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        loadStrategies();
        loadHistory();
    }, []);

    const loadStrategies = async () => {
        try {
            const data = await strategyApi.list();
            setStrategies(data.strategies || []);
            if (data.strategies?.length > 0) setSelectedStrategy(data.strategies[0].name);
        } catch (e) { console.error(e); }
    };

    const loadHistory = async () => {
        try {
            const data = await aiApi.getLearningHistory();
            setHistory(data.history || []);
        } catch (e) { console.error(e); }
    };

    const runOptimization = async () => {
        if (!selectedStrategy) return;
        setRunning(true);
        setError('');
        try {
            const data = await aiApi.optimize({
                strategy_name: selectedStrategy,
                start_date: startDate || null,
                end_date: endDate || null,
                objective,
                max_iterations: parseInt(iterations) || 20,
                parameters: [
                    { name: 'stop_loss_pct', min: 50, max: 300, step: 25 },
                    { name: 'target_profit_pct', min: 20, max: 80, step: 10 },
                ],
            });
            setResult(data);
            loadHistory();

            // Load suggestions
            try {
                const sug = await aiApi.getSuggestions(selectedStrategy);
                setSuggestions(sug);
            } catch (e) { }
        } catch (e: any) {
            setError(e.message || 'Optimization failed');
        }
        setRunning(false);
    };

    const convergenceData = (result?.convergence || []).map((v: number, i: number) => ({
        iteration: i + 1,
        fitness: v,
    }));

    return (
        <div className="fade-in">
            {/* Controls */}
            <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-header"><div className="card-title">AI Strategy Optimization</div></div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 180 }}>
                        <label className="form-label">Strategy</label>
                        <select className="form-select" value={selectedStrategy}
                            onChange={e => setSelectedStrategy(e.target.value)}>
                            {strategies.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                        </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Objective</label>
                        <select className="form-select" value={objective} onChange={e => setObjective(e.target.value)}>
                            <option value="sharpe">Sharpe Ratio</option>
                            <option value="pnl">Total PnL</option>
                            <option value="sortino">Sortino Ratio</option>
                            <option value="profit_factor">Profit Factor</option>
                        </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Start</label>
                        <input className="form-input" type="date" value={startDate}
                            onChange={e => setStartDate(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">End</label>
                        <input className="form-input" type="date" value={endDate}
                            onChange={e => setEndDate(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Iterations</label>
                        <input className="form-input" type="number" value={iterations}
                            onChange={e => setIterations(e.target.value)} style={{ width: 80 }} />
                    </div>
                    <button className="btn btn-primary" onClick={runOptimization} disabled={running}
                        style={{ height: 42 }}>
                        {running ? '🤖 Optimizing...' : '🤖 Optimize'}
                    </button>
                </div>
                {error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{error}</div>}
            </div>

            {/* Results */}
            {result && (
                <div className="grid-2" style={{ marginBottom: 16 }}>
                    <div className="card">
                        <div className="card-header"><div className="card-title">Best Parameters</div></div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {Object.entries(result.best_params || {}).map(([key, value]) => (
                                <div key={key} style={{
                                    display: 'flex', justifyContent: 'space-between', padding: '8px 12px',
                                    background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)',
                                }}>
                                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                        {key.replace(/_/g, ' ')}
                                    </span>
                                    <span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>
                                        {typeof value === 'number' ? (value as number).toFixed(1) : String(value)}
                                    </span>
                                </div>
                            ))}
                            <div style={{
                                padding: '12px', background: 'rgba(16, 185, 129, 0.1)',
                                borderRadius: 'var(--radius-sm)', border: '1px solid rgba(16, 185, 129, 0.2)',
                            }}>
                                <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>BEST FITNESS</div>
                                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--green)' }}>
                                    {(result.best_fitness || 0).toFixed(4)}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                    Over {result.iterations || 0} iterations
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header"><div className="card-title">Convergence</div></div>
                        <ResponsiveContainer width="100%" height={250}>
                            <LineChart data={convergenceData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
                                <XAxis dataKey="iteration" stroke="#4a5c78" fontSize={11} />
                                <YAxis stroke="#4a5c78" fontSize={11} />
                                <Tooltip contentStyle={{ background: '#1a2235', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 12 }} />
                                <Line type="monotone" dataKey="fitness" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* AI Suggestions */}
            {suggestions?.suggestions?.length > 0 && (
                <div className="card" style={{ marginBottom: 16 }}>
                    <div className="card-header"><div className="card-title">🤖 AI Suggestions</div></div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {suggestions.suggestions.map((s: any, i: number) => (
                            <div key={i} style={{
                                padding: '12px 16px',
                                background: s.priority === 'high' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                                borderRadius: 'var(--radius-sm)',
                                border: `1px solid ${s.priority === 'high' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(59, 130, 246, 0.2)'}`,
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                    <span className={`badge ${s.priority === 'high' ? 'badge-red' : 'badge-blue'}`}>{s.priority}</span>
                                    <span style={{ fontWeight: 600, fontSize: 13 }}>{s.type.replace(/_/g, ' ')}</span>
                                </div>
                                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>{s.message}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Learning History */}
            {history.length > 0 && (
                <div className="card">
                    <div className="card-header"><div className="card-title">Learning History ({history.length} runs)</div></div>
                    <div className="table-container" style={{ maxHeight: 300, overflowY: 'auto' }}>
                        <table>
                            <thead>
                                <tr><th>Strategy</th><th>Expiry/Period</th><th>PnL</th><th>Sharpe</th><th>Win Rate</th><th>DD %</th></tr>
                            </thead>
                            <tbody>
                                {history.slice(-20).reverse().map((h, i) => (
                                    <tr key={i}>
                                        <td style={{ fontWeight: 500 }}>{h.strategy_name}</td>
                                        <td style={{ fontSize: 11 }}>{h.expiry}</td>
                                        <td className={(h.results?.total_pnl || 0) >= 0 ? 'pnl-positive' : 'pnl-negative'}>
                                            ₹{(h.results?.total_pnl || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                        </td>
                                        <td>{(h.results?.sharpe_ratio || 0).toFixed(2)}</td>
                                        <td>{(h.results?.win_rate || 0).toFixed(1)}%</td>
                                        <td>{(h.results?.max_drawdown || 0).toFixed(1)}%</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {!result && history.length === 0 && (
                <div className="card">
                    <div className="empty-state">
                        <div className="empty-icon">🤖</div>
                        <h3>AI Strategy Optimizer</h3>
                        <p>Select a strategy, configure the search space, and let the AI find optimal parameters using Bayesian optimization.</p>
                    </div>
                </div>
            )}
        </div>
    );
}
