import { useState, useEffect } from 'react';
import { useDataStore } from '../stores/appStore';
import { dataApi, mlApi } from '../api/client';

export default function MLPredictor() {
    const { expiries, setExpiries, selectedExpiry, setSelectedExpiry, globalUseUnified } = useDataStore();
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<any>(null);
    const [timestamp, setTimestamp] = useState('09:15');
    const [prediction, setPrediction] = useState<any>(null);
    const [activeTab, setActiveTab] = useState('predictor');
    const [historicalData, setHistoricalData] = useState<any>(null);

    useEffect(() => {
        loadExpiries();
        checkStatus();
    }, []);

    const loadExpiries = async () => {
        try {
            const data = await dataApi.getExpiries();
            setExpiries(data.expiries || []);
            if (data.expiries?.length > 0 && !selectedExpiry) {
                setSelectedExpiry(data.expiries[0].folder);
            }
        } catch (e) { console.error(e); }
    };

    const checkStatus = async () => {
        try {
            const res = await mlApi.getStatus();
            setStatus(res);
        } catch (e) {
            console.error("ML Status error", e);
        }
    };

    const runPrediction = async () => {
        if (!selectedExpiry || !timestamp) return;
        setLoading(true);
        try {
            const res = await mlApi.predict(selectedExpiry, timestamp, globalUseUnified);
            setPrediction(res);
        } catch (e) {
            console.error(e);
            alert('Failed to get prediction');
        }
        setLoading(false);
    };

    const runHistorical = async () => {
        if (!selectedExpiry) return;
        setLoading(true);
        try {
            const res = await mlApi.getHistoricalPredictions(selectedExpiry);
            setHistoricalData(res.timeline);
        } catch (e) {
            console.error(e);
            alert('Failed to get historical predictions');
        }
        setLoading(false);
    };

    // Helper to format probabilities into a circular dial or bar
    const renderGauge = (label: string, prob: number, color: string) => (
        <div style={{ flex: 1, padding: 16, background: 'var(--bg-input)', borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
            <div style={{ fontSize: 32, fontWeight: 700, color }}>
                {(prob * 100).toFixed(1)}%
            </div>
            <div style={{ marginTop: 12, height: 6, width: '100%', background: 'var(--bg-card)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${prob * 100}%`, background: color }} />
            </div>
        </div>
    );

    const renderPredictorTab = () => (
        <div className="fade-in">
            {/* Controls */}
            <div className="card" style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div className="form-group" style={{ margin: 0, minWidth: 200, flex: 1 }}>
                        <label className="form-label">Target Expiry</label>
                        <select className="form-select" value={selectedExpiry} onChange={e => setSelectedExpiry(e.target.value)}>
                            <option value="">Select expiry...</option>
                            {expiries.map((e: any) => (
                                <option key={e.folder} value={e.folder}>{e.folder} ({e.date})</option>
                            ))}
                        </select>
                    </div>
                    <div className="form-group" style={{ margin: 0, width: 150 }}>
                        <label className="form-label">Time (HH:MM)</label>
                        <input type="time" className="form-input" value={timestamp} onChange={e => setTimestamp(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Data Source</label>
                        <div style={{ height: 38, display: 'flex', alignItems: 'center', fontSize: 13, background: 'var(--bg-input)', padding: '0 12px', borderRadius: 6, color: 'var(--text-muted)' }}>
                            Controlled via Global Toggle (Top Right)
                        </div>
                    </div>
                    <button
                        className="btn btn-primary"
                        onClick={runPrediction}
                        disabled={loading || !selectedExpiry || !timestamp}
                        style={{ height: 38 }}
                    >
                        {loading ? 'Analyzing...' : 'Generate Prediction'}
                    </button>
                </div>
            </div>

            {/* Results Area */}
            {prediction && (
                <div className="fade-in">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
                        {renderGauge("Up Probability", prediction.probabilities.UP, 'var(--green)')}
                        {renderGauge("Down Probability", prediction.probabilities.DOWN, 'var(--red)')}
                        {renderGauge("Sideways Prob", prediction.probabilities.SIDEWAYS, 'var(--text-muted)')}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                        <div className="card">
                            <div className="card-header">
                                <div className="card-title">Prediction Insights</div>
                            </div>
                            <div style={{ padding: '0 20px 20px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Horizon</span>
                                    <span style={{ fontWeight: 600 }}>{prediction.prediction_horizon}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Expected Magnitude</span>
                                    <span style={{ fontWeight: 600, color: 'var(--text-strong)' }}>
                                        {prediction.expected_magnitude_points > 0 ? '+' : ''}{prediction.expected_magnitude_points} pts
                                    </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Model Confidence</span>
                                    <span style={{ fontWeight: 600 }}>{(prediction.confidence * 100).toFixed(1)}%</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Strategy Action</span>
                                    <span className="badge" style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--green)' }}>
                                        {prediction.recommended_action}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="card">
                            <div className="card-header">
                                <div className="card-title">Model Diagnostics</div>
                            </div>
                            <div style={{ padding: '20px' }} className="empty-state">
                                <div className="spinner" style={{ display: 'none' }} />
                                <p style={{ fontSize: 13 }}>
                                    Feature importance and ensemble weight Breakdown will be visualized here once models are fully trained in Phase 3.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    const renderHistoricalTab = () => (
        <div className="fade-in">
            <div className="card" style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div className="form-group" style={{ margin: 0, minWidth: 200, flex: 1 }}>
                        <label className="form-label">Target Expiry</label>
                        <select className="form-select" value={selectedExpiry} onChange={e => setSelectedExpiry(e.target.value)}>
                            <option value="">Select expiry...</option>
                            {expiries.map((e: any) => (
                                <option key={e.folder} value={e.folder}>{e.folder} ({e.date})</option>
                            ))}
                        </select>
                    </div>
                    <button
                        className="btn btn-primary"
                        onClick={runHistorical}
                        disabled={loading || !selectedExpiry}
                        style={{ height: 38 }}
                    >
                        {loading ? 'Fetching History...' : 'Fetch Historical Comparison'}
                    </button>
                </div>
            </div>

            {historicalData && (
                <div className="fade-in">
                    <h3 style={{ marginBottom: 16 }}>Actual vs Predicted Performance (15m Intervals)</h3>
                    {historicalData.map((dayGroup: any) => (
                        <div key={dayGroup.date} className="card" style={{ marginBottom: 16 }}>
                            <div className="card-header" style={{ background: 'var(--bg-body)' }}>
                                <div className="card-title">{dayGroup.date}</div>
                            </div>
                            <div style={{ overflowX: 'auto' }}>
                                <table className="table" style={{ margin: 0 }}>
                                    <thead>
                                        <tr>
                                            <th>Time</th>
                                            <th>Spot Price</th>
                                            <th>UP Prob</th>
                                            <th>DOWN Prob</th>
                                            <th>SIDEWAYS Prob</th>
                                            <th>Predicted Move</th>
                                            <th>Actual Move</th>
                                            <th>Result</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {dayGroup.predictions.map((p: any, i: number) => (
                                            <tr key={i}>
                                                <td>{p.time}</td>
                                                <td>{p.spot_price?.toFixed(2)}</td>
                                                <td style={{ color: p.probabilities.UP > 0.6 ? 'var(--green)' : '' }}>
                                                    {(p.probabilities.UP * 100).toFixed(1)}%
                                                </td>
                                                <td style={{ color: p.probabilities.DOWN > 0.6 ? 'var(--red)' : '' }}>
                                                    {(p.probabilities.DOWN * 100).toFixed(1)}%
                                                </td>
                                                <td>{(p.probabilities.SIDEWAYS * 100).toFixed(1)}%</td>
                                                <td style={{ fontWeight: 'bold' }}>{p.predicted_move}</td>
                                                <td>{p.actual_move}</td>
                                                <td>
                                                    {p.correct === true ? (
                                                        <span className="badge" style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--green)' }}>Correct</span>
                                                    ) : p.correct === false ? (
                                                        <span className="badge" style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--red)' }}>Miss</span>
                                                    ) : (
                                                        <span className="badge" style={{ background: 'var(--bg-input)' }}>Unknown</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ))}
                    {historicalData.length === 0 && (
                        <div className="empty-state">No historical data available for this expiry.</div>
                    )}
                </div>
            )}
        </div>
    );

    const renderDocTab = () => (
        <div className="fade-in card" style={{ padding: '30px' }}>
            <h2 style={{ marginTop: 0 }}>Option Predictor Documentation</h2>
            <p style={{ color: 'var(--text-muted)' }}>
                This intelligent prediction tool utilizes an <strong>XGBoost Ensemble Model</strong>, trained on high-fidelity Options and Index data, to forecast market movements.
            </p>

            <h4 style={{ marginTop: '24px' }}>How it Works</h4>
            <p style={{ fontSize: '14px', lineHeight: 1.6 }}>
                The predictor generates advanced features across a rolling look-behind window. These features include:
            </p>
            <ul style={{ fontSize: '14px', lineHeight: 1.6, color: 'var(--text-muted)' }}>
                <li><strong>Short-Term Returns:</strong> 1-minute, 5-minute, and 15-minute spot returns</li>
                <li><strong>Volatility & RSI:</strong> 15-minute rolling volatility and 14-period Relative Strength Index</li>
                <li><strong>Futures Basis:</strong> Basis percentage difference between Futures and Spot price</li>
                <li><strong>Put/Call Ratios:</strong> PCR by Volume and PCR by Open Interest</li>
                <li><strong>OI Momentum:</strong> 5-minute rate of change for CE and PE Open Interest</li>
            </ul>

            <h4 style={{ marginTop: '24px' }}>Tab Guide</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '16px' }}>
                <div style={{ background: 'var(--bg-body)', padding: '16px', borderRadius: '8px' }}>
                    <h5 style={{ margin: '0 0 8px 0', color: 'var(--blue)' }}>Live Predictor</h5>
                    <p style={{ fontSize: '13px', margin: 0, color: 'var(--text-muted)' }}>
                        Select any expiry and specific time of day (e.g. 10:15 Moring). The model will assess the exact features at that nanosecond and output a probability pie chart determining the likely next 5-to-15 minute vector of the NIFTY index.
                    </p>
                </div>
                <div style={{ background: 'var(--bg-body)', padding: '16px', borderRadius: '8px' }}>
                    <h5 style={{ margin: '0 0 8px 0', color: 'var(--green)' }}>Historical Comparison</h5>
                    <p style={{ fontSize: '13px', margin: 0, color: 'var(--text-muted)' }}>
                        Allows you to evaluate the model's performance on full days leading up to expiry. It calculates the prediction for every 15-minute interval throughout the trading day and actively compares the predicted outcome against the <em>actual</em> 5-minute directional outcome.
                    </p>
                </div>
            </div>

            <div style={{ marginTop: '30px', padding: '16px', borderLeft: '3px solid var(--blue)', background: 'rgba(59,130,246,0.05)' }}>
                <strong style={{ fontSize: '13px', display: 'block', marginBottom: '4px' }}>Strategy Integration Note</strong>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>You can integrate this directly into any YAML strategy backtest by specifying `ml_prediction_direction` and `ml_prediction_threshold` under your Entry conditions. Doing this natively filters your trade entries using this exact logic!</span>
            </div>
        </div>
    );

    return (
        <div className="fade-in">
            {/* Top Info Bar */}
            <div className="card" style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h3 style={{ margin: '0 0 4px 0', fontSize: 16 }}>ML Predictor Engine 🧠</h3>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                        Short-term directional forecasting using XGBoost and Sequence Ensembles.
                    </p>
                </div>
                {status && (
                    <div className="badge" style={{ background: 'rgba(59,130,246,0.1)', color: 'var(--blue)' }}>
                        Status: {status.status.toUpperCase()}
                    </div>
                )}
            </div>

            {/* Tab Navigation */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
                <button
                    className={`btn ${activeTab === 'predictor' ? 'btn-primary' : ''}`}
                    onClick={() => setActiveTab('predictor')}
                    style={{ background: activeTab !== 'predictor' ? 'var(--bg-card)' : undefined }}
                >
                    Live Predictor
                </button>
                <button
                    className={`btn ${activeTab === 'historical' ? 'btn-primary' : ''}`}
                    onClick={() => setActiveTab('historical')}
                    style={{ background: activeTab !== 'historical' ? 'var(--bg-card)' : undefined }}
                >
                    Historical Comparison
                </button>
                <button
                    className={`btn ${activeTab === 'doc' ? 'btn-primary' : ''}`}
                    onClick={() => setActiveTab('doc')}
                    style={{ background: activeTab !== 'doc' ? 'var(--bg-card)' : undefined }}
                >
                    Documentation
                </button>
            </div>

            {/* Render Active Tab */}
            {activeTab === 'predictor' && renderPredictorTab()}
            {activeTab === 'historical' && renderHistoricalTab()}
            {activeTab === 'doc' && renderDocTab()}
        </div>
    );
}
