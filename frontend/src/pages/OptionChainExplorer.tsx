import { useState, useEffect, useMemo, useRef } from 'react';
import { createChart, ColorType, CrosshairMode, CandlestickSeries } from 'lightweight-charts';
import { dataApi, aiApi } from '../api/client';
import { useDataStore } from '../stores/appStore';
import ReactMarkdown from 'react-markdown';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';

export default function OptionChainExplorer() {
    const { expiries, setExpiries, selectedExpiry, setSelectedExpiry, optionChain, setOptionChain, globalUseUnified } = useDataStore();
    const [loading, setLoading] = useState(false);
    const [stepping, setStepping] = useState(false);
    const [filter, setFilter] = useState('');
    const [showCE, setShowCE] = useState(true);
    const [showPE, setShowPE] = useState(true);
    const [metrics, setMetrics] = useState<{ load_time_ms?: number; source_type?: string }>({});
    const [isTableCollapsed, setIsTableCollapsed] = useState(false);
    const [isChartCollapsed, setIsChartCollapsed] = useState(false);
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
    const [futuresData, setFuturesLocalData] = useState<any[]>([]);

    // Helper to parse "DD/MM/YYYY HH:MM:SS" to Unix Timestamp (seconds)
    const parseTimestamp = (ts: string) => {
        if (!ts) return 0;
        const parts = ts.split(' ');
        const dateParts = parts[0].split('/');
        const timeParts = parts[1] ? parts[1].split(':') : ['00', '00', '00'];
        return Date.UTC(
            parseInt(dateParts[2]), parseInt(dateParts[1]) - 1, parseInt(dateParts[0]),
            parseInt(timeParts[0]), parseInt(timeParts[1]), parseInt(timeParts[2])
        ) / 1000;
    };

    useEffect(() => {
        loadExpiries();
        loadAiModels();
    }, []);

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

            // Fetch Market Spikes (OI + Volume) for the entire week
            loadSpikes(expiry, spikeThreshold, volThreshold, minLtp);

        } catch (e) {
            console.error(e);
            setOptionChain([]);
            setTimestamps([]);
            setMetrics({});
        }
        setLoading(false);
    };

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
    const { currentSpot, currentFuture } = useMemo(() => {
        if (!currentTimestamp || (indexData.length === 0 && futuresData.length === 0)) {
            return { currentSpot: undefined, currentFuture: undefined };
        }
        
        const targetUnix = parseTimestamp(currentTimestamp);
        
        // Find exact or closest preceding data point
        const spotPt = indexData.find(d => parseTimestamp(d.Date) === targetUnix) || 
                      indexData.find(d => Math.abs(parseTimestamp(d.Date) - targetUnix) < 60);
        
        const futPt = futuresData.find(d => parseTimestamp(d.Date) === targetUnix) ||
                      futuresData.find(d => Math.abs(parseTimestamp(d.Date) - targetUnix) < 60);

        return {
            currentSpot: spotPt?.Close,
            currentFuture: futPt?.Close
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
        if (!currentSpot || topCallOiStrikes.length === 0 || topPutOiStrikes.length === 0) return null;

        const R1 = topCallOiStrikes[0];
        const S1 = topPutOiStrikes[0];
        const spot = currentSpot;

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
    }, [currentSpot, topCallOiStrikes, topPutOiStrikes]);
 
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

    // OI Commentary Logic (Expert Edition)
    const oiCommentary = useMemo(() => {
        if (!optionChain || optionChain.length === 0 || !currentSpot || topCallOiStrikes.length === 0 || topPutOiStrikes.length === 0) return null;

        const totalCallOi = optionChain.filter((r: any) => r.Right === 'CE').reduce((acc: number, r: any) => acc + (r.OI || 0), 0);
        const totalPutOi = optionChain.filter((r: any) => r.Right === 'PE').reduce((acc: number, r: any) => acc + (r.OI || 0), 0);
        const pcr = totalCallOi > 0 ? totalPutOi / totalCallOi : 0;

        const callR1 = topCallOiStrikes[0];
        const putS1 = topPutOiStrikes[0];
        const spot = currentSpot;
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
    }, [optionChain, currentSpot, topCallOiStrikes, topPutOiStrikes, maxPain]);


    // Candlestick Chart Initialization
    useEffect(() => {
        if (!chartContainerRef.current || indexData.length === 0) return;

        const handleResize = () => {
            if (chartContainerRef.current && chartRef.current) {
                chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };

        if (!chartRef.current) {
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
    }, [indexData]);

    // Effect to update chart data based on current index selection
    useEffect(() => {
        if (!seriesRef.current || indexData.length === 0 || !currentTimestamp) return;

        const currentUnix = parseTimestamp(currentTimestamp);

        // Filter index data up to current timestamp
        const filteredData = indexData
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
            .filter(d => d.time <= currentUnix)
            .sort((a, b) => a.time - b.time);

        seriesRef.current.setData(filteredData);
    }, [indexData, currentTimestamp]);

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

    const closestSpotStrike = getClosestStrike(currentSpot);
    const closestFutureStrike = getClosestStrike(currentFuture);

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
        if (!oiCommentary || !currentSpot || strikes.length === 0) return null;
        
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
    }, [oiCommentary, currentSpot, optionChain, strikes, closestSpotStrike, currentTimestamp]);

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
                    exitSpot: currentSpot,
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
                spot_price: currentSpot || 0,
                futures_price: currentFuture || 0,
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
            const ce = filteredChain.find((r: any) => r.Strike === strike && r.Right === 'CE') || {};
            const pe = filteredChain.find((r: any) => r.Strike === strike && r.Right === 'PE') || {};
            return {
                strike,
                ce_oi: ce.OI || 0,
                pe_oi: pe.OI || 0
            };
        });
    }, [strikes, filteredChain]);

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
                    background: 'var(--bg-secondary)',
                    border: stepping ? '1px solid var(--green)' : '1px solid var(--accent-primary)',
                    transition: 'border-color 0.2s',
                    padding: '12px 20px'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                            className="btn"
                            onClick={handlePrevDay}
                            disabled={loading || stepping || currentIndex === 0}
                            style={{ background: 'var(--bg-card)', padding: '6px 12px', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                            title="Previous Day"
                        >
                            &laquo;&laquo; Prev Day
                        </button>
                        <button
                            className="btn"
                            onClick={handleStepBackward}
                            disabled={loading || stepping || currentIndex === 0}
                            style={{ background: 'var(--bg-card)', padding: '6px 12px', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                        >
                            &laquo; Back
                        </button>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '0 8px' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 600 }}>Mins:</span>
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
                            style={{ background: 'var(--bg-card)', padding: '6px 12px', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                        >
                            Next &raquo;
                        </button>
                        <button
                            className="btn"
                            onClick={handleNextDay}
                            disabled={loading || stepping || currentIndex === timestamps.length - 1}
                            style={{ background: 'var(--bg-card)', padding: '6px 12px', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
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
                            <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--accent-primary)' }}>
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
                                {indexData.length === 0 ? (
                                    <div style={{ height: 350, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                                        Loading Index Data...
                                    </div>
                                ) : (
                                    <div ref={chartContainerRef} style={{ width: '100%', height: 350 }} />
                                )}
                            </div>
                        )}
                    </div>

                    {/* OI Buildup Chart */}
                    <div className="card fade-in" style={{ margin: 0 }}>
                        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div className="card-title" onClick={() => setIsChartCollapsed(!isChartCollapsed)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span>{isChartCollapsed ? '▶' : '▼'}</span>
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
                        {!isChartCollapsed && (
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
