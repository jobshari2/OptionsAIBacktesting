import { useState, useEffect, useRef } from 'react';
import { backtestApi, strategyApi, dataApi } from '../api/client';
import { useBacktestStore, useDataStore } from '../stores/appStore';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, ReferenceLine,
} from 'recharts';

export default function StrategyAnimation() {
    const { animationFrames, setAnimationFrames, animationIndex, setAnimationIndex, isPlaying, setIsPlaying } = useBacktestStore();
    const { expiries, setExpiries } = useDataStore();
    const [strategies, setStrategies] = useState<any[]>([]);
    const [selectedStrategy, setSelectedStrategy] = useState('');
    const [selectedExpiry, setSelectedExpiry] = useState('');
    const [loading, setLoading] = useState(false);
    const [speed, setSpeed] = useState(100);
    const intervalRef = useRef<any>(null);

    useEffect(() => {
        loadData();
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, []);

    useEffect(() => {
        if (isPlaying && animationFrames.length > 0) {
            intervalRef.current = setInterval(() => {
                setAnimationIndex(Math.min(animationIndex + 1, animationFrames.length - 1));
            }, speed);
            return () => clearInterval(intervalRef.current);
        }
    }, [isPlaying, animationIndex, speed, animationFrames.length]);

    useEffect(() => {
        if (animationIndex >= animationFrames.length - 1) setIsPlaying(false);
    }, [animationIndex]);

    const loadData = async () => {
        try {
            const [expData, stratData] = await Promise.allSettled([
                dataApi.getExpiries(), strategyApi.list(),
            ]);
            if (expData.status === 'fulfilled') setExpiries(expData.value.expiries || []);
            if (stratData.status === 'fulfilled') {
                setStrategies(stratData.value.strategies || []);
                if (stratData.value.strategies?.length > 0) setSelectedStrategy(stratData.value.strategies[0].name);
            }
        } catch (e) { console.error(e); }
    };

    const loadAnimation = async () => {
        if (!selectedStrategy || !selectedExpiry) return;
        setLoading(true);
        setIsPlaying(false);
        setAnimationIndex(0);
        try {
            const data = await backtestApi.getAnimation({
                strategy_name: selectedStrategy,
                expiry_folder: selectedExpiry,
            });
            setAnimationFrames(data.frames || []);
        } catch (e) { console.error(e); }
        setLoading(false);
    };

    const currentFrame = animationFrames[animationIndex] || {};
    const spotData = animationFrames.slice(0, animationIndex + 1).map((f: any, i: number) => ({
        index: i,
        time: f.time,
        spot: f.spot_price,
        pnl: f.position_pnl,
    }));

    return (
        <div className="fade-in">
            {/* Controls */}
            <div className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 180 }}>
                        <label className="form-label">Strategy</label>
                        <select className="form-select" value={selectedStrategy}
                            onChange={e => setSelectedStrategy(e.target.value)}>
                            {strategies.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                        </select>
                    </div>
                    <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 200 }}>
                        <label className="form-label">Expiry</label>
                        <select className="form-select" value={selectedExpiry}
                            onChange={e => setSelectedExpiry(e.target.value)}>
                            <option value="">Select expiry...</option>
                            {expiries.slice(-50).reverse().map((e: any) => (
                                <option key={e.folder} value={e.folder}>{e.folder} ({e.date})</option>
                            ))}
                        </select>
                    </div>
                    <button className="btn btn-primary" onClick={loadAnimation} disabled={loading}
                        style={{ height: 42 }}>
                        {loading ? '⏳ Loading...' : '🎬 Load Animation'}
                    </button>
                </div>
            </div>

            {animationFrames.length > 0 && (
                <>
                    {/* Player Controls */}
                    <div className="player-controls" style={{ marginBottom: 16 }}>
                        <button className="btn-icon" onClick={() => { setAnimationIndex(0); setIsPlaying(false); }}>⏮</button>
                        <button className="btn-icon" onClick={() => setAnimationIndex(Math.max(0, animationIndex - 1))}>⏪</button>
                        <button className="btn btn-primary btn-sm" onClick={() => setIsPlaying(!isPlaying)}>
                            {isPlaying ? '⏸ Pause' : '▶ Play'}
                        </button>
                        <button className="btn-icon" onClick={() => setAnimationIndex(Math.min(animationFrames.length - 1, animationIndex + 1))}>⏩</button>
                        <button className="btn-icon" onClick={() => { setAnimationIndex(animationFrames.length - 1); setIsPlaying(false); }}>⏭</button>
                        <input type="range" min={0} max={animationFrames.length - 1} value={animationIndex}
                            onChange={e => { setAnimationIndex(parseInt(e.target.value)); setIsPlaying(false); }} />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {currentFrame.time || '--:--'} ({animationIndex + 1}/{animationFrames.length})
                        </span>
                        <select className="form-select" value={speed} onChange={e => setSpeed(parseInt(e.target.value))}
                            style={{ width: 80 }}>
                            <option value={200}>0.5x</option>
                            <option value={100}>1x</option>
                            <option value={50}>2x</option>
                            <option value={20}>5x</option>
                        </select>
                    </div>

                    {/* Current State */}
                    <div className="grid-4" style={{ marginBottom: 16 }}>
                        <div className="metric-card">
                            <div className="metric-label">Time</div>
                            <div className="metric-value" style={{ fontSize: 22 }}>{currentFrame.time || '--:--'}</div>
                        </div>
                        <div className="metric-card">
                            <div className="metric-label">Spot Price</div>
                            <div className="metric-value" style={{ fontSize: 22 }}>
                                {(currentFrame.spot_price || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                            </div>
                        </div>
                        <div className="metric-card">
                            <div className="metric-label">Position PnL</div>
                            <div className={`metric-value ${(currentFrame.position_pnl || 0) >= 0 ? 'positive' : 'negative'}`}
                                style={{ fontSize: 22 }}>
                                ₹{(currentFrame.position_pnl || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </div>
                        </div>
                        <div className="metric-card">
                            <div className="metric-label">Status</div>
                            <div className="metric-value" style={{ fontSize: 22 }}>
                                {currentFrame.is_open ? '🟢 Open' : '⚪ Flat'}
                            </div>
                        </div>
                    </div>

                    {/* Charts */}
                    <div className="grid-2" style={{ marginBottom: 16 }}>
                        <div className="card">
                            <div className="card-header"><div className="card-title">Spot Price</div></div>
                            <ResponsiveContainer width="100%" height={250}>
                                <LineChart data={spotData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
                                    <XAxis dataKey="time" stroke="#4a5c78" fontSize={10} />
                                    <YAxis stroke="#4a5c78" fontSize={11} domain={['auto', 'auto']} />
                                    <Tooltip contentStyle={{ background: '#1a2235', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 12 }} />
                                    <Line type="monotone" dataKey="spot" stroke="#3b82f6" strokeWidth={2} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="card">
                            <div className="card-header"><div className="card-title">Position PnL</div></div>
                            <ResponsiveContainer width="100%" height={250}>
                                <LineChart data={spotData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
                                    <XAxis dataKey="time" stroke="#4a5c78" fontSize={10} />
                                    <YAxis stroke="#4a5c78" fontSize={11} />
                                    <Tooltip contentStyle={{ background: '#1a2235', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 12 }}
                                        formatter={(v: any) => [`₹${Number(v).toLocaleString()}`, 'PnL']} />
                                    <ReferenceLine y={0} stroke="#4a5c78" strokeDasharray="3 3" />
                                    <Line type="monotone" dataKey="pnl" stroke="#10b981" strokeWidth={2} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Legs */}
                    {currentFrame.legs?.length > 0 && (
                        <div className="card">
                            <div className="card-header"><div className="card-title">Active Legs</div></div>
                            <div className="table-container">
                                <table>
                                    <thead><tr><th>Strike</th><th>Type</th><th>Direction</th><th>Entry</th><th>Current</th><th>PnL</th></tr></thead>
                                    <tbody>
                                        {currentFrame.legs.map((leg: any, i: number) => (
                                            <tr key={i}>
                                                <td style={{ fontWeight: 600 }}>{leg.strike}</td>
                                                <td><span className={`badge ${leg.right === 'CE' ? 'badge-green' : 'badge-red'}`}>{leg.right}</span></td>
                                                <td>{leg.direction}</td>
                                                <td>{(leg.entry_price || 0).toFixed(2)}</td>
                                                <td>{(leg.current_price || 0).toFixed(2)}</td>
                                                <td className={leg.pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}>
                                                    ₹{(leg.pnl || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )}

            {!animationFrames.length && !loading && (
                <div className="card">
                    <div className="empty-state">
                        <div className="empty-icon">▶️</div>
                        <h3>Strategy Replay</h3>
                        <p>Select a strategy and expiry, then click "Load Animation" to replay the strategy minute by minute.</p>
                    </div>
                </div>
            )}
        </div>
    );
}
