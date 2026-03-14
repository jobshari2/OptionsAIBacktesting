import { useState, useEffect, useMemo, useRef } from 'react';
import { createChart, ColorType, CrosshairMode, CandlestickSeries } from 'lightweight-charts';
import { dataApi, aiApi, breezeApi, BreezeWS } from '../api/client';
import ReactMarkdown from 'react-markdown';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';

const IST_OFFSET_S = 19800; // +5:30 in seconds
const globalUseUnified = true;

export default function OptionChainLive() {
    // Use component local state instead of global store so Live screen is independent
    const [selectedExpiry, setSelectedExpiry] = useState('');
    const [optionChain, setOptionChain] = useState<any[]>([]);
    
    // UI state
    const [availableExpiries, setAvailableExpiries] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [authStatus, setAuthStatus] = useState<{ authenticated: boolean; user_id?: string; updated_at?: string } | null>(null);
    const [apiSession, setApiSession] = useState('');
    const [wsConnected, setWsConnected] = useState(false);
    const [lastTick, setLastTick] = useState<any>(null);

    // Live specific state
    const [liveTicks, setLiveTicks] = useState<Record<string, any>>({});
    const [liveSpot, setLiveSpot] = useState<number | undefined>(undefined);
    const wsRef = useRef<BreezeWS | null>(null);
    const [stepping, setStepping] = useState(false);
    const [filter, setFilter] = useState('');
    const [showCE, setShowCE] = useState(true);
    const [showPE, setShowPE] = useState(true);
    const [metrics, setMetrics] = useState<{ load_time_ms?: number; source_type?: string }>({});
    const [isTableCollapsed, setIsTableCollapsed] = useState(false);
    const [isChartCollapsed, setIsChartCollapsed] = useState(false);
    const [isOiBuildupCollapsed, setIsOiBuildupCollapsed] = useState(false);
    const [isSpikesCollapsed, setIsSpikesCollapsed] = useState(false);
    const [oiSpikes, setOiSpikes] = useState<any[]>([]);
    const [spikeLoading, setSpikeLoading] = useState(false);
    const [spikeStats, setSpikeStats] = useState<any>(null);
    const [spikeThreshold, setSpikeThreshold] = useState(0.5);
    const [volThreshold, setVolThreshold] = useState(0.5);
    const [minLtp, setMinLtp] = useState(0);

    // AI State
    const [aiLoading, setAiLoading] = useState(false);
    const [aiResult, setAiResult] = useState<string | null>(null);
    const [aiError, setAiError] = useState<string | null>(null);
    const [isAiCollapsed, setIsAiCollapsed] = useState(false);
    const [aiModels, setAiModels] = useState<any[]>([]);
    const [selectedAiModel, setSelectedAiModel] = useState('gemini-1.5-flash');
    const [aiAnalysisTimestamp, setAiAnalysisTimestamp] = useState<string | null>(null);
    const [isAdvisorCollapsed, setIsAdvisorCollapsed] = useState(false);

    // New States for Time Stepper
    const [timestamps, setTimestamps] = useState<string[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [stepMinutes, setStepMinutes] = useState(5);
    const [isPlaying, setIsPlaying] = useState(false);
    const [trackedStrategy, setTrackedStrategy] = useState<any | null>(null);
    const [tradeHistory, setTradeHistory] = useState<any[]>([]);

    // Chart Refs
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<any>(null);
    const seriesRef = useRef<any>(null);
    const priceLinesRef = useRef<any[]>([]);

    // New States for Spot and Futures
    const [indexData, setIndexLocalData] = useState<any[]>([]);
    const [liveIndexData, setLiveIndexData] = useState<any[]>([]);
    const [futuresData, setFuturesLocalData] = useState<any[]>([]);

    // Helper to parse timestamps to Unix Timestamp (seconds) in IST for chart display
    const parseTimestamp = (ts: string) => {
        if (!ts) return 0;
        // Try custom "DD/MM/YYYY HH:MM:SS"
        if (ts.includes('/')) {
            const parts = ts.split(' ');
            const dateParts = parts[0].split('/');
            const timeParts = parts[1] ? parts[1].split(':') : ['00', '00', '00'];
            return Date.UTC(
                parseInt(dateParts[2]), parseInt(dateParts[1]) - 1, parseInt(dateParts[0]),
                parseInt(timeParts[0]), parseInt(timeParts[1]), parseInt(timeParts[2])
            ) / 1000 + IST_OFFSET_S;
        }
        // Fallback to standard Date parsing + IST offset
        return Math.floor(new Date(ts).getTime() / 1000) + IST_OFFSET_S;
    };

    useEffect(() => {
        loadAiModels();
        checkAuth();
        loadBreezeExpiries();
    }, []);

    const checkAuth = async () => {
        try {
            const status = await breezeApi.getStatus();
            setAuthStatus(status);
        } catch (e) { console.error("Auth check failed:", e); }
    };

    const handleLogin = async () => {
        try {
            const { url } = await breezeApi.getLoginUrl();
            window.open(url, '_blank');
        } catch (e: any) { alert(e.message); }
    };

    const loadBreezeExpiries = async () => {
        try {
            const data = await breezeApi.getExpiries();
            if (data.expiries && data.expiries.length > 0) {
                setAvailableExpiries(data.expiries);
                // Auto-select nearest expiry if none selected
                if (!selectedExpiry) {
                    setSelectedExpiry(data.expiries[0].expiry);
                }
            }
        } catch (e) {
            console.error('Failed to load expiries:', e);
        }
    };

    const handleConnect = async () => {
        if (!apiSession) return;
        setLoading(true);
        try {
            await breezeApi.exchangeSession(apiSession);
            await checkAuth();
            setApiSession('');
        } catch (e: any) { alert(e.message); }
        finally { setLoading(false); }
    };

    useEffect(() => {
        if (authStatus?.authenticated && selectedExpiry) {
            loadLiveNifty();
            loadDataForExpiry(selectedExpiry);
        }
        if (authStatus?.authenticated && !wsRef.current) {
            const ws = new BreezeWS(
                (tick) => {
                    setLiveTicks(prev => {
                        // Use composite key from backend (_key = "STRIKE_RIGHT" for options, symbol for index)
                        const tickKey = tick._key || tick.symbol || tick.stock_token || tick.stock_code;
                        const newTicks = {
                            ...prev,
                            [tickKey]: tick
                        };
                        
                        // Handle NIFTY Index updates
                        if ((tick.symbol === 'NIFTY' || tick.stock_code === 'NIFTY' || tick._key === 'NIFTY')) {
                            if (tick.last) {
                                setLiveSpot(tick.last);
                            }
                            
                            // OHLC Chart update: use candle ticks if available, otherwise raw ticks
                            if (tick.type === 'ohlcv') {
                                if (tick.interval === '1MIN') {
                                    updateLiveCandleFromOhlc(tick);
                                }
                            } else if (tick.last) {
                                updateLiveCandle(tick);
                            }
                        }
                        return newTicks;
                    });
                    setLastTick(tick);
                    setWsConnected(true);
                },
                (err) => {
                    console.error("Breeze WS Error:", err);
                    setWsError(err);
                    setWsConnected(false);
                },
                () => {
                    console.log("Breeze WS Connection Opened Successfully");
                    setWsConnected(true);
                }
            );
            console.log("Initiating Breeze WS Connection...");
            ws.connect();
            wsRef.current = ws;
            // Immediate NIFTY subscriptions: Ticks for spot price, OHLC for chart
            ws.subscribe(['NIFTY']);
            ws.subscribeOhlc(['NIFTY']);
        }
        return () => {
            if (wsRef.current) {
                wsRef.current.disconnect();
                wsRef.current = null;
            }
        };
    }, [authStatus?.authenticated]);

    const loadLiveNifty = async () => {
        if (!authStatus?.authenticated) return;
        try {
            const now = new Date();
            let latestTradingDate = new Date(now);
            
            // If it's Saturday (6) or Sunday (0), treat today as Friday
            if (latestTradingDate.getDay() === 6) {
                latestTradingDate.setDate(latestTradingDate.getDate() - 1);
            } else if (latestTradingDate.getDay() === 0) {
                latestTradingDate.setDate(latestTradingDate.getDate() - 2);
            }

            // Helper to get previous trading day
            const getPrevTradingDay = (date: Date) => {
                const prev = new Date(date);
                do {
                    prev.setDate(prev.getDate() - 1);
                } while (prev.getDay() === 0 || prev.getDay() === 6);
                return prev;
            };

            // Go back 2 trading days from the latest trading date
            const prevDay1 = getPrevTradingDay(latestTradingDate);
            const prevDay2 = getPrevTradingDay(prevDay1);

            // from_date is the open of that 2nd previous day
            const from_date = prevDay2.toISOString().split('T')[0] + 'T03:45:00.000Z';
            
            // to_date is now (subtract a minute to be safe with server time diff)
            const to_date = new Date(now.getTime() - 60000).toISOString();

            console.log("Fetching Live Nifty Historical:", { from_date, to_date });

            const res = await breezeApi.getHistorical({
                stock_code: 'NIFTY',
                exchange_code: 'NSE',
                product_type: 'cash',
                interval: '1minute',
                from_date,
                to_date
            });
            if (res.data) {
                setLiveIndexData(res.data);
            }
        } catch (e: any) {
            console.error("Failed to load live nifty:", e);
            if (e.message?.includes('401') || e.message?.toLowerCase().includes('session expired') || e.message?.toLowerCase().includes('login')) {
                setAuthStatus(prev => prev ? { ...prev, authenticated: false } : { authenticated: false });
                alert("Breeze session expired. Please re-login using the Breeze panel.");
            }
        }
    };

    const updateLiveCandleFromOhlc = (ohlc: any) => {
        if (!seriesRef.current) return;
        const tickTime = Math.floor(new Date(ohlc.datetime).getTime() / 1000);
        // Normalize to minute boundary (sdk might already do this but good to be safe)
        const candleTime = tickTime - (tickTime % 60);

        setLiveIndexData(prev => {
            const last = prev[prev.length - 1];
            const lastTime = last ? parseTimestamp(last.Date) : 0;

            const updatedCandle = {
                Date: new Date(candleTime * 1000).toISOString(),
                Open: ohlc.open,
                High: ohlc.high,
                Low: ohlc.low,
                Close: ohlc.close
            };

            // Update series directly
            seriesRef.current.update({
                time: candleTime as any,
                open: updatedCandle.Open,
                high: updatedCandle.High,
                low: updatedCandle.Low,
                close: updatedCandle.Close
            });

            if (candleTime === lastTime) {
                return [...prev.slice(0, -1), updatedCandle];
            } else if (candleTime > lastTime) {
                return [...prev, updatedCandle];
            }
            return prev;
        });
    };

    const updateLiveCandle = (tick: any) => {
        if (!seriesRef.current) return;
        // Don't update from tick if we're getting OHLC candles (optional but keeps it cleaner)
        // Actually OHLC candles come every 1 min, but ticks are real-time. 
        // We want the chart to move REAL-TIME, so we use BOTH.
        // updateLiveCandle handle the real-time movement of the CURRENT candle.
        // updateLiveCandleFromOhlc handles the FINALIZED data for previous/current candles.
        
        const tickTime = Math.floor(new Date(tick.datetime).getTime() / 1000);
        const candleTime = tickTime - (tickTime % 60);

        setLiveIndexData(prev => {
            const last = prev[prev.length - 1];
            const lastTime = last ? parseTimestamp(last.Date) : 0;

            if (candleTime === lastTime) {
                const updatedCandle = {
                    ...last,
                    High: Math.max(last.High || tick.last, tick.last),
                    Low: Math.min(last.Low || tick.last, tick.last),
                    Close: tick.last
                };
                
                seriesRef.current.update({
                    time: candleTime as any,
                    open: updatedCandle.Open || updatedCandle.Close,
                    high: updatedCandle.High,
                    low: updatedCandle.Low,
                    close: updatedCandle.Close
                });
                
                return [...prev.slice(0, -1), updatedCandle];
            } else if (candleTime > lastTime) {
                const newCandle = {
                    Date: new Date(candleTime * 1000).toISOString(),
                    Open: tick.last,
                    High: tick.last,
                    Low: tick.last,
                    Close: tick.last
                };
                
                seriesRef.current.update({
                    time: candleTime as any,
                    open: tick.last,
                    high: tick.last,
                    low: tick.last,
                    close: tick.last
                });
                
                return [...prev, newCandle];
            }
            return prev;
        });
    };

    const loadAiModels = async () => {
        try {
            const data = await aiApi.getModels();
            if (data.models && data.models.length > 0) {
                setAiModels(data.models);
                // Set default to 1.5 flash if available
                if (data.models.find((m: any) => m.name === 'gemini-1.5-flash')) {
                    setSelectedAiModel('gemini-1.5-flash');
                } else {
                    setSelectedAiModel(data.models[0].name);
                }
            }
        } catch (e) {
            console.error("Failed to load AI models:", e);
        }
    };

    // Expiry loading moved to loadBreezeExpiries since we use Breeze API now

    // Main loader for an expiry
    const loadDataForExpiry = async (expiry: string) => {
        if (!expiry) return;
        setSelectedExpiry(expiry);
        setLoading(true);
        try {
            // Fetch option chain meta from Breeze
            const quotes = await breezeApi.getOptionChainQuotes({
                stock_code: 'NIFTY',
                exchange_code: 'NFO',
                product_type: 'options',
                expiry_date: expiry
            });

            // Transform to app format (Breeze SDK Success array)
            const formattedChain: any[] = [];
            
            quotes.forEach((q: any) => {
                const strike = parseFloat(q.strike_price);
                
                // Add Call leg if present (SDK returns both in one object or separate? 
                // Based on guide it's one object with call_ltp and put_ltp)
                if (q.call_ltp !== undefined) {
                    formattedChain.push({
                        Strike: strike,
                        Right: 'CE',
                        Close: parseFloat(q.call_ltp || 0),
                        OI: parseInt(q.call_oi || 0),
                        Volume: parseInt(q.call_volume || 0),
                        token: q.call_token || q.stock_token, // Guide doesn't show separate tokens for CE/PE in chain, but SDK might
                        symbol: q.symbol
                    });
                }
                
                if (q.put_ltp !== undefined) {
                    formattedChain.push({
                        Strike: strike,
                        Right: 'PE',
                        Close: parseFloat(q.put_ltp || 0),
                        OI: parseInt(q.put_oi || 0),
                        Volume: parseInt(q.put_volume || 0),
                        token: q.put_token || q.stock_token,
                        symbol: q.symbol
                    });
                }
            });

            setOptionChain(formattedChain);

            // Subscribe to 20 ATM strikes (10 above, 10 below) via new subscribeOptions
            if (wsRef.current && authStatus?.authenticated && liveSpot) {
                const allStrikes = [...new Set(formattedChain.map((r: any) => r.Strike))].sort((a, b) => a - b);
                const atmIdx = allStrikes.reduce((best, s, i) => 
                    Math.abs(s - (liveSpot || 0)) < Math.abs(allStrikes[best] - (liveSpot || 0)) ? i : best, 0);
                const startIdx = Math.max(0, atmIdx - 10);
                const endIdx = Math.min(allStrikes.length, atmIdx + 10);
                const nearStrikes = allStrikes.slice(startIdx, endIdx);
                
                // Format expiry for Breeze SDK (DD-MMM-YYYY -> YYYY-MM-DD)
                const expiryParts = expiry.split('-');
                const months: Record<string, string> = { Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06', Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12' };
                const expiryIso = `${expiryParts[2]}-${months[expiryParts[1]] || '01'}-${expiryParts[0]}`;
                
                // For NIFTY option strikes, we subscribe to BOTH TBT (for highest speed LTP)
                // and 1SEC OHLCV (for reliable OI and Volume updates).
                const subs: any[] = [];
                nearStrikes.forEach(strike => {
                    subs.push({ stock_code: 'NIFTY', exchange_code: 'NFO', product_type: 'options', expiry_date: expiryIso, strike_price: String(strike), right: 'call' });
                    subs.push({ stock_code: 'NIFTY', exchange_code: 'NFO', product_type: 'options', expiry_date: expiryIso, strike_price: String(strike), right: 'put' });
                });
                
                console.log(`Subscribing to ${subs.length} strikes via TBT and OHLCV...`);
                wsRef.current.subscribeOptions(subs);
                
                // Trigger 1SEC OHLCV specifically for these strikes if not already covered by backend subscribeOptions
                // Note: Index is handled in the connection block.
            }

        } catch (e: any) {
            console.error("Failed to load live option chain from Breeze:", e);
            setOptionChain([]); // Must clear chain so we don't show old data
            
            if (e.message?.includes('401') || e.message?.toLowerCase().includes('session expired') || e.message?.toLowerCase().includes('login')) {
                setAuthStatus(prev => prev ? { ...prev, authenticated: false } : { authenticated: false });
                alert("Breeze session expired. Please re-login.");
            } else {
                alert("Failed to load live chain: " + (e.message || "Unknown error"));
            }
        } finally {
            setLoading(false);
        }
    };

    // Auto-refresh option chain every 30 seconds for live OI/Volume updates
    useEffect(() => {
        if (!authStatus?.authenticated || !selectedExpiry) return;
        
        // Don't setup interval if it's the weekend (market is closed)
        const day = new Date().getDay();
        if (day === 0 || day === 6) return;

        const interval = setInterval(() => {
            loadDataForExpiry(selectedExpiry);
        }, 30000);
        return () => clearInterval(interval);
    }, [authStatus?.authenticated, selectedExpiry]);

    const loadSpikes = async (expiry: string, threshold: number, volThreshold: number, minLtp: number) => {
        setSpikeLoading(true);
        try {
            const res = await dataApi.getOISpikes(expiry, threshold, volThreshold, minLtp, globalUseUnified);
            setOiSpikes(res.spikes || []);
            setSpikeStats(res.stats || null);
        } catch (e) {
            console.error('Error loading spikes:', e);
            setOiSpikes([]);
        }
        setSpikeLoading(false);
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

        let targetUnix = parseTimestamp(timestamps[currentIndex]) - (stepMinutes * 60);

        // Find closest timestamp before or exact
        let newIdx = currentIndex;
        for (let i = currentIndex - 1; i >= 0; i--) {
            if (parseTimestamp(timestamps[i]) <= targetUnix) {
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

        let targetUnix = parseTimestamp(timestamps[currentIndex]) + (stepMinutes * 60);

        // Find closest timestamp after or exact
        let newIdx = currentIndex;
        for (let i = currentIndex + 1; i < timestamps.length; i++) {
            if (parseTimestamp(timestamps[i]) >= targetUnix) {
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
    
    // Improved spot/future lookup (more robust than exact string match)
    const { stepperSpot, stepperFuture } = useMemo(() => {
        if (!currentTimestamp || (indexData.length === 0 && futuresData.length === 0)) {
            return { stepperSpot: undefined, stepperFuture: undefined };
        }
        
        const targetUnix = parseTimestamp(currentTimestamp);
        
        // Find exact or closest preceding data point
        const spotPt = indexData.find(d => parseTimestamp(d.Date) === targetUnix) || 
                      indexData.find(d => Math.abs(parseTimestamp(d.Date) - targetUnix) < 60);
        
        const futPt = futuresData.find(d => parseTimestamp(d.Date) === targetUnix) ||
                      futuresData.find(d => Math.abs(parseTimestamp(d.Date) - targetUnix) < 60);

        return {
            stepperSpot: spotPt?.Close,
            stepperFuture: futPt?.Close
        };
    }, [currentTimestamp, indexData, futuresData]);

    const filteredChain = useMemo(() => {
        return optionChain.filter((row: any) => {
            if (!showCE && row.Right === 'CE') return false;
            if (!showPE && row.Right === 'PE') return false;
            if (filter && !String(row.Strike).includes(filter)) return false;
            return true;
        });
    }, [optionChain, showCE, showPE, filter]);

    const strikes = [...new Set(filteredChain.map((r: any) => r.Strike))].sort((a, b) => a - b);

    // Auto Playback Effect
    useEffect(() => {
        let interval: any;
        if (isPlaying && currentIndex < timestamps.length - 1) {
            interval = setInterval(() => {
                handleStepForward();
            }, 1000); // 1.0 second per step
        } else if (currentIndex >= timestamps.length - 1) {
            setIsPlaying(false);
        }
        return () => clearInterval(interval);
    }, [isPlaying, currentIndex, timestamps, stepMinutes]);

    // Top OI Strikes Calculation (Separated for Call and Put) - Always use the FULL option chain
    const { topCallOiStrikes, topPutOiStrikes } = useMemo(() => {
        if (!currentTimestamp || optionChain.length === 0) return { topCallOiStrikes: [], topPutOiStrikes: [] };

        const ceStrikes = optionChain.filter((r: any) => r.Right === 'CE').sort((a, b) => (b.OI || 0) - (a.OI || 0));
        const peStrikes = optionChain.filter((r: any) => r.Right === 'PE').sort((a, b) => (b.OI || 0) - (a.OI || 0));

        return {
            topCallOiStrikes: ceStrikes.slice(0, 3).map(r => r.Strike),
            topPutOiStrikes: peStrikes.slice(0, 3).map(r => r.Strike)
        };
    }, [optionChain, currentTimestamp]);

    // Strategy Advisor Logic
    const advisorSignal = useMemo(() => {
        const spot = liveSpot || stepperSpot;
        if (!spot || topCallOiStrikes.length === 0 || topPutOiStrikes.length === 0) return null;

        const R1 = topCallOiStrikes[0];
        const S1 = topPutOiStrikes[0];
        // const spot = currentSpot; // Removed duplicate declaration

        // Threshold for "Inside Zone" (e.g., 0.2% of spot)
        const zoneThreshold = spot * 0.002;

        if (spot > R1 + zoneThreshold) {
            return {
                stance: 'Strong Bullish',
                strategy: 'Bull Call Spread / Naked Long',
                reason: `Spot has broken above major Resistance (R1: ${R1}). Momentum likely to continue.`,
                color: 'var(--green)'
            };
        } else if (spot < S1 - zoneThreshold) {
            return {
                stance: 'Strong Bearish',
                strategy: 'Bear Put Spread / Naked Short',
                reason: `Spot has broken below major Support (S1: ${S1}). Bearish trap confirmed.`,
                color: 'var(--red)'
            };
        } else if (Math.abs(spot - S1) <= zoneThreshold) {
            return {
                stance: 'Buying at Support',
                strategy: 'Bull Put Spread / PCS',
                reason: `Spot is at major Support (S1: ${S1}). High probability of reversal or bounce.`,
                color: 'var(--cyan)'
            };
        } else if (Math.abs(spot - R1) <= zoneThreshold) {
            return {
                stance: 'Selling at Resistance',
                strategy: 'Bear Call Spread / CCS',
                reason: `Spot is at major Resistance (R1: ${R1}). Selling pressure expected here.`,
                color: 'var(--orange)'
            };
        } else {
            return {
                stance: 'Rangebound',
                strategy: 'Iron Condor / Strangle',
                reason: `Spot is trading between S1 (${S1}) and R1 (${R1}). Low volatility play.`,
                color: 'var(--blue)'
            };
        }
    }, [liveSpot, stepperSpot, topCallOiStrikes, topPutOiStrikes]);
 
    // Max Pain Calculation Logic
    const maxPain = useMemo(() => {
        if (!optionChain || optionChain.length === 0) return null;

        const uniqueStrikes = [...new Set(optionChain.map((r: any) => r.Strike))].sort((a, b) => a - b);
        let minPain = Infinity;
        let maxPainStrike = uniqueStrikes[0];

        uniqueStrikes.forEach(targetStrike => {
            let totalPain = 0;
            optionChain.forEach((r: any) => {
                const strike = r.Strike;
                const oi = r.OI || 0;
                if (r.Right === 'CE') {
                    // Call pain: Intrinsic value if spot > strike
                    if (targetStrike > strike) {
                        totalPain += (targetStrike - strike) * oi;
                    }
                } else {
                    // Put pain: Intrinsic value if spot < strike
                    if (targetStrike < strike) {
                        totalPain += (strike - targetStrike) * oi;
                    }
                }
            });

            if (totalPain < minPain) {
                minPain = totalPain;
                maxPainStrike = targetStrike;
            }
        });

    return maxPainStrike;
    }, [optionChain]);

    const oiCommentary = useMemo(() => {
        const spot = liveSpot || stepperSpot;
        if (!optionChain || optionChain.length === 0 || !spot || topCallOiStrikes.length === 0 || topPutOiStrikes.length === 0) return null;

        const totalCallOi = optionChain.filter((r: any) => r.Right === 'CE').reduce((acc: number, r: any) => acc + (r.OI || 0), 0);
        const totalPutOi = optionChain.filter((r: any) => r.Right === 'PE').reduce((acc: number, r: any) => acc + (r.OI || 0), 0);
        const pcr = totalCallOi > 0 ? totalPutOi / totalCallOi : 0;

        const callR1 = topCallOiStrikes[0];
        const putS1 = topPutOiStrikes[0];
        // const spot = currentSpot; // already defined above
        const mp = maxPain;

        let sentiment = 'Neutral';
        let color = 'var(--text-muted)';
        let message = '';
        let action = 'WAIT'; // Action ID for automation

        const pcrSentiment = pcr > 1.2 ? 'Bearish' : pcr < 0.7 ? 'Bullish' : 'Neutral';
        const mpPull = mp ? (mp > spot ? 'UP' : 'DOWN') : null;
        const mpDist = mp ? Math.abs(mp - spot) : 99999;
        const strongPull = mpDist > (spot * 0.005);

        if (spot > callR1) {
            sentiment = 'Bullish Breakout';
            color = 'var(--green)';
            message = `Cleared R1 (${callR1}). PCR ${pcr.toFixed(2)} (${pcrSentiment}).`;
            action = 'BULL_BREAKOUT';
        } else if (spot < putS1) {
            sentiment = 'Bearish Breakdown';
            color = 'var(--red)';
            message = `Below S1 (${putS1}). PCR ${pcr.toFixed(2)} (${pcrSentiment}).`;
            action = 'BEAR_BREAKDOWN';
        } else if (pcr > 1.3) {
            sentiment = 'Bearish Bias';
            color = 'var(--orange)';
            message = `High PCR ${pcr.toFixed(2)}: heavy resistance at ${callR1}.`;
            action = 'BEAR_BIAS';
        } else if (pcr < 0.6) {
            sentiment = 'Bullish Bias';
            color = 'var(--cyan)';
            message = `Low PCR ${pcr.toFixed(2)}: strong support at ${putS1}.`;
            action = 'BULL_BIAS';
        } else {
            sentiment = 'Consolidating';
            color = 'var(--blue)';
            message = `Neutral zone. PCR ${pcr.toFixed(2)} balanced.`;
            action = 'NEUTRAL';
        }

        if (strongPull && mp) message += ` MP ${mp} pull: ${mpPull}.`;

        return { sentiment, message, color, pcr, action };
    }, [optionChain, liveSpot, stepperSpot, topCallOiStrikes, topPutOiStrikes, maxPain]);


    // Candlestick Chart Initialization
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const handleResize = () => {
            if (chartContainerRef.current && chartRef.current) {
                chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };

        if (!chartRef.current) {
            console.log("Initializing Lightweight Chart in container:", chartContainerRef.current);
            const chart = createChart(chartContainerRef.current, {
                width: chartContainerRef.current.clientWidth,
                height: 350,
                layout: {
                    background: { type: ColorType.Solid, color: 'transparent' },
                    textColor: '#d1d5db',
                },
                grid: {
                    vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
                    horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
                },
                crosshair: { mode: CrosshairMode.Normal },
                timeScale: { timeVisible: true, secondsVisible: false }
            });

            const candlestickSeries = chart.addSeries(CandlestickSeries, {
                upColor: '#26a69a',
                downColor: '#ef5350',
                borderVisible: false,
                wickUpColor: '#26a69a',
                wickDownColor: '#ef5350',
            });

            chartRef.current = chart;
            seriesRef.current = candlestickSeries;

            window.addEventListener('resize', handleResize);
        }

        return () => {
            if (chartRef.current) {
                window.removeEventListener('resize', handleResize);
                chartRef.current.remove();
                chartRef.current = null;
                seriesRef.current = null;
            }
        };
    }, [indexData, liveIndexData]);

    // Effect to update chart data based on current index selection OR live data
    useEffect(() => {
        if (!seriesRef.current) return;

        const dataToUse = liveIndexData.length > 0 ? liveIndexData : indexData;
        if (dataToUse.length === 0) return;

        // If we have live data, just set it all. If we have currentTimestamp (historical), filter.
        let formattedData = dataToUse
            .map(d => {
                const ts = parseTimestamp(d.Date);
                return {
                    time: ts as any,
                    open: d.Open || d.Close,
                    high: d.High || d.Close,
                    low: d.Low || d.Close,
                    close: d.Close
                };
            })
            .sort((a, b) => a.time - b.time);

        if (liveIndexData.length === 0 && currentTimestamp) {
            const currentUnix = parseTimestamp(currentTimestamp);
            formattedData = formattedData.filter(d => d.time <= currentUnix);
        }

        seriesRef.current.setData(formattedData);
    }, [indexData, liveIndexData, currentTimestamp]);

    // Update Top OI Lines and Crosshair when current timestamp changes
    useEffect(() => {
        if (!seriesRef.current || !chartRef.current || indexData.length === 0 || !currentTimestamp) return;

        // Clear existing lines
        priceLinesRef.current.forEach(line => seriesRef.current.removePriceLine(line));
        priceLinesRef.current = [];

        // Add Top Call OI Resistance Lines (Green)
        topCallOiStrikes.forEach((strike, idx) => {
            const isMax = idx === 0;
            const line = seriesRef.current.createPriceLine({
                price: strike,
                color: 'rgba(16, 185, 129, 0.7)', // Green
                lineWidth: isMax ? 4 : 2,
                lineStyle: 1, // Solid
                axisLabelVisible: true,
                title: `Call OI R${idx + 1}${isMax ? ' [MAX]' : ''}`,
            });
            priceLinesRef.current.push(line);
        });

        // Add Top Put OI Support Lines (Red)
        topPutOiStrikes.forEach((strike, idx) => {
            const isMax = idx === 0;
            const line = seriesRef.current.createPriceLine({
                price: strike,
                color: 'rgba(239, 68, 68, 0.7)', // Red
                lineWidth: isMax ? 4 : 2,
                lineStyle: 2, // Dashed
                axisLabelVisible: true,
                title: `Put OI S${idx + 1}${isMax ? ' [MAX]' : ''}`,
            });
            priceLinesRef.current.push(line);
        });

        // Set Crosshair to current timestamp
        // Parse "DD/MM/YYYY HH:MM:SS"
        const parts = currentTimestamp.split(' ');
        if (parts.length >= 2) {
            // Move crosshair programmatically is tricky in LW Charts,
            // so we'll just ensure the current candle is visible.
            chartRef.current.timeScale().scrollToPosition(0, true);
        }

    }, [currentIndex, topCallOiStrikes, topPutOiStrikes, currentTimestamp, indexData]);

    // Calculate closest strikes for highlighting
    const getClosestStrike = (val: number | undefined) => {
        if (!val || strikes.length === 0) return null;
        return strikes.reduce((prev, curr) => Math.abs(curr - val) < Math.abs(prev - val) ? curr : prev);
    };

    const closestSpotStrike = getClosestStrike(liveSpot || stepperSpot);
    const closestFutureStrike = getClosestStrike(stepperFuture);

    // Helper to find strike at offset
    const getStrikeAtOffset = (startStrike: number, offset: number) => {
        if (strikes.length === 0) return startStrike;
        const currentIdx = strikes.indexOf(startStrike);
        if (currentIdx === -1) {
            // Find closest index
            const closest = strikes.reduce((prev, curr) => Math.abs(curr - startStrike) < Math.abs(prev - startStrike) ? curr : prev);
            const closestIdx = strikes.indexOf(closest);
            const targetIdx = Math.max(0, Math.min(strikes.length - 1, closestIdx + offset));
            return strikes[targetIdx];
        }
        const targetIdx = Math.max(0, Math.min(strikes.length - 1, currentIdx + offset));
        return strikes[targetIdx];
    };

    const recommendedStrategy = useMemo(() => {
        const spot = liveSpot || stepperSpot;
        if (!oiCommentary || !spot || strikes.length === 0) return null;
        
        const atm = closestSpotStrike || strikes[Math.floor(strikes.length/2)];
        const legs: any[] = [];
        let name = "";

        switch (oiCommentary.action) {
            case 'BULL_BREAKOUT':
                name = "Bull Call Spread (Aggressive)";
                legs.push({ type: 'CE', strike: atm, action: 'BUY' });
                legs.push({ type: 'CE', strike: getStrikeAtOffset(atm, 2), action: 'SELL' });
                break;
            case 'BULL_BIAS':
                name = "Bull Put Spread (Credit)";
                legs.push({ type: 'PE', strike: getStrikeAtOffset(atm, -1), action: 'SELL' });
                legs.push({ type: 'PE', strike: getStrikeAtOffset(atm, -3), action: 'BUY' });
                break;
            case 'BEAR_BREAKDOWN':
                name = "Bear Put Spread (Aggressive)";
                legs.push({ type: 'PE', strike: atm, action: 'BUY' });
                legs.push({ type: 'PE', strike: getStrikeAtOffset(atm, -2), action: 'SELL' });
                break;
            case 'BEAR_BIAS':
                name = "Bear Call Spread (Credit)";
                legs.push({ type: 'CE', strike: getStrikeAtOffset(atm, 1), action: 'SELL' });
                legs.push({ type: 'CE', strike: getStrikeAtOffset(atm, 3), action: 'BUY' });
                break;
            case 'NEUTRAL':
                name = "Iron Condor (Neutral)";
                legs.push({ type: 'PE', strike: getStrikeAtOffset(atm, -4), action: 'BUY' });
                legs.push({ type: 'PE', strike: getStrikeAtOffset(atm, -2), action: 'SELL' });
                legs.push({ type: 'CE', strike: getStrikeAtOffset(atm, 2), action: 'SELL' });
                legs.push({ type: 'CE', strike: getStrikeAtOffset(atm, 4), action: 'BUY' });
                break;
            default:
                return null;
        }

        const hydratedLegs = legs.map(leg => {
            const data = optionChain.find((r: any) => r.Strike === leg.strike && r.Right === leg.type);
            return { ...leg, entryPrice: data?.Close || 0, currentPrice: data?.Close || 0 };
        });

        return { name, legs: hydratedLegs, timestamp: currentTimestamp, action: oiCommentary.action };
    }, [oiCommentary, liveSpot, stepperSpot, optionChain, strikes, closestSpotStrike, currentTimestamp]);

    // Automated Trade Lifecycle Management
    const lastActionRef = useRef<string | null>(null);

    useEffect(() => {
        if (!oiCommentary || !recommendedStrategy) return;

        // Check for action change
        if (oiCommentary.action !== lastActionRef.current) {
            
            // 1. Close current trade if exists
            if (trackedStrategy) {
                const finalPnl = activeStrategyMetrics?.totalPnl || 0;
                setTradeHistory(prev => [{
                    ...trackedStrategy,
                    exitTimestamp: currentTimestamp,
                    exitSpot: liveSpot || stepperSpot,
                    finalPnl
                }, ...prev]);
            }

            // 2. Open new trade
            setTrackedStrategy(recommendedStrategy);
            lastActionRef.current = oiCommentary.action;
        }
    }, [oiCommentary?.action, currentTimestamp]);

    const activeStrategyMetrics = useMemo(() => {
        if (!trackedStrategy || optionChain.length === 0) return null;

        const lotSize = 50;
        let totalPnl = 0;
        const updatedLegs = trackedStrategy.legs.map((leg: any) => {
            const currentData = optionChain.find((r: any) => r.Strike === leg.strike && r.Right === leg.type);
            const currentPrice = currentData?.Close || 0;
            const pnl = leg.action === 'BUY' ? (currentPrice - leg.entryPrice) : (leg.entryPrice - currentPrice);
            totalPnl += pnl * lotSize;
            return { ...leg, currentPrice, pnl: pnl * lotSize };
        });

        // Simplified Max Profit/Loss for Spreads
        // This is a rough estimation for UI purposes
        let maxProfit: any = "Calculating...";
        let maxLoss: any = "Calculating...";
        
        if (trackedStrategy.name.includes("Spread")) {
            const buyLeg = trackedStrategy.legs.find((l: any) => l.action === 'BUY');
            const sellLeg = trackedStrategy.legs.find((l: any) => l.action === 'SELL');
            if (buyLeg && sellLeg) {
                const width = Math.abs(buyLeg.strike - sellLeg.strike);
                const netCreditDebit = trackedStrategy.legs.reduce((acc: number, l: any) => acc + (l.action === 'BUY' ? -l.entryPrice : l.entryPrice), 0);
                
                if (netCreditDebit < 0) { // Net Debit (e.g. Bull Call Spread)
                    maxProfit = (width + netCreditDebit) * lotSize;
                    maxLoss = netCreditDebit * lotSize;
                } else { // Net Credit (e.g. Bull Put Spread)
                    maxProfit = netCreditDebit * lotSize;
                    maxLoss = (width - netCreditDebit) * lotSize;
                }
            }
        }

        return {
            ...trackedStrategy,
            legs: updatedLegs,
            totalPnl,
            maxProfit: typeof maxProfit === 'number' ? maxProfit.toFixed(2) : maxProfit,
            maxLoss: typeof maxLoss === 'number' ? Math.abs(maxLoss).toFixed(2) : maxLoss
        };
    }, [trackedStrategy, optionChain]);

    const handleGenerateAIInsights = async () => {
        if (!selectedExpiry) return;
        setAiLoading(true);
        setAiError(null);
        try {
            // Pick a subset of option chain to save bandwidth/tokens
            const atmStrike = closestSpotStrike || strikes[Math.floor(strikes.length / 2)];
            const indexAtm = strikes.indexOf(atmStrike);
            const startIdx = Math.max(0, indexAtm - 20);
            const endIdx = Math.min(strikes.length - 1, indexAtm + 20);
            const relevantStrikes = strikes.slice(startIdx, endIdx);

            const subsetChain = optionChain.filter((r: any) => relevantStrikes.includes(r.Strike));

            const payload = {
                expiry: selectedExpiry,
                spot_price: (liveSpot || stepperSpot) || 0,
                futures_price: stepperFuture || 0,
                option_chain: subsetChain,
                spikes: oiSpikes.slice(0, 50),
                timestamp: currentTimestamp,
                model_name: selectedAiModel
            };

            const res = await aiApi.analyzeChain(payload);
            setAiResult(res.analysis);
            setAiAnalysisTimestamp(currentTimestamp);
            setIsAiCollapsed(false);
        } catch (e: any) {
            console.error("AI Error:", e);
            setAiError(e.message || "Failed to generate AI insights.");
        } finally {
            setAiLoading(false);
        }
    };

    // Prepare OI Data for the chart
    const oiData = useMemo(() => {
        return strikes.map(strike => {
            const ce = optionChain.find((r: any) => r.Strike === strike && r.Right === 'CE') || {} as any;
            const pe = optionChain.find((r: any) => r.Strike === strike && r.Right === 'PE') || {} as any;
            const ceTick = liveTicks[`${strike}_CE`] || {};
            const peTick = liveTicks[`${strike}_PE`] || {};
            return {
                strike,
                ce_oi: ceTick.oi || ce.OI || 0,
                pe_oi: peTick.oi || pe.OI || 0
            };
        });
    }, [strikes, optionChain, liveTicks]);

    return (
        <div className="fade-in">
            {/* Breeze Authentication Panel */}
            <div className="card" style={{ marginBottom: 16, border: authStatus?.authenticated ? '1px solid var(--green)' : '1px solid var(--orange)' }}>
                <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap', padding: '12px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                            width: 12, height: 12, borderRadius: '50%',
                            background: authStatus?.authenticated ? 'var(--green)' : 'var(--red)',
                            boxShadow: authStatus?.authenticated ? '0 0 8px var(--green)' : 'none'
                        }} />
                        <span style={{ fontWeight: 700, fontSize: 14 }}>
                            Breeze: {authStatus?.authenticated ? 'Connected' : 'Disconnected'}
                        </span>
                    </div>

                    {!authStatus?.authenticated ? (
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flex: 1 }}>
                            <button className="btn btn-primary" onClick={handleLogin} style={{ padding: '6px 16px', fontSize: 13 }}>
                                1. Generate Login URL
                            </button>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                                <input
                                    className="form-input"
                                    placeholder="2. Paste Session Token here..."
                                    value={apiSession}
                                    onChange={e => setApiSession(e.target.value)}
                                    style={{ flex: 1, height: 36 }}
                                />
                                <button className="btn btn-success" onClick={handleConnect} disabled={!apiSession || loading} style={{ padding: '6px 16px', fontSize: 13 }}>
                                    {loading ? 'Connecting...' : 'Connect'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: 24, alignItems: 'center', fontSize: 13 }}>
                            <span>User: <strong style={{ color: 'var(--accent-primary)' }}>{authStatus.user_id}</strong></span>
                            <span style={{ color: 'var(--text-muted)' }}>Session updated: {new Date(authStatus.updated_at || '').toLocaleTimeString()}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: wsConnected ? 'var(--green)' : 'var(--red)' }} />
                                <span>WebSocket: {wsConnected ? 'Live' : 'Stopped'}</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Live Spot Board & Controls */}
            <div className="card" style={{ marginBottom: 16, padding: '12px 20px', background: 'var(--bg-secondary)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
                    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
                        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', background: 'rgba(59, 130, 246, 0.05)', padding: '6px 16px', borderRadius: 8, border: '1px solid rgba(59, 130, 246, 0.1)' }}>
                            <div style={{ textAlign: 'left' }}>
                                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>Option Expiry</div>
                                {availableExpiries.length > 0 ? (
                                    <select
                                        className="form-select"
                                        value={selectedExpiry}
                                        onChange={e => { setSelectedExpiry(e.target.value); loadDataForExpiry(e.target.value); }}
                                        style={{ height: 32, fontSize: 13, fontWeight: 700, color: 'var(--blue)', background: 'transparent', border: 'none', padding: '0 4px' }}
                                    >
                                        {availableExpiries.map((exp: any) => (
                                            <option key={exp.expiry} value={exp.expiry}>
                                                {exp.expiry} {exp.is_monthly ? '(Monthly)' : ''} — {exp.days_to_expiry}d
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--blue)' }}>{selectedExpiry || 'Loading...'}</div>
                                )}
                            </div>
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label">Strike Filter</label>
                            <input className="form-input" placeholder="Filter..."
                                value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 120, height: 38 }} />
                        </div>
                        <div style={{ display: 'flex', gap: 12, height: 38, alignItems: 'center', padding: '0 12px', background: 'var(--bg-input)', borderRadius: 6 }}>
                             <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                                <input type="checkbox" checked={showCE} onChange={e => setShowCE(e.target.checked)} /> CE
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                                <input type="checkbox" checked={showPE} onChange={e => setShowPE(e.target.checked)} /> PE
                            </label>
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>NIFTY 50 SPOT</div>
                            <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' }}>
                                {liveSpot || stepperSpot || '---'}
                                <span style={{ fontSize: 12, marginLeft: 8, color: (liveTicks['NIFTY']?.change || 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                    {(liveTicks['NIFTY']?.change_pc || 0).toFixed(2)}%
                                </span>
                            </div>
                        </div>
                        <div style={{ width: '1px', height: '40px', background: 'var(--border-color)' }}></div>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>LAST SYNC (BREEZE)</div>
                            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--accent-primary)' }}>
                                {lastTick?.datetime ? new Date(lastTick.datetime).toLocaleTimeString() : 'Waiting for ticks...'}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

                <div className="grid-2" style={{ marginBottom: 16 }}>
                    {/* Nifty Index Chart with Top OI */}
                    <div className="card fade-in" style={{ margin: 0 }}>
                        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div className="card-title" onClick={() => setIsChartCollapsed(!isChartCollapsed)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span>{isChartCollapsed ? '▶' : '▼'}</span>
                                Nifty Index & Top OI Levels
                            </div>
                            <button
                                className={`btn ${isPlaying ? 'btn-danger' : 'btn-primary'}`}
                                onClick={() => setIsPlaying(!isPlaying)}
                                disabled={loading || stepping || indexData.length === 0}
                                style={{
                                    padding: '4px 12px',
                                    background: isPlaying ? 'rgba(239, 68, 68, 0.2)' : 'var(--bg-input)',
                                    color: isPlaying ? 'var(--red)' : 'var(--text-color)',
                                    border: `1px solid ${isPlaying ? 'var(--red)' : 'var(--border-color)'}`
                                }}
                            >
                                {isPlaying ? '⏸' : '▶'}
                            </button>
                        </div>
                        {!isChartCollapsed && (
                            <div style={{ padding: 16, borderTop: '1px solid var(--border-color)', position: 'relative' }}>
                                <div ref={chartContainerRef} style={{ width: '100%', height: 350, position: 'relative' }}>
                                    {(indexData.length === 0 && liveIndexData.length === 0) && (
                                        <div style={{ 
                                            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, 
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', 
                                            color: 'var(--text-muted)', background: 'rgba(0,0,0,0.1)',
                                            zIndex: 10, borderRadius: 8
                                        }}>
                                            {authStatus?.authenticated ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                                                    <div className="spinner-small" />
                                                    <span>Initializing Live Nifty Chart...</span>
                                                </div>
                                            ) : 'Select Expiry to Load Data...'}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* OI Buildup Chart */}
                    <div className="card fade-in" style={{ margin: 0 }}>
                        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div className="card-title" onClick={() => setIsOiBuildupCollapsed(!isOiBuildupCollapsed)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span>{isOiBuildupCollapsed ? '▶' : '▼'}</span>
                                OI Buildup (Open Interest)
                                {maxPain && (
                                    <span style={{ 
                                        marginLeft: 12, 
                                        fontSize: 12, 
                                        padding: '2px 8px', 
                                        borderRadius: '4px', 
                                        background: 'rgba(234, 179, 8, 0.1)', 
                                        color: 'var(--yellow)',
                                        border: '1px solid rgba(234, 179, 8, 0.2)',
                                        fontWeight: 700
                                    }}>
                                        Max Pain: {maxPain}
                                    </span>
                                )}
                                {oiCommentary && (
                                    <div style={{
                                        marginLeft: 16,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        fontSize: 12,
                                        background: 'rgba(255, 255, 255, 0.05)',
                                        padding: '2px 12px',
                                        borderRadius: '6px',
                                        border: `1px solid ${oiCommentary.color}44`,
                                        color: '#ffffff'
                                    }}>
                                        <span style={{ color: oiCommentary.color, fontWeight: 900, textTransform: 'uppercase', fontSize: 10 }}>{oiCommentary.sentiment}:</span>
                                        <span style={{ fontWeight: 600 }}>{oiCommentary.message}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        {!isOiBuildupCollapsed && (
                            <div style={{ height: 350, width: '100%', padding: '10px 0' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={oiData} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                                        <XAxis
                                            dataKey="strike"
                                            stroke="var(--text-muted)"
                                            fontSize={10}
                                            tickLine={false}
                                            axisLine={false}
                                            dy={10}
                                        />
                                        <YAxis
                                            stroke="var(--text-muted)"
                                            fontSize={10}
                                            tickLine={false}
                                            axisLine={false}
                                            tickFormatter={(val) => val >= 1000000 ? `${(val / 1000000).toFixed(1)}M` : val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
                                        />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', borderRadius: '8px', color: 'var(--text-body)' }}
                                            itemStyle={{ fontSize: '11px' }}
                                            formatter={(val: any) => val.toLocaleString()}
                                        />
                                        <Legend wrapperStyle={{ paddingTop: '10px', fontSize: '11px' }} />
                                        {maxPain && (
                                            <ReferenceLine 
                                                x={maxPain} 
                                                stroke="var(--yellow)" 
                                                strokeDasharray="3 3" 
                                                label={{ position: 'top', value: 'Max Pain', fill: 'var(--yellow)', fontSize: 10, fontWeight: 700 }} 
                                            />
                                        )}
                                        <Bar dataKey="ce_oi" name="Call OI" fill="var(--green)" radius={[4, 4, 0, 0]} opacity={0.8} />
                                        <Bar dataKey="pe_oi" name="Put OI" fill="var(--red)" radius={[4, 4, 0, 0]} opacity={0.8} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </div>
                </div>

                {/* Recommended Strategy Section */}
                {selectedExpiry && recommendedStrategy && !trackedStrategy && (
                    <div className="card fade-in" style={{ marginBottom: 16, border: '1px solid var(--accent-primary)' }}>
                        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: 'var(--accent-primary)' }}>💡</span>
                                Advisor Recommendation: {recommendedStrategy.name}
                            </div>
                            <button 
                                className="btn btn-primary"
                                onClick={() => setTrackedStrategy(recommendedStrategy)}
                                style={{ padding: '6px 16px', fontSize: 13 }}
                            >
                                Track This Strategy
                            </button>
                        </div>
                        <div className="table-container" style={{ padding: '0 10px 10px' }}>
                            <table className="option-chain-table" style={{ border: 'none' }}>
                                <thead>
                                    <tr>
                                        <th>Action</th>
                                        <th>Type</th>
                                        <th>Strike</th>
                                        <th style={{ textAlign: 'right' }}>LTP at {recommendedStrategy.timestamp.split(' ')[1]}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {recommendedStrategy.legs.map((leg: any, idx: number) => (
                                        <tr key={idx} style={{ background: 'rgba(255,255,255,0.02)' }}>
                                            <td style={{ fontWeight: 700, color: leg.action === 'BUY' ? 'var(--blue)' : 'var(--orange)' }}>{leg.action}</td>
                                            <td>
                                                <span className={`badge ${leg.type === 'CE' ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: 10 }}>
                                                    {leg.type}
                                                </span>
                                            </td>
                                            <td style={{ fontWeight: 700 }}>{leg.strike}</td>
                                            <td style={{ textAlign: 'right' }}>{leg.entryPrice.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Active Strategy Tracker */}
                {selectedExpiry && activeStrategyMetrics && (
                    <div className="card fade-in" style={{ 
                        marginBottom: 16, 
                        border: '1px solid var(--green)',
                        boxShadow: '0 0 15px rgba(16, 185, 129, 0.1)'
                    }}>
                        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: 'var(--green)' }}>📈</span>
                                Live Strategy Tracker: {activeStrategyMetrics.name}
                            </div>
                            <div style={{ display: 'flex', gap: 12 }}>
                                <div className="badge" style={{ background: 'rgba(16, 185, 129, 0.2)', color: 'var(--green)', fontSize: 13, padding: '4px 12px' }}>
                                    Total P&L: ₹{activeStrategyMetrics.totalPnl.toFixed(2)}
                                </div>
                                <button 
                                    className="btn btn-danger"
                                    onClick={() => setTrackedStrategy(null)}
                                    style={{ padding: '4px 12px', fontSize: 12 }}
                                >
                                    Close Tracker
                                </button>
                            </div>
                        </div>
                        <div className="table-container" style={{ padding: '0 10px 10px' }}>
                            <table className="option-chain-table" style={{ border: 'none' }}>
                                <thead>
                                    <tr>
                                        <th>Leg</th>
                                        <th>Strike</th>
                                        <th style={{ textAlign: 'right' }}>Entry LTP</th>
                                        <th style={{ textAlign: 'right' }}>Current LTP</th>
                                        <th style={{ textAlign: 'right' }}>Leg P&L</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {activeStrategyMetrics.legs.map((leg: any, idx: number) => (
                                        <tr key={idx} style={{ background: 'rgba(255,255,255,0.02)' }}>
                                            <td>
                                                <span style={{ fontWeight: 700, marginRight: 8, color: leg.action === 'BUY' ? 'var(--blue)' : 'var(--orange)' }}>{leg.action}</span>
                                                <span className={`badge ${leg.type === 'CE' ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: 10 }}>{leg.type}</span>
                                            </td>
                                            <td style={{ fontWeight: 700 }}>{leg.strike}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{leg.entryPrice.toFixed(2)}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{leg.currentPrice.toFixed(2)}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 700, color: leg.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                                {leg.pnl >= 0 ? '+' : ''}{leg.pnl.toFixed(2)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr style={{ background: 'rgba(255,255,255,0.05)', borderTop: '1px solid var(--border-color)' }}>
                                        <td colSpan={3} style={{ textAlign: 'left', fontSize: 11, color: 'var(--text-muted)' }}>
                                            Strategy Entry: {activeStrategyMetrics.timestamp}
                                        </td>
                                        <td style={{ textAlign: 'right', fontWeight: 700 }}>Total Max Risk/Reward:</td>
                                        <td style={{ textAlign: 'right' }}>
                                            <span style={{ color: 'var(--green)' }}>P: ₹{activeStrategyMetrics.maxProfit}</span>
                                            <span style={{ margin: '0 8px', opacity: 0.3 }}>|</span>
                                            <span style={{ color: 'var(--red)' }}>L: ₹{activeStrategyMetrics.maxLoss}</span>
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                )}

            {/* AI Insights Card */}
            {selectedExpiry && timestamps.length > 0 && (
                <div className="card fade-in" style={{ marginBottom: 16 }}>
                    <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div className="card-title" onClick={() => setIsAiCollapsed(!isAiCollapsed)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span>{isAiCollapsed ? '▶' : '▼'}</span>
                            <span style={{
                                background: 'linear-gradient(90deg, #A855F7, #3B82F6)',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                fontWeight: 700
                            }}>
                                Gemini AI Insights ✨
                            </span>
                        </div>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                            {aiModels.length > 0 && (
                                <select
                                    className="form-select"
                                    value={selectedAiModel}
                                    onChange={(e) => setSelectedAiModel(e.target.value)}
                                    style={{ width: 180, height: 32, fontSize: 12, padding: '0 8px', margin: 0 }}
                                >
                                    {aiModels.map(m => (
                                        <option key={m.name} value={m.name}>{m.display_name}</option>
                                    ))}
                                </select>
                            )}
                            <button
                                className="btn btn-primary"
                                onClick={handleGenerateAIInsights}
                                disabled={aiLoading || loading}
                                style={{
                                    background: 'linear-gradient(90deg, #9333ea, #3b82f6)',
                                    border: 'none',
                                    padding: '6px 16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8
                                }}
                            >
                                {aiLoading ? <div className="spinner-small" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} /> : '✨'}
                                {aiLoading ? 'Analyzing...' : 'Ask Gemini'}
                            </button>
                        </div>
                    </div>

                    {!isAiCollapsed && (aiResult || aiError || aiLoading) && (
                        <div style={{ padding: '20px', background: 'var(--bg-body)', borderTop: '1px solid var(--border-color)', fontSize: 14, lineHeight: 1.6 }}>
                            {aiAnalysisTimestamp && !aiLoading && (
                                <div style={{ marginBottom: 16, fontSize: 12, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', paddingBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Analysis for: <strong>{aiAnalysisTimestamp}</strong></span>
                                    <span>Model: <strong>{selectedAiModel}</strong></span>
                                </div>
                            )}
                            {aiError && <div style={{ color: 'var(--red)', padding: 12, background: 'rgba(239,68,68,0.1)', borderRadius: 6 }}>{aiError}</div>}
                            {aiLoading && !aiResult && (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 40, color: 'var(--text-muted)' }}>
                                    <div className="spinner" style={{ marginBottom: 16, borderColor: 'var(--border-color)', borderTopColor: 'var(--purple)' }} />
                                    <div>Running deep AI analysis on anomalies and option chain structure...</div>
                                </div>
                            )}
                            {aiResult && !aiLoading && (
                                <div className="markdown-body" style={{ color: 'var(--text-color)' }}>
                                    <ReactMarkdown>{aiResult}</ReactMarkdown>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Option Chain */}
            {loading ? (
                <div className="loading-overlay"><div className="spinner" /><span>Loading option chain...</span></div>
            ) : filteredChain.length > 0 ? (
                <>
                    <div className="card" style={{ marginBottom: 16 }}>
                        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div className="card-title" onClick={() => setIsTableCollapsed(!isTableCollapsed)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span>{isTableCollapsed ? '▶' : '▼'}</span>
                                Option Chain
                                <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                                    {filteredChain.length} records, {strikes.length} strikes
                                </span>
                            </div>
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                <button 
                                    className="btn btn-secondary" 
                                    onClick={() => loadDataForExpiry(selectedExpiry)}
                                    disabled={loading || !selectedExpiry}
                                    style={{ 
                                        padding: '4px 12px', 
                                        fontSize: 12,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        background: 'rgba(255, 255, 255, 0.05)',
                                        border: '1px solid var(--border-color)'
                                    }}
                                >
                                    {loading ? '...' : '🔄'} Refresh Chain
                                </button>
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
                        </div>

                        {!isTableCollapsed && (
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
                                            const ce = optionChain.find((r: any) => r.Strike === strike && r.Right === 'CE') || {} as any;
                                            const pe = optionChain.find((r: any) => r.Strike === strike && r.Right === 'PE') || {} as any;
                                            const ceTick = liveTicks[`${strike}_CE`] || {} as any;
                                            const peTick = liveTicks[`${strike}_PE`] || {} as any;
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
                                                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{(ceTick.oi || ce.OI || 0).toLocaleString()}</td>
                                                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{(ceTick.vtt || ce.Volume || 0).toLocaleString()}</td>
                                                    <td style={{ textAlign: 'right' }}>{(ce.Close || 0).toFixed(2)}</td>
                                                    <td style={{ textAlign: 'right', fontWeight: 600, color: (ceTick.last || ce.Close) >= (ce.Close || 0) ? 'var(--green)' : 'var(--red)' }}>
                                                        {(ceTick.last || ce.Close || '--')}
                                                    </td>

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

                                                    <td style={{ textAlign: 'left', fontWeight: 600, color: (peTick.last || pe.Close) >= (pe.Close || 0) ? 'var(--green)' : 'var(--red)' }}>
                                                        {(peTick.last || pe.Close || '--')}
                                                    </td>
                                                    <td style={{ textAlign: 'left' }}>{(pe.Close || 0).toFixed(2)}</td>
                                                    <td style={{ textAlign: 'left', color: 'var(--text-muted)' }}>{(peTick.vtt || pe.Volume || 0).toLocaleString()}</td>
                                                    <td style={{ textAlign: 'left', color: 'var(--text-muted)' }}>{(peTick.oi || pe.OI || 0).toLocaleString()}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>


                    {/* Sudden OI Spikes Table */}
                    <div className="card fade-in" style={{ marginBottom: 32 }}>
                        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div className="card-title" onClick={() => setIsSpikesCollapsed(!isSpikesCollapsed)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span>{isSpikesCollapsed ? '▶' : '▼'}</span>
                                Sudden Market Spikes (OI AND Volume)
                                <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                                    {spikeLoading ? 'Scanning expiry week...' :
                                        oiSpikes.length === 1000 ? `Showing top 1000 recent anomalies` :
                                            `${oiSpikes.length} anomalies detected`}
                                    {spikeStats && ` (Scanned ${spikeStats.rows_scanned.toLocaleString()} rows)`}
                                </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                                    <span style={{ color: 'var(--text-muted)' }}>OI Threshold:</span>
                                    <select
                                        className="form-select"
                                        style={{ height: 32, padding: '0 8px', width: 90, fontSize: 12 }}
                                        value={spikeThreshold}
                                        onChange={(e) => {
                                            const val = parseFloat(e.target.value);
                                            setSpikeThreshold(val);
                                            if (selectedExpiry) loadSpikes(selectedExpiry, val, volThreshold, minLtp);
                                        }}
                                    >
                                        <option value={0.5}>50%</option>
                                        <option value={0.75}>75%</option>
                                        <option value={1.0}>100%</option>
                                        <option value={1.5}>150%</option>
                                        <option value={2.0}>200%</option>
                                    </select>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Vol Threshold:</span>
                                    <select
                                        className="form-select"
                                        style={{ height: 32, padding: '0 8px', width: 90, fontSize: 12 }}
                                        value={volThreshold}
                                        onChange={(e) => {
                                            const val = parseFloat(e.target.value);
                                            setVolThreshold(val);
                                            if (selectedExpiry) loadSpikes(selectedExpiry, spikeThreshold, val, minLtp);
                                        }}
                                    >
                                        <option value={0.5}>50%</option>
                                        <option value={0.75}>75%</option>
                                        <option value={1.0}>100%</option>
                                        <option value={1.5}>150%</option>
                                        <option value={2.0}>200%</option>
                                    </select>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Min LTP:</span>
                                    <input
                                        type="number"
                                        className="form-control"
                                        style={{ height: 32, padding: '0 8px', width: 80, fontSize: 12 }}
                                        value={minLtp}
                                        onChange={(e) => {
                                            const val = parseFloat(e.target.value) || 0;
                                            setMinLtp(val);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && selectedExpiry) {
                                                loadSpikes(selectedExpiry, spikeThreshold, volThreshold, minLtp);
                                            }
                                        }}
                                        placeholder="0"
                                    />
                                </div>
                            </div>
                        </div>
                        {!isSpikesCollapsed && (
                            <div className="table-container" style={{ maxHeight: 400, overflowY: 'auto' }}>
                                {spikeLoading ? (
                                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                                        <div className="spinner" style={{ margin: '0 auto 12px' }}></div>
                                        Scanning entire expiry week for Open Interest & Volume shifts...
                                    </div>
                                ) : oiSpikes.length > 0 ? (
                                    <table className="option-chain-table">
                                        <thead>
                                            <tr>
                                                <th>Time</th>
                                                <th>Strike</th>
                                                <th>Type</th>
                                                <th style={{ textAlign: 'right' }}>Old OI</th>
                                                <th style={{ textAlign: 'right' }}>New OI</th>
                                                <th style={{ textAlign: 'right' }}>OI Chg %</th>
                                                <th style={{ textAlign: 'right' }}>Old Vol</th>
                                                <th style={{ textAlign: 'right' }}>New Volume</th>
                                                <th style={{ textAlign: 'right' }}>Vol Chg %</th>
                                                <th style={{ textAlign: 'right' }}>LTP</th>
                                                <th style={{ textAlign: 'right' }}>Price Move</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {oiSpikes.map((s, idx) => (
                                                <tr key={idx} onClick={() => {
                                                    // Jump to this time
                                                    const timeIdx = timestamps.indexOf(s.timestamp);
                                                    if (timeIdx !== -1) {
                                                        setCurrentIndex(timeIdx);
                                                        loadChainAtTime(timestamps[timeIdx]);
                                                        window.scrollTo({ top: 0, behavior: 'smooth' });
                                                    }
                                                }} style={{ cursor: 'pointer' }}>
                                                    <td>{s.timestamp}</td>
                                                    <td style={{ fontWeight: 700 }}>{s.Strike}</td>
                                                    <td>
                                                        <span className={`badge ${s.Right === 'CE' ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: 10 }}>
                                                            {s.Right}
                                                        </span>
                                                    </td>
                                                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{s.prev_oi.toLocaleString()}</td>
                                                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{s.OI.toLocaleString()}</td>
                                                    <td style={{
                                                        textAlign: 'right',
                                                        color: 'var(--blue)',
                                                        fontWeight: 700
                                                    }}>
                                                        +{s.oi_increase_pct}%
                                                    </td>
                                                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{s.prev_vol.toLocaleString()}</td>
                                                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{s.Volume.toLocaleString()}</td>
                                                    <td style={{
                                                        textAlign: 'right',
                                                        color: 'var(--purple)',
                                                        fontWeight: 700
                                                    }}>
                                                        +{s.vol_increase_pct}%
                                                    </td>
                                                    <td style={{ textAlign: 'right' }}>{s.Close.toFixed(2)}</td>
                                                    <td style={{
                                                        textAlign: 'right',
                                                        fontWeight: 600,
                                                        color: s.price_change > 0 ? 'var(--green)' : s.price_change < 0 ? 'var(--red)' : 'var(--text-muted)'
                                                    }}>
                                                        {s.price_change > 0 ? '+' : ''}{s.price_change.toFixed(2)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                ) : (
                                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                                        No spikes (OI AND Volume) detected in the selected expiry period.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Trade History Section */}
                    {tradeHistory.length > 0 && (
                        <div className="card" style={{ marginTop: 16 }}>
                            <div className="card-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 12 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                                        📜 Automated Trade History
                                        <span className="badge badge-secondary" style={{ fontSize: 10 }}>{tradeHistory.length} Trades</span>
                                    </h4>
                                    <div style={{ fontSize: 13, fontWeight: 900, color: tradeHistory.reduce((acc, t) => acc + t.finalPnl, 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                        Total Session P/L: {tradeHistory.reduce((acc, t) => acc + t.finalPnl, 0).toFixed(2)}
                                    </div>
                                </div>
                            </div>
                            <div className="table-container" style={{ marginTop: 12 }}>
                                <table className="option-chain-table">
                                    <thead>
                                        <tr>
                                            <th>Entry Time</th>
                                            <th>Exit Time</th>
                                            <th>Strategy</th>
                                            <th style={{ textAlign: 'right' }}>Final P&L</th>
                                            <th>Stance at Exit</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {tradeHistory.map((trade, idx) => (
                                            <tr key={idx}>
                                                <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{trade.timestamp}</td>
                                                <td style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 600 }}>{trade.exitTimestamp}</td>
                                                <td style={{ fontWeight: 700 }}>{trade.name}</td>
                                                <td style={{ 
                                                    textAlign: 'right', 
                                                    fontWeight: 900, 
                                                    color: trade.finalPnl >= 0 ? 'var(--green)' : 'var(--red)' 
                                                }}>
                                                    {trade.finalPnl >= 0 ? '+' : ''}{trade.finalPnl.toFixed(2)}
                                                </td>
                                                <td>
                                                    <span className="badge" style={{ 
                                                        background: 'rgba(255,255,255,0.05)', 
                                                        color: 'var(--text-muted)',
                                                        fontSize: 10
                                                    }}>
                                                        {trade.action}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </>
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
            )
            }
            {/* Global Strategy Advisor Overlay */}
            {oiCommentary && !isAdvisorCollapsed && (
                <div className="fade-in" style={{
                    position: 'fixed',
                    top: 20,
                    right: 20,
                    width: 320,
                    background: 'rgba(15, 23, 42, 0.95)',
                    backdropFilter: 'blur(12px)',
                    border: `1px solid ${oiCommentary.color}`,
                    borderRadius: '16px',
                    padding: '20px',
                    zIndex: 2000,
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                    transition: 'all 0.3s ease'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '1px' }}>
                            Expert Advisor (AUTO)
                        </div>
                        <button 
                            onClick={(e) => { e.stopPropagation(); setIsAdvisorCollapsed(true); }}
                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}
                        >
                            ×
                        </button>
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                        <div style={{ 
                            padding: '6px 12px', 
                            background: `${oiCommentary.color}22`, 
                            color: oiCommentary.color, 
                            borderRadius: '20px', 
                            fontSize: 12, 
                            fontWeight: 900,
                            border: `1px solid ${oiCommentary.color}44`
                        }}>
                            {oiCommentary.sentiment}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>PCR: {oiCommentary.pcr.toFixed(2)}</div>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>ACTIVE STRATEGY:</div>
                        <div style={{ 
                            fontSize: 15, 
                            fontWeight: 800, 
                            color: 'var(--text-strong)', 
                            background: 'rgba(255,255,255,0.05)', 
                            padding: '12px', 
                            borderRadius: '10px',
                            border: '1px solid rgba(255,255,255,0.1)'
                        }}>
                            {trackedStrategy?.name || 'Monitoring...'}
                        </div>
                    </div>

                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '10px', borderLeft: `3px solid ${oiCommentary.color}` }}>
                        {oiCommentary.message}
                        <div style={{ marginTop: 8, fontWeight: 800, color: oiCommentary.color }}>➜ Auto-Managed Lifecycle Active</div>
                    </div>
                </div>
            )}
            
            {/* Minimized Advisor Button */}
            {oiCommentary && isAdvisorCollapsed && (
                <div 
                    onClick={() => setIsAdvisorCollapsed(false)}
                    style={{
                        position: 'fixed',
                        top: 20,
                        right: 20,
                        padding: '10px 18px',
                        background: oiCommentary.color,
                        color: ['var(--green)', 'var(--cyan)'].includes(oiCommentary.color) ? '#000' : '#fff',
                        borderRadius: '30px',
                        fontWeight: 900,
                        fontSize: 12,
                        cursor: 'pointer',
                        zIndex: 2000,
                        boxShadow: `0 10px 20px ${oiCommentary.color}44`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        border: '2px solid rgba(255,255,255,0.3)',
                        textTransform: 'uppercase'
                    }}
                >
                    💡 Insight: {oiCommentary.sentiment}
                </div>
            )}
        </div >
    );
}
