import { useState } from 'react';
import { dataApi } from '../api/client';

interface BenchmarkResult {
    num_tests: number;
    averages: {
        individual_ms: number;
        unified_ms: number;
        improvement_pct: number;
    };
    details: Array<{
        expiry: string;
        individual_ms: number;
        unified_ms: number;
        improvement_pct: number;
    }>;
}

export default function DataPerformance() {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<BenchmarkResult | null>(null);
    const [count, setCount] = useState(5);

    const runBenchmark = async () => {
        setLoading(true);
        try {
            const data = await dataApi.runBenchmark(count);
            setResult(data);
        } catch (e) {
            console.error(e);
            alert('Failed to run benchmark');
        }
        setLoading(false);
    };

    return (
        <div className="fade-in">
            <div className="card" style={{ marginBottom: 24 }}>
                <div className="card-header">
                    <div className="card-title">Data Loading Performance Benchmark</div>
                </div>
                <div style={{ padding: 20 }}>
                    <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
                        Run a comparison test between loading individual Parquet files (original format)
                        and the new Unified Parquet file. The test will select random expiries and measure
                        the time taken to load all components (Index, Futures, Options).
                    </p>
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Number of Expiries to Test</label>
                            <input
                                type="number"
                                className="form-input"
                                value={count}
                                onChange={e => setCount(parseInt(e.target.value) || 1)}
                                style={{ width: 120 }}
                                min={1}
                                max={20}
                            />
                        </div>
                        <button
                            className="btn btn-primary"
                            onClick={runBenchmark}
                            disabled={loading}
                            style={{ alignSelf: 'flex-end', height: 38 }}
                        >
                            {loading ? 'Running Tests...' : 'Start Performance Test'}
                        </button>
                    </div>
                </div>
            </div>

            {loading && (
                <div className="card" style={{ padding: 40, textAlign: 'center' }}>
                    <div className="spinner" style={{ margin: '0 auto 16px' }} />
                    <p>Benchmarking data engines... This may take a few moments.</p>
                </div>
            )}

            {result && !loading && (
                <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20, marginBottom: 24 }}>
                        <div className="card stats-card">
                            <div className="stats-label">Avg. Individual Loading</div>
                            <div className="stats-value">{result.averages.individual_ms}ms</div>
                            <div className="stats-trend">Original 3-file format</div>
                        </div>
                        <div className="card stats-card">
                            <div className="stats-label">Avg. Unified Loading</div>
                            <div className="stats-value" style={{ color: 'var(--green)' }}>{result.averages.unified_ms}ms</div>
                            <div className="stats-trend">New single-file format</div>
                        </div>
                        <div className="card stats-card">
                            <div className="stats-label">Performance Boost</div>
                            <div className="stats-value" style={{ color: 'var(--blue)' }}>{result.averages.improvement_pct}%</div>
                            <div className="stats-trend">Faster with unified files</div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header">
                            <div className="card-title">Detailed Run History</div>
                        </div>
                        <div className="table-container">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Expiry Folder</th>
                                        <th style={{ textAlign: 'right' }}>Individual (ms)</th>
                                        <th style={{ textAlign: 'right' }}>Unified (ms)</th>
                                        <th style={{ textAlign: 'right' }}>Improvement</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {result.details.map((d, i) => (
                                        <tr key={i}>
                                            <td style={{ fontWeight: 600 }}>{d.expiry}</td>
                                            <td style={{ textAlign: 'right' }}>{d.individual_ms}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--green)' }}>{d.unified_ms}</td>
                                            <td style={{ textAlign: 'right' }}>
                                                <span className="badge" style={{
                                                    background: d.improvement_pct > 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                                    color: d.improvement_pct > 0 ? 'var(--green)' : 'var(--red)'
                                                }}>
                                                    {d.improvement_pct}%
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
        </div>
    );
}
