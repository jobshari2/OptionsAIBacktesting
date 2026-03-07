import { useState, useEffect } from 'react';
import { backtestApi } from '../api/client';
import { useBacktestStore } from '../stores/appStore';

export default function TradeLog() {
    const { results, setResults } = useBacktestStore();
    const [trades, setTrades] = useState<any[]>([]);
    const [selectedRunId, setSelectedRunId] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadResults();
    }, []);

    const loadResults = async () => {
        try {
            const data = await backtestApi.listResults();
            setResults(data.results || []);
            if (data.results?.length > 0) {
                setSelectedRunId(data.results[0].run_id);
                loadTrades(data.results[0].run_id);
            }
        } catch (e) { console.error(e); }
    };

    const loadTrades = async (runId: string) => {
        if (!runId) return;
        setLoading(true);
        try {
            const data = await backtestApi.getTrades(runId);
            setTrades(data.trades || []);
        } catch (e) { console.error(e); setTrades([]); }
        setLoading(false);
    };

    const stats = {
        total: trades.length,
        winners: trades.filter(t => (t.pnl || 0) > 0).length,
        losers: trades.filter(t => (t.pnl || 0) <= 0).length,
        totalPnl: trades.reduce((s, t) => s + (t.pnl || 0), 0),
    };

    return (
        <div className="fade-in">
            {/* Controls */}
            <div className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <label className="form-label" style={{ margin: 0, whiteSpace: 'nowrap' }}>Select Run:</label>
                    <select className="form-select" style={{ maxWidth: 400 }} value={selectedRunId}
                        onChange={e => { setSelectedRunId(e.target.value); loadTrades(e.target.value); }}>
                        {results.map((r: any) => (
                            <option key={r.run_id} value={r.run_id}>
                                {r.run_id} — {r.strategy_name || r.strategy} (₹{(r.total_pnl || 0).toLocaleString()})
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Stats */}
            <div className="grid-4" style={{ marginBottom: 16 }}>
                <div className="metric-card">
                    <div className="metric-label">Total Trades</div>
                    <div className="metric-value" style={{ fontSize: 22 }}>{stats.total}</div>
                </div>
                <div className="metric-card">
                    <div className="metric-label">Winners</div>
                    <div className="metric-value positive" style={{ fontSize: 22 }}>{stats.winners}</div>
                </div>
                <div className="metric-card">
                    <div className="metric-label">Losers</div>
                    <div className="metric-value negative" style={{ fontSize: 22 }}>{stats.losers}</div>
                </div>
                <div className="metric-card">
                    <div className="metric-label">Total PnL</div>
                    <div className={`metric-value ${stats.totalPnl >= 0 ? 'positive' : 'negative'}`} style={{ fontSize: 22 }}>
                        ₹{Math.abs(stats.totalPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                </div>
            </div>

            {/* Trade Table */}
            {loading ? (
                <div className="loading-overlay"><div className="spinner" /></div>
            ) : trades.length > 0 ? (
                <div className="card">
                    <div className="card-header"><div className="card-title">Trade Details</div></div>
                    <div className="table-container" style={{ maxHeight: 500, overflowY: 'auto' }}>
                        <table>
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Expiry</th>
                                    <th>Entry Time</th>
                                    <th>Exit Time</th>
                                    <th>PnL</th>
                                    <th>Points</th>
                                    <th>Exit Reason</th>
                                    <th>Costs</th>
                                    <th>Legs</th>
                                </tr>
                            </thead>
                            <tbody>
                                {trades.map((t, i) => (
                                    <tr key={i}>
                                        <td><code style={{ fontSize: 11 }}>{t.trade_id}</code></td>
                                        <td style={{ fontWeight: 500 }}>{t.expiry}</td>
                                        <td style={{ fontSize: 11 }}>{t.entry_time?.slice(0, 19)}</td>
                                        <td style={{ fontSize: 11 }}>{t.exit_time?.slice(0, 19)}</td>
                                        <td className={t.pnl >= 0 ? 'pnl-positive' : 'pnl-negative'} style={{ fontWeight: 600 }}>
                                            ₹{(t.pnl || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                        </td>
                                        <td style={{ color: (t.pnl_points || 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                            {(t.pnl_points || 0).toFixed(1)}
                                        </td>
                                        <td>
                                            <span className={`badge ${t.exit_reason === 'target_profit' ? 'badge-green' : t.exit_reason === 'stop_loss' ? 'badge-red' : 'badge-blue'}`}>
                                                {t.exit_reason}
                                            </span>
                                        </td>
                                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                            ₹{((t.transaction_costs || 0) + (t.slippage_cost || 0)).toFixed(0)}
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                                {(typeof t.legs === 'string' ? JSON.parse(t.legs) : t.legs || []).slice(0, 4).map((leg: any, j: number) => (
                                                    <span key={j} className="badge badge-purple" style={{ fontSize: 9 }}>
                                                        {leg.direction?.charAt(0).toUpperCase()}{leg.strike}{leg.right}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="card">
                    <div className="empty-state">
                        <div className="empty-icon">📋</div>
                        <h3>No trades to display</h3>
                        <p>Run a backtest first, then select the run to view trades.</p>
                    </div>
                </div>
            )}
        </div>
    );
}
