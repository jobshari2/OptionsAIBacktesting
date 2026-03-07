import { useState, useEffect } from 'react';
import { strategyApi } from '../api/client';
import { useStrategyStore } from '../stores/appStore';

const defaultLeg = { direction: 'sell', right: 'CE', strike_offset: 0, quantity: 1, label: '' };

export default function StrategyBuilder() {
    const { strategies, setStrategies } = useStrategyStore();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [legs, setLegs] = useState([{ ...defaultLeg }]);
    const [entryTime, setEntryTime] = useState('09:20');
    const [exitTime, setExitTime] = useState('15:15');
    const [stopLossPct, setStopLossPct] = useState('100');
    const [targetProfitPct, setTargetProfitPct] = useState('50');
    const [lotSize, setLotSize] = useState('25');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [templates, setTemplates] = useState<any[]>([]);

    useEffect(() => {
        loadStrategies();
        loadTemplates();
    }, []);

    const loadStrategies = async () => {
        try {
            const data = await strategyApi.list();
            setStrategies(data.strategies || []);
        } catch (e) { console.error(e); }
    };

    const loadTemplates = async () => {
        try {
            const data = await strategyApi.getTemplates();
            setTemplates(data.templates || []);
        } catch (e) { console.error(e); }
    };

    const addLeg = () => setLegs([...legs, { ...defaultLeg, right: legs.length % 2 === 0 ? 'CE' : 'PE' }]);
    const removeLeg = (i: number) => setLegs(legs.filter((_, idx) => idx !== i));
    const updateLeg = (i: number, field: string, value: any) => {
        const updated = [...legs];
        updated[i] = { ...updated[i], [field]: value };
        setLegs(updated);
    };

    const loadExistingStrategy = async (name: string) => {
        try {
            const data = await strategyApi.get(name);
            const s = data.strategy;
            setName(s.name);
            setDescription(s.description || '');
            setLegs(s.legs || []);
            setEntryTime(s.entry?.entry_time || '09:20');
            setExitTime(s.exit?.exit_time || '15:15');
            setStopLossPct(String(s.exit?.stop_loss_pct || ''));
            setTargetProfitPct(String(s.exit?.target_profit_pct || ''));
            setLotSize(String(s.lot_size || 25));
            setMessage(`Loaded: ${s.name}`);
        } catch (e) { console.error(e); }
    };

    const saveStrategy = async () => {
        if (!name.trim()) { setMessage('Strategy name is required'); return; }
        setSaving(true);
        try {
            await strategyApi.create({
                name: name.trim(),
                description,
                lot_size: parseInt(lotSize) || 25,
                legs,
                entry: { entry_time: entryTime },
                exit: {
                    exit_time: exitTime,
                    stop_loss_pct: stopLossPct ? parseFloat(stopLossPct) : null,
                    target_profit_pct: targetProfitPct ? parseFloat(targetProfitPct) : null,
                },
            });
            setMessage(`Strategy "${name}" saved successfully!`);
            loadStrategies();
        } catch (e: any) { setMessage(`Error: ${e.message}`); }
        setSaving(false);
    };

    return (
        <div className="fade-in">
            <div className="grid-2" style={{ gap: 24 }}>
                {/* Builder Form */}
                <div>
                    <div className="card" style={{ marginBottom: 16 }}>
                        <div className="card-header">
                            <div className="card-title">Strategy Configuration</div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Strategy Name</label>
                            <input className="form-input" value={name} onChange={e => setName(e.target.value)}
                                placeholder="e.g., iron_condor_aggressive" />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Description</label>
                            <input className="form-input" value={description} onChange={e => setDescription(e.target.value)}
                                placeholder="Brief description of the strategy" />
                        </div>
                        <div className="grid-2">
                            <div className="form-group">
                                <label className="form-label">Lot Size</label>
                                <input className="form-input" type="number" value={lotSize}
                                    onChange={e => setLotSize(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Entry Time</label>
                                <input className="form-input" type="time" value={entryTime}
                                    onChange={e => setEntryTime(e.target.value)} />
                            </div>
                        </div>
                        <div className="grid-3">
                            <div className="form-group">
                                <label className="form-label">Exit Time</label>
                                <input className="form-input" type="time" value={exitTime}
                                    onChange={e => setExitTime(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Stop Loss %</label>
                                <input className="form-input" type="number" value={stopLossPct}
                                    onChange={e => setStopLossPct(e.target.value)} placeholder="e.g., 100" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Target Profit %</label>
                                <input className="form-input" type="number" value={targetProfitPct}
                                    onChange={e => setTargetProfitPct(e.target.value)} placeholder="e.g., 50" />
                            </div>
                        </div>
                    </div>

                    {/* Legs */}
                    <div className="card">
                        <div className="card-header">
                            <div className="card-title">Option Legs</div>
                            <button className="btn btn-sm btn-secondary" onClick={addLeg}>+ Add Leg</button>
                        </div>
                        {legs.map((leg, i) => (
                            <div key={i} className="leg-row">
                                <select className="form-select" value={leg.direction}
                                    onChange={e => updateLeg(i, 'direction', e.target.value)}>
                                    <option value="buy">Buy</option>
                                    <option value="sell">Sell</option>
                                </select>
                                <select className="form-select" value={leg.right}
                                    onChange={e => updateLeg(i, 'right', e.target.value)}>
                                    <option value="CE">CE</option>
                                    <option value="PE">PE</option>
                                </select>
                                <div>
                                    <input className="form-input" type="number" placeholder="Offset"
                                        value={leg.strike_offset} onChange={e => updateLeg(i, 'strike_offset', parseInt(e.target.value) || 0)} />
                                </div>
                                <input className="form-input" type="number" min="1" value={leg.quantity}
                                    onChange={e => updateLeg(i, 'quantity', parseInt(e.target.value) || 1)} />
                                <input className="form-input" placeholder="Label" value={leg.label}
                                    onChange={e => updateLeg(i, 'label', e.target.value)} />
                                <button className="btn-icon" onClick={() => removeLeg(i)}
                                    style={{ color: 'var(--red)' }}>✕</button>
                            </div>
                        ))}
                        <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
                            <button className="btn btn-primary" onClick={saveStrategy} disabled={saving}>
                                {saving ? '⏳ Saving...' : '💾 Save Strategy'}
                            </button>
                            {message && (
                                <span style={{ fontSize: 13, color: message.includes('Error') ? 'var(--red)' : 'var(--green)' }}>
                                    {message}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Existing Strategies */}
                <div>
                    <div className="card" style={{ marginBottom: 16 }}>
                        <div className="card-header">
                            <div className="card-title">Strategy Templates</div>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {templates.map((t, i) => (
                                <div key={i} className="glass-card" style={{ padding: '10px 14px', cursor: 'pointer', flex: '1 1 45%' }}
                                    onClick={() => loadExistingStrategy(t.name)}>
                                    <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name.replace(/_/g, ' ')}</div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{t.description}</div>
                                    <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
                                        <span className="badge badge-blue">{t.type}</span>
                                        <span className={`badge ${t.risk === 'limited' ? 'badge-green' : 'badge-red'}`}>{t.risk}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header">
                            <div className="card-title">Saved Strategies ({strategies.length})</div>
                        </div>
                        {strategies.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {strategies.map((s, i) => (
                                    <div key={i} style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        padding: '10px 12px', background: 'var(--bg-input)',
                                        borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                                        border: '1px solid var(--border-subtle)',
                                    }} onClick={() => loadExistingStrategy(s.name)}>
                                        <div>
                                            <span style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</span>
                                            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                                                {s.legs_count} legs
                                            </span>
                                        </div>
                                        <button className="btn btn-sm btn-danger"
                                            onClick={async (e) => { e.stopPropagation(); await strategyApi.delete(s.name); loadStrategies(); }}>
                                            Delete
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="empty-state" style={{ padding: 30 }}>
                                <p>No strategies saved yet. Create one above.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
