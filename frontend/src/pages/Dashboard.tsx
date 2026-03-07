import { useState, useEffect } from 'react';
import { backtestApi, strategyApi, dataApi } from '../api/client';

export default function Dashboard() {
    const [expiries, setExpiries] = useState<any[]>([]);
    const [recentRuns, setRecentRuns] = useState<any[]>([]);
    const [strategies, setStrategies] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const [expData, runsData, stratData] = await Promise.allSettled([
                dataApi.getExpiries(),
                backtestApi.listResults(),
                strategyApi.list(),
            ]);
            if (expData.status === 'fulfilled') setExpiries(expData.value.expiries || []);
            if (runsData.status === 'fulfilled') setRecentRuns(runsData.value.results || []);
            if (stratData.status === 'fulfilled') setStrategies(stratData.value.strategies || []);
        } catch (e) { console.error(e); }
        setLoading(false);
    };

    const totalPnl = recentRuns.reduce((s, r) => s + (r.total_pnl || 0), 0);
    const totalTrades = recentRuns.reduce((s, r) => s + (r.total_trades || 0), 0);
    const avgWinRate = recentRuns.length
        ? recentRuns.reduce((s, r) => s + (r.win_rate || 0), 0) / recentRuns.length
        : 0;

    if (loading) {
        return <div className="loading-overlay"><div className="spinner" /><span>Loading dashboard...</span></div>;
    }

    return (
        <div className="fade-in">
            {/* Metric Cards */}
            <div className="grid-4" style={{ marginBottom: 24 }}>
                <div className="metric-card">
                    <div className="metric-label">Available Expiries</div>
                    <div className="metric-value">{expiries.length.toLocaleString()}</div>
                    <div className="metric-change" style={{ color: 'var(--cyan)' }}>
                        📁 Parquet datasets loaded
                    </div>
                </div>
                <div className="metric-card">
                    <div className="metric-label">Strategies</div>
                    <div className="metric-value">{strategies.length}</div>
                    <div className="metric-change" style={{ color: 'var(--purple)' }}>
                        📐 Strategy templates
                    </div>
                </div>
                <div className="metric-card">
                    <div className="metric-label">Total PnL</div>
                    <div className={`metric-value ${totalPnl >= 0 ? 'positive' : 'negative'}`}>
                        ₹{Math.abs(totalPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                    <div className="metric-change">
                        {totalPnl >= 0 ? '📈' : '📉'} From {recentRuns.length} runs
                    </div>
                </div>
                <div className="metric-card">
                    <div className="metric-label">Avg Win Rate</div>
                    <div className={`metric-value ${avgWinRate >= 50 ? 'positive' : 'negative'}`}>
                        {avgWinRate.toFixed(1)}%
                    </div>
                    <div className="metric-change">
                        🎯 Across {totalTrades} trades
                    </div>
                </div>
            </div>

            <div className="grid-2" style={{ marginBottom: 24 }}>
                {/* Recent Backtest Runs */}
                <div className="card">
                    <div className="card-header">
                        <div className="card-title">Recent Backtest Runs</div>
                    </div>
                    {recentRuns.length > 0 ? (
                        <div className="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Strategy</th>
                                        <th>PnL</th>
                                        <th>Win Rate</th>
                                        <th>Trades</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {recentRuns.slice(0, 5).map((run, i) => (
                                        <tr key={i}>
                                            <td style={{ fontWeight: 600 }}>{run.strategy_name || run.strategy}</td>
                                            <td className={run.total_pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}>
                                                ₹{(run.total_pnl || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                            </td>
                                            <td>{(run.win_rate || 0).toFixed(1)}%</td>
                                            <td>{run.total_trades || 0}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="empty-state">
                            <div className="empty-icon">⚡</div>
                            <h3>No backtests yet</h3>
                            <p>Run your first backtest from the Backtest page</p>
                        </div>
                    )}
                </div>

                {/* Available Strategies */}
                <div className="card">
                    <div className="card-header">
                        <div className="card-title">Available Strategies</div>
                    </div>
                    {strategies.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {strategies.map((s, i) => (
                                <div key={i} style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '10px 14px',
                                    background: 'var(--bg-input)',
                                    borderRadius: 'var(--radius-sm)',
                                    border: '1px solid var(--border-subtle)',
                                }}>
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</div>
                                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.description}</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        {(s.tags || []).slice(0, 2).map((tag: string, j: number) => (
                                            <span key={j} className="badge badge-blue">{tag}</span>
                                        ))}
                                        <span className="badge badge-purple">{s.legs_count || 0} legs</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="empty-state">
                            <div className="empty-icon">📐</div>
                            <h3>No strategies</h3>
                            <p>Create a strategy from the Strategy Builder</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Platform Info */}
            <div className="card">
                <div className="card-header">
                    <div className="card-title">Platform Capabilities</div>
                </div>
                <div className="grid-4" style={{ gap: 12 }}>
                    {[
                        { icon: '📊', title: 'Vectorized Backtesting', desc: 'High-speed simulation with Polars' },
                        { icon: '🤖', title: 'AI Optimization', desc: 'Bayesian parameter tuning' },
                        { icon: '⚡', title: '363 Expiries', desc: 'Multi-year NIFTY options data' },
                        { icon: '📈', title: 'Strategy Animation', desc: 'Minute-by-minute replay' },
                    ].map((item, i) => (
                        <div key={i} className="glass-card" style={{ textAlign: 'center', padding: 16 }}>
                            <div style={{ fontSize: 28, marginBottom: 8 }}>{item.icon}</div>
                            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{item.title}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.desc}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
