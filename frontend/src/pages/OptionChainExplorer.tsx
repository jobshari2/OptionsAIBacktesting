import { useState, useEffect } from 'react';
import { dataApi } from '../api/client';
import { useDataStore } from '../stores/appStore';

export default function OptionChainExplorer() {
    const { expiries, setExpiries, selectedExpiry, setSelectedExpiry, optionChain, setOptionChain, globalUseUnified } = useDataStore();
    const [loading, setLoading] = useState(false);
    const [stepping, setStepping] = useState(false);
    const [filter, setFilter] = useState('');
    const [showCE, setShowCE] = useState(true);
    const [showPE, setShowPE] = useState(true);
    const [metrics, setMetrics] = useState<{ load_time_ms?: number; source_type?: string }>({});

    // New States for Time Stepper
    const [timestamps, setTimestamps] = useState<string[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [stepMinutes, setStepMinutes] = useState(5);

    // New States for Spot and Futures
    const [indexData, setIndexLocalData] = useState<any[]>([]);
    const [futuresData, setFuturesLocalData] = useState<any[]>([]);

    useEffect(() => {
        loadExpiries();
    }, []);

    const loadExpiries = async () => {
        try {
            const data = await dataApi.getExpiries();
            setExpiries(data.expiries || []);
        } catch (e) { console.error(e); }
    };

    // Main loader for an expiry
    const loadDataForExpiry = async (expiry: string) => {
        if (!expiry) return;
        setLoading(true);
        setSelectedExpiry(expiry);
        setCurrentIndex(0);
        setTimestamps([]);

        try {
            // Run option chain request (without timestamp to get the first one + array of all timestamps)
            const optRes = await dataApi.getOptionChain(expiry, undefined, globalUseUnified);
            setOptionChain(optRes.data || []);
            setTimestamps(optRes.timestamps || []);
            setMetrics({
                load_time_ms: optRes.load_time_ms,
                source_type: optRes.source_type
            });

            // Simultaneously fetch index and futures data
            const [idxRes, futRes] = await Promise.all([
                dataApi.getIndexData(expiry),
                dataApi.getFuturesData(expiry).catch(() => ({ data: [] }))
            ]);

            setIndexLocalData(idxRes.data || []);
            setFuturesLocalData(futRes.data || []);

        } catch (e) {
            console.error(e);
            setOptionChain([]);
            setTimestamps([]);
            setMetrics({});
        }
        setLoading(false);
    };

    // Loader for time-stepping without refreshing index/futures
    const loadChainAtTime = async (timeStr: string) => {
        if (!selectedExpiry) return;
        setStepping(true);
        try {
            const optRes = await dataApi.getOptionChain(selectedExpiry, timeStr, globalUseUnified);
            setOptionChain(optRes.data || []);
            setMetrics({
                load_time_ms: optRes.load_time_ms,
                source_type: optRes.source_type
            });
        } catch (e) {
            console.error(e);
        }
        setStepping(false);
    }

    const handleStepBackward = () => {
        if (timestamps.length === 0 || currentIndex === 0) return;

        let targetMs = new Date(timestamps[currentIndex]).getTime() - (stepMinutes * 60000);

        // Find closest timestamp before or exact
        let newIdx = currentIndex;
        for (let i = currentIndex - 1; i >= 0; i--) {
            if (new Date(timestamps[i]).getTime() <= targetMs) {
                newIdx = i;
                break;
            }
            if (i === 0) newIdx = 0; // fallback to start
        }
        if (newIdx !== currentIndex) {
            setCurrentIndex(newIdx);
            loadChainAtTime(timestamps[newIdx]);
        }
    };

    const handleStepForward = () => {
        if (timestamps.length === 0 || currentIndex === timestamps.length - 1) return;

        let targetMs = new Date(timestamps[currentIndex]).getTime() + (stepMinutes * 60000);

        // Find closest timestamp after or exact
        let newIdx = currentIndex;
        for (let i = currentIndex + 1; i < timestamps.length; i++) {
            if (new Date(timestamps[i]).getTime() >= targetMs) {
                newIdx = i;
                break;
            }
            if (i === timestamps.length - 1) newIdx = timestamps.length - 1; // fallback to end
        }
        if (newIdx !== currentIndex) {
            setCurrentIndex(newIdx);
            loadChainAtTime(timestamps[newIdx]);
        }
    };

    const handleNextDay = () => {
        if (timestamps.length === 0) return;
        const currentTS = timestamps[currentIndex];
        const [currDate, currTime] = currentTS.split(' ');

        // Find next unique date
        const allDates = [...new Set(timestamps.map(ts => ts.split(' ')[0]))];
        const currDateIdx = allDates.indexOf(currDate);

        if (currDateIdx < allDates.length - 1) {
            const nextDate = allDates[currDateIdx + 1];
            // Find same time on next date or closest
            let bestIdx = currentIndex;

            for (let i = 0; i < timestamps.length; i++) {
                const [d, t] = timestamps[i].split(' ');
                if (d === nextDate) {
                    // Try to match time exactly or closest
                    if (t === currTime) {
                        bestIdx = i;
                        break;
                    }
                }
            }
            // If exact time not found, just pick first timestamp of that day as fallback
            if (timestamps[bestIdx].split(' ')[0] !== nextDate) {
                bestIdx = timestamps.findIndex(ts => ts.startsWith(nextDate));
            }

            if (bestIdx !== -1 && bestIdx !== currentIndex) {
                setCurrentIndex(bestIdx);
                loadChainAtTime(timestamps[bestIdx]);
            }
        }
    };

    const handlePrevDay = () => {
        if (timestamps.length === 0) return;
        const currentTS = timestamps[currentIndex];
        const [currDate, currTime] = currentTS.split(' ');

        // Find prev unique date
        const allDates = [...new Set(timestamps.map(ts => ts.split(' ')[0]))];
        const currDateIdx = allDates.indexOf(currDate);

        if (currDateIdx > 0) {
            const prevDate = allDates[currDateIdx - 1];
            // Find same time on prev date or closest
            let bestIdx = currentIndex;

            for (let i = 0; i < timestamps.length; i++) {
                const [d, t] = timestamps[i].split(' ');
                if (d === prevDate) {
                    if (t === currTime) {
                        bestIdx = i;
                        break;
                    }
                }
            }
            if (timestamps[bestIdx].split(' ')[0] !== prevDate) {
                bestIdx = timestamps.findIndex(ts => ts.startsWith(prevDate));
            }

            if (bestIdx !== -1 && bestIdx !== currentIndex) {
                setCurrentIndex(bestIdx);
                loadChainAtTime(timestamps[bestIdx]);
            }
        }
    };

    // Derived values for the current timestamp
    const currentTimestamp = timestamps[currentIndex] || '';
    const currentSpot = indexData.find(d => d.Date === currentTimestamp)?.Close;
    const currentFuture = futuresData.find(d => d.Date === currentTimestamp)?.Close;

    const filteredChain = optionChain.filter((row: any) => {
        if (!showCE && row.Right === 'CE') return false;
        if (!showPE && row.Right === 'PE') return false;
        if (filter && !String(row.Strike).includes(filter)) return false;
        return true;
    });

    const strikes = [...new Set(filteredChain.map((r: any) => r.Strike))].sort((a, b) => a - b);

    // Calculate closest strikes for highlighting
    const getClosestStrike = (val: number | undefined) => {
        if (!val || strikes.length === 0) return null;
        return strikes.reduce((prev, curr) => Math.abs(curr - val) < Math.abs(prev - val) ? curr : prev);
    };

    const closestSpotStrike = getClosestStrike(currentSpot);
    const closestFutureStrike = getClosestStrike(currentFuture);

    return (
        <div className="fade-in">
            {/* Top Control Bar */}
            <div className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div className="form-group" style={{ flex: 1, margin: 0, minWidth: 200 }}>
                        <label className="form-label">Expiry</label>
                        <select className="form-select" value={selectedExpiry}
                            onChange={e => loadDataForExpiry(e.target.value)}>
                            <option value="">Select expiry...</option>
                            {expiries.map((e: any) => (
                                <option key={e.folder} value={e.folder}>{e.folder} ({e.date})</option>
                            ))}
                        </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Strike Filter</label>
                        <input className="form-input" placeholder="Filter strikes..."
                            value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 160 }} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Data Source</label>
                        <div style={{ height: 38, display: 'flex', alignItems: 'center', fontSize: 13, background: 'var(--bg-input)', padding: '0 12px', borderRadius: 6, color: 'var(--text-muted)' }}>
                            Controlled via Global Toggle
                        </div>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', height: 38 }}>
                        <input type="checkbox" checked={showCE} onChange={e => setShowCE(e.target.checked)} /> CE
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', height: 38 }}>
                        <input type="checkbox" checked={showPE} onChange={e => setShowPE(e.target.checked)} /> PE
                    </label>
                </div>
            </div>

            {/* Time Stepper and Spot Board */}
            {selectedExpiry && timestamps.length > 0 && (
                <div className="card" style={{
                    marginBottom: 16,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'var(--bg-body)',
                    border: stepping ? '1px solid var(--green)' : '1px solid var(--blue)',
                    transition: 'border-color 0.2s'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                            className="btn"
                            onClick={handlePrevDay}
                            disabled={loading || stepping || currentIndex === 0}
                            style={{ background: 'var(--bg-input)', padding: '6px 10px' }}
                            title="Previous Day"
                        >
                            &laquo;&laquo; Prev Day
                        </button>
                        <button
                            className="btn"
                            onClick={handleStepBackward}
                            disabled={loading || stepping || currentIndex === 0}
                            style={{ background: 'var(--bg-input)', padding: '6px 12px' }}
                        >
                            &laquo; Back
                        </button>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', margin: '0 4px' }}>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Mins:</span>
                            <input
                                type="number"
                                className="form-input"
                                style={{ width: 50, height: 28, padding: '2px 6px', fontSize: '12px' }}
                                value={stepMinutes}
                                onChange={e => setStepMinutes(parseInt(e.target.value) || 1)}
                                min="1"
                                max="60"
                            />
                        </div>

                        <button
                            className="btn"
                            onClick={handleStepForward}
                            disabled={loading || stepping || currentIndex === timestamps.length - 1}
                            style={{ background: 'var(--bg-input)', padding: '6px 12px' }}
                        >
                            Next &raquo;
                        </button>
                        <button
                            className="btn"
                            onClick={handleNextDay}
                            disabled={loading || stepping || currentIndex === timestamps.length - 1}
                            style={{ background: 'var(--bg-input)', padding: '6px 10px' }}
                            title="Next Day"
                        >
                            Next Day &raquo;&raquo;
                        </button>

                        {stepping && <div className="spinner-small" style={{ marginLeft: 4 }} />}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Current Date</div>
                            <div style={{ fontSize: '16px', fontWeight: 600 }}>
                                {(() => {
                                    if (!currentTimestamp) return '---';
                                    const datePart = currentTimestamp.split(' ')[0];
                                    const [d, m, y] = datePart.split('/');
                                    const dateObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
                                    const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                                    return `${datePart} (${dayName})`;
                                })()}
                            </div>
                        </div>
                        <div style={{ width: '1px', height: '30px', background: 'var(--border-color)' }}></div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Current Time</div>
                            <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--blue)' }}>
                                {currentTimestamp.split(' ')[1] || '---'}
                            </div>
                        </div>
                        <div style={{ width: '1px', height: '30px', background: 'var(--border-color)' }}></div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Nifty Spot</div>
                            <div style={{ fontSize: '16px', fontWeight: 600 }}>
                                {currentSpot ? currentSpot.toFixed(2) : '---'}
                            </div>
                        </div>
                        <div style={{ width: '1px', height: '30px', background: 'var(--border-color)' }}></div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Nifty Futures</div>
                            <div style={{ fontSize: '16px', fontWeight: 600 }}>
                                {currentFuture ? currentFuture.toFixed(2) : '---'}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Option Chain */}
            {loading ? (
                <div className="loading-overlay"><div className="spinner" /><span>Loading option chain...</span></div>
            ) : filteredChain.length > 0 ? (
                <div className="card">
                    <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div className="card-title">
                            Option Chain
                            <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                                {filteredChain.length} records, {strikes.length} strikes
                            </span>
                        </div>
                        {metrics.load_time_ms !== undefined && (
                            <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
                                <div className="badge" style={{ background: 'rgba(59, 130, 246, 0.1)', color: 'var(--blue)' }}>
                                    Mode: {metrics.source_type?.toUpperCase()}
                                </div>
                                <div className="badge" style={{ background: 'rgba(139, 92, 246, 0.1)', color: 'var(--purple)' }}>
                                    Load Time: {metrics.load_time_ms}ms
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="table-container" style={{
                        maxHeight: 600,
                        overflowY: 'auto',
                        opacity: stepping ? 0.7 : 1,
                        transition: 'opacity 0.2s',
                        filter: stepping ? 'blur(0.5px)' : 'none'
                    }}>
                        <table className="option-chain-table">
                            <thead>
                                <tr>
                                    <th colSpan={4} style={{ textAlign: 'center', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--green)' }}>CALLS (CE)</th>
                                    <th style={{ textAlign: 'center', background: 'var(--bg-card)' }}>STRIKE</th>
                                    <th colSpan={4} style={{ textAlign: 'center', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--red)' }}>PUTS (PE)</th>
                                </tr>
                                <tr>
                                    <th style={{ textAlign: 'right' }}>OI</th>
                                    <th style={{ textAlign: 'right' }}>Volume</th>
                                    <th style={{ textAlign: 'right' }}>Close</th>
                                    <th style={{ textAlign: 'right' }}>LTP</th>
                                    <th style={{ textAlign: 'center' }}>Price</th>
                                    <th style={{ textAlign: 'left' }}>LTP</th>
                                    <th style={{ textAlign: 'left' }}>Close</th>
                                    <th style={{ textAlign: 'left' }}>Volume</th>
                                    <th style={{ textAlign: 'left' }}>OI</th>
                                </tr>
                            </thead>
                            <tbody>
                                {strikes.map((strike: number, i: number) => {
                                    const ce = filteredChain.find((r: any) => r.Strike === strike && r.Right === 'CE') || {};
                                    const pe = filteredChain.find((r: any) => r.Strike === strike && r.Right === 'PE') || {};
                                    const isSpotATM = strike === closestSpotStrike;
                                    const isFutureATM = strike === closestFutureStrike;

                                    if (!ce.Strike && !pe.Strike) return null;

                                    let rowBg = 'inherit';
                                    let strikeBg = 'var(--bg-input)';
                                    let strikeBorder = 'none';

                                    if (isSpotATM && isFutureATM) {
                                        rowBg = 'rgba(59, 130, 246, 0.08)';
                                        strikeBorder = '1px solid var(--blue)';
                                    } else if (isSpotATM) {
                                        rowBg = 'rgba(59, 130, 246, 0.05)';
                                        strikeBorder = '1px dashed var(--blue)';
                                    } else if (isFutureATM) {
                                        rowBg = 'rgba(139, 92, 246, 0.05)';
                                        strikeBorder = '1px dashed var(--purple)';
                                    }

                                    return (
                                        <tr key={i} style={{ background: rowBg }}>
                                            <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{(ce.OI || 0).toLocaleString()}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{(ce.Volume || 0).toLocaleString()}</td>
                                            <td style={{ textAlign: 'right' }}>{(ce.Close || 0).toFixed(2)}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600, color: ce.Close ? 'var(--green)' : 'inherit' }}>{(ce.Close || '--')}</td>

                                            <td style={{
                                                textAlign: 'center',
                                                fontWeight: 700,
                                                background: isSpotATM || isFutureATM ? 'var(--bg-card)' : strikeBg,
                                                border: strikeBorder,
                                                position: 'relative'
                                            }}>
                                                {strike}
                                                {isSpotATM && <div title="Closest to Spot" style={{ position: 'absolute', top: -2, right: 2, fontSize: 8, color: 'var(--blue)' }}>●</div>}
                                                {isFutureATM && <div title="Closest to Future" style={{ position: 'absolute', bottom: -2, right: 2, fontSize: 8, color: 'var(--purple)' }}>◆</div>}
                                            </td>

                                            <td style={{ textAlign: 'left', fontWeight: 600, color: pe.Close ? 'var(--red)' : 'inherit' }}>{(pe.Close || '--')}</td>
                                            <td style={{ textAlign: 'left' }}>{(pe.Close || 0).toFixed(2)}</td>
                                            <td style={{ textAlign: 'left', color: 'var(--text-muted)' }}>{(pe.Volume || 0).toLocaleString()}</td>
                                            <td style={{ textAlign: 'left', color: 'var(--text-muted)' }}>{(pe.OI || 0).toLocaleString()}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : selectedExpiry ? (
                <div className="card">
                    <div className="empty-state">
                        <div className="empty-icon">🔗</div>
                        <h3>No data found</h3>
                        <p>No option chain data available for this expiry.</p>
                    </div>
                </div>
            ) : (
                <div className="card">
                    <div className="empty-state">
                        <div className="empty-icon">🔗</div>
                        <h3>Select an Expiry</h3>
                        <p>Choose an expiry date to explore the historical option chain.</p>
                    </div>
                </div>
            )}
        </div>
    );
}
