import { useState, useEffect } from 'react';
import { backtestApi, analyticsApi } from '../api/client';
import { useBacktestStore } from '../stores/appStore';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4'];

export default function StrategyComparison() {
    const { results, setResults } = useBacktestStore();
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [comparison, setComparison] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadResults();
    }, []);

    const loadResults = async () => {
        try {
            const data = await backtestApi.listResults();
            setResults(data.results || []);
        } catch (e) { console.error(e); }
    };

    const toggleSelect = (runId: string) => {
        setSelectedIds(prev =>
            prev.includes(runId) ? prev.filter(id => id !== runId) : [...prev, runId].slice(0, 5)
        );
    };

    const runComparison = async () => {
        if (selectedIds.length < 2) return;
        setLoading(true);
        try {
            const data = await analyticsApi.compare(selectedIds);
            setComparison(data.comparisons || []);
        } catch (e) { console.error(e); }
        setLoading(false);
    };

    const metricKeys = ['total_pnl', 'win_rate', 'sharpe_ratio', 'sortino_ratio', 'profit_factor', 'max_win', 'max_loss', 'total_trades'];

    return (
        <div className="fade-in">
            {/* Select Runs */}
            <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-header">
                    <div className="card-title">Select Runs to Compare (2-5)</div>
                    <button className="btn btn-primary btn-sm" onClick={runComparison}
                        disabled={selectedIds.length < 2 || loading}>
                        {loading ? '⏳...' : `⚖️ Compare (${selectedIds.length})`}
                    </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {results.map((r: any) => (
                        <label key={r.run_id} style={{
                            display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                            background: selectedIds.includes(r.run_id) ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-input)',
                            borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                            border: `1px solid ${selectedIds.includes(r.run_id) ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                        }}>
                            <input type="checkbox" checked={selectedIds.includes(r.run_id)}
                                onChange={() => toggleSelect(r.run_id)} />
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{
                                    width: 12, height: 12, borderRadius: '50%',
                                    background: selectedIds.includes(r.run_id) ? COLORS[selectedIds.indexOf(r.run_id) % COLORS.length] : 'var(--text-muted)',
                                }} />
                                <code style={{ fontSize: 11 }}>{r.run_id}</code>
                                <span style={{ fontWeight: 600, fontSize: 13 }}>{r.strategy_name || r.strategy}</span>
                                <span className={`badge ${r.total_pnl >= 0 ? 'badge-green' : 'badge-red'}`}>
                                    ₹{(r.total_pnl || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </span>
                            </div>
                        </label>
                    ))}
                </div>
            </div>

            {/* Comparison Results */}
            {comparison.length > 0 && (
                <div className="card">
                    <div className="card-header"><div className="card-title">Comparison Matrix</div></div>
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Metric</th>
                                    {comparison.map((c, i) => (
                                        <th key={i}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <div style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS[i % COLORS.length] }} />
                                                {c.strategy_name} ({c.run_id})
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {metricKeys.map(key => (
                                    <tr key={key}>
                                        <td style={{ fontWeight: 600, textTransform: 'capitalize' }}>
                                            {key.replace(/_/g, ' ')}
                                        </td>
                                        {comparison.map((c, i) => {
                                            const val = c.metrics?.[key] ?? 0;
                                            const isMonetary = key.includes('pnl') || key.includes('win') || key.includes('loss');
                                            return (
                                                <td key={i} style={{
                                                    fontWeight: 500,
                                                    color: key.includes('pnl') ? (val >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-primary)',
                                                }}>
                                                    {isMonetary ? `₹${(val || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}` :
                                                        typeof val === 'number' ? val.toFixed(2) : String(val)}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {comparison.length === 0 && selectedIds.length < 2 && (
                <div className="card">
                    <div className="empty-state">
                        <div className="empty-icon">⚖️</div>
                        <h3>Compare Strategies</h3>
                        <p>Select 2-5 backtest runs above to compare their performance side by side.</p>
                    </div>
                </div>
            )}
        </div>
    );
}
