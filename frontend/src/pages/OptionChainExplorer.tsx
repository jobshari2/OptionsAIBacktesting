import { useState, useEffect } from 'react';
import { dataApi } from '../api/client';
import { useDataStore } from '../stores/appStore';

export default function OptionChainExplorer() {
    const { expiries, setExpiries, selectedExpiry, setSelectedExpiry, optionChain, setOptionChain } = useDataStore();
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState('');
    const [showCE, setShowCE] = useState(true);
    const [showPE, setShowPE] = useState(true);

    useEffect(() => {
        loadExpiries();
    }, []);

    const loadExpiries = async () => {
        try {
            const data = await dataApi.getExpiries();
            setExpiries(data.expiries || []);
        } catch (e) { console.error(e); }
    };

    const loadChain = async (expiry: string) => {
        if (!expiry) return;
        setLoading(true);
        setSelectedExpiry(expiry);
        try {
            const data = await dataApi.getOptionChain(expiry);
            setOptionChain(data.data || []);
        } catch (e) { console.error(e); setOptionChain([]); }
        setLoading(false);
    };

    const filteredChain = optionChain.filter((row: any) => {
        if (!showCE && row.Right === 'CE') return false;
        if (!showPE && row.Right === 'PE') return false;
        if (filter && !String(row.Strike).includes(filter)) return false;
        return true;
    });

    // Group by strike for option chain view
    const strikes = [...new Set(filteredChain.map((r: any) => r.Strike))].sort((a, b) => a - b);

    return (
        <div className="fade-in">
            {/* Controls */}
            <div className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div className="form-group" style={{ flex: 1, margin: 0, minWidth: 200 }}>
                        <label className="form-label">Expiry</label>
                        <select className="form-select" value={selectedExpiry}
                            onChange={e => loadChain(e.target.value)}>
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
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                        <input type="checkbox" checked={showCE} onChange={e => setShowCE(e.target.checked)} /> CE
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                        <input type="checkbox" checked={showPE} onChange={e => setShowPE(e.target.checked)} /> PE
                    </label>
                </div>
            </div>

            {/* Option Chain */}
            {loading ? (
                <div className="loading-overlay"><div className="spinner" /><span>Loading option chain...</span></div>
            ) : filteredChain.length > 0 ? (
                <div className="card">
                    <div className="card-header">
                        <div className="card-title">
                            Option Chain — {selectedExpiry}
                            <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                                {filteredChain.length} records, {strikes.length} strikes
                            </span>
                        </div>
                    </div>
                    <div className="table-container" style={{ maxHeight: 600, overflowY: 'auto' }}>
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

                                    // Skip row if both CE and PE are empty after filtering
                                    if (!ce.Strike && !pe.Strike) return null;

                                    return (
                                        <tr key={i}>
                                            <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{(ce.OI || 0).toLocaleString()}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{(ce.Volume || 0).toLocaleString()}</td>
                                            <td style={{ textAlign: 'right' }}>{(ce.Close || 0).toFixed(2)}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600, color: ce.Close ? 'var(--green)' : 'inherit' }}>{(ce.Close || '--')}</td>

                                            <td style={{ textAlign: 'center', fontWeight: 700, background: 'var(--bg-input)' }}>{strike}</td>

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
