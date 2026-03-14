import { useState, useEffect, useMemo, useRef } from 'react';
import { createChart, ColorType, CrosshairMode, CandlestickSeries } from 'lightweight-charts';
import { dataApi, aiApi, backtestApi } from '../api/client';
import { useDataStore } from '../stores/appStore';
import ReactMarkdown from 'react-markdown';
import { BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ComposedChart } from 'recharts';

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

    // Mean Reversion Z-Score State
    const [isMeanRevCollapsed, setIsMeanRevCollapsed] = useState(false);
    const [mrWindow, setMrWindow] = useState(20);
    const [mrEntryZ, setMrEntryZ] = useState(2.0);
    const [mrExitZ, setMrExitZ] = useState(0.0);
    const [mrStopZ, setMrStopZ] = useState(4.0);
    const [mrTradingHoursOnly, setMrTradingHoursOnly] = useState(true);

    // New Option Backtesting States
    const [allOptionTrades, setAllOptionTrades] = useState<any[]>([]);
    const [isOptionsLoading, setIsOptionsLoading] = useState(false);
    const [mrReport, setMrReport] = useState<any | null>(null);
    const [isReportLoading, setIsReportLoading] = useState(false);

    // Multi-Expiry Mean Reversion Backtest States
    const [mrMultiLoading, setMrMultiLoading] = useState(false);
    const [mrMultiResult, setMrMultiResult] = useState<any | null>(null);
    const [mrMultiModalOpen, setMrMultiModalOpen] = useState(false);
    const [mrMultiSelectedExpiry, setMrMultiSelectedExpiry] = useState<string | null>(null);
    const [mrNumExpiries, setMrNumExpiries] = useState(10);
    const [mrNumLots, setMrNumLots] = useState(1);
    const [mrInitialBudget, setMrInitialBudget] = useState(100000);
    // Sweep filter state
    const [swpFilterWindow, setSwpFilterWindow] = useState('');
    const [swpFilterEntryZ, setSwpFilterEntryZ] = useState('');
    const [swpFilterExitZ, setSwpFilterExitZ] = useState('');
    const [swpFilterStopZ, setSwpFilterStopZ] = useState('');
    const [swpFilterMinWinRate, setSwpFilterMinWinRate] = useState('');
    const [swpFilterMinPnl, setSwpFilterMinPnl] = useState('');
    const [swpFilterMinPF, setSwpFilterMinPF] = useState('');
    const [swpFilterOnlyProfit, setSwpFilterOnlyProfit] = useState(false);

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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    void useMemo(() => {
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

    // ========== MEAN REVERSION Z-SCORE ENGINE ==========

    // Compute Z-Score series from indexData
    const zScoreSeries = useMemo(() => {
        if (indexData.length < mrWindow + 1) return [];

        const sorted = [...indexData].sort((a, b) => parseTimestamp(a.Date) - parseTimestamp(b.Date));
        const closes = sorted.map(d => d.Close);
        const result: { time: number; timeStr: string; close: number; ma: number; std: number; z: number }[] = [];

        for (let i = mrWindow; i < closes.length; i++) {
            const window = closes.slice(i - mrWindow, i);
            const ma = window.reduce((a, b) => a + b, 0) / mrWindow;
            const variance = window.reduce((a, b) => a + (b - ma) ** 2, 0) / mrWindow;
            const std = Math.sqrt(variance);
            const z = std > 0 ? (closes[i] - ma) / std : 0;

            result.push({
                time: parseTimestamp(sorted[i].Date),
                timeStr: sorted[i].Date,
                close: closes[i],
                ma,
                std,
                z: parseFloat(z.toFixed(3))
            });
        }
        return result;
    }, [indexData, mrWindow]);

    // Current Z-Score at timestepper position
    const currentZInfo = useMemo(() => {
        if (zScoreSeries.length === 0 || !currentTimestamp) return null;
        const targetUnix = parseTimestamp(currentTimestamp);
        // Find closest Z entry at or before current timestamp
        let best = zScoreSeries[0];
        for (const entry of zScoreSeries) {
            if (entry.time <= targetUnix) best = entry;
            else break;
        }
        return best;
    }, [zScoreSeries, currentTimestamp]);

    // 1. Generate Raw Trades across the entire expiry
    const allRawTrades = useMemo(() => {
        if (zScoreSeries.length === 0) return [];

        interface MRRawTrade {
            type: 'LONG' | 'SHORT';
            entryTime: string;
            entryPrice: number;
            entryZ: number;
            exitTime: string;
            exitPrice: number;
            exitZ: number;
            exitReason: string;
            durationBars: number;
            strike: number;
            optionType: 'CE' | 'PE';
        }

        const trades: MRRawTrade[] = [];
        let position: 'LONG' | 'SHORT' | null = null;
        let entryPrice = 0;
        let entryZ = 0;
        let entryTime = '';
        let entryIdx = 0;
        let optionType: 'CE' | 'PE' = 'CE';
        let strike = 0;

        for (let i = 0; i < zScoreSeries.length; i++) {
            const bar = zScoreSeries[i];
            const z = bar.z;

            // Skip non-trading hours if filter enabled
            if (mrTradingHoursOnly && bar.timeStr) {
                const timePart = bar.timeStr.split(' ')[1];
                if (timePart) {
                    const [hh, mm] = timePart.split(':').map(Number);
                    const mins = hh * 60 + mm;
                    if (mins < 9 * 60 + 20 || mins > 15 * 60 + 15) continue;
                }
            }

            if (position === null) {
                // Entry conditions
                if (z < -mrEntryZ) {
                    position = 'LONG';
                    entryPrice = bar.close;
                    entryZ = z;
                    entryTime = bar.timeStr;
                    entryIdx = i;
                    optionType = 'CE'; // Buy Call for Mean Reversion Long
                    strike = Math.round(bar.close / 50) * 50; // ATM Strike
                } else if (z > mrEntryZ) {
                    position = 'SHORT';
                    entryPrice = bar.close;
                    entryZ = z;
                    entryTime = bar.timeStr;
                    entryIdx = i;
                    optionType = 'PE'; // Buy Put for Mean Reversion Short
                    strike = Math.round(bar.close / 50) * 50; // ATM Strike
                }
            } else if (position === 'LONG') {
                let exitReason = '';
                if (z >= mrExitZ) exitReason = 'Mean Reversion';
                else if (z < -mrStopZ) exitReason = 'Stop Loss';

                if (exitReason) {
                    trades.push({
                        type: 'LONG',
                        entryTime, entryPrice, entryZ,
                        exitTime: bar.timeStr,
                        exitPrice: bar.close,
                        exitZ: z,
                        exitReason,
                        durationBars: i - entryIdx,
                        strike, optionType
                    });
                    position = null;
                }
            } else if (position === 'SHORT') {
                let exitReason = '';
                if (z <= -mrExitZ) exitReason = 'Mean Reversion';
                else if (z > mrStopZ) exitReason = 'Stop Loss';

                if (exitReason) {
                    trades.push({
                        type: 'SHORT',
                        entryTime, entryPrice, entryZ,
                        exitTime: bar.timeStr,
                        exitPrice: bar.close,
                        exitZ: z,
                        exitReason,
                        durationBars: i - entryIdx,
                        strike, optionType
                    });
                    position = null;
                }
            }
        }
        return trades;
    }, [zScoreSeries, mrEntryZ, mrExitZ, mrStopZ, mrTradingHoursOnly]);

    // 2. Fetch Option Prices for Raw Trades
    useEffect(() => {
        let mounted = true;
        const fetchOptionPnL = async () => {
            if (!allRawTrades || allRawTrades.length === 0) {
                if (mounted) setAllOptionTrades([]);
                return;
            }
            if (mounted) setIsOptionsLoading(true);

            const queries: any[] = [];
            allRawTrades.forEach((t, i) => {
                queries.push({ id: `entry_${i}`, timestamp: t.entryTime, strike: t.strike, right: t.optionType });
                queries.push({ id: `exit_${i}`, timestamp: t.exitTime, strike: t.strike, right: t.optionType });
            });

            try {
                const res = await dataApi.getBacktestOptions(selectedExpiry, queries, globalUseUnified);
                if (!mounted) return;
                const priceMap = res.results || {};

                const mappedTrades = allRawTrades.map((t, i) => {
                    const optEntry = priceMap[`entry_${i}`];
                    const optExit = priceMap[`exit_${i}`];
                    let optPnl = 0;
                    if (optEntry !== undefined && optExit !== undefined) {
                        optPnl = optExit - optEntry; // We buy the option
                    }
                    return {
                        ...t,
                        optEntryPrice: optEntry,
                        optExitPrice: optExit,
                        optPnl
                    };
                });
                setAllOptionTrades(mappedTrades);
            } catch (e) { console.error("Failed to fetch option PnL:", e); }
            if (mounted) setIsOptionsLoading(false);
        };
        fetchOptionPnL();
        return () => { mounted = false; };
    }, [allRawTrades, selectedExpiry, globalUseUnified]);

    // 3. Filter Trades by Timestepper and Compute Metrics
    const mrBacktest = useMemo(() => {
        if (allOptionTrades.length === 0) return { trades: [], metrics: null };

        const currentUnix = currentTimestamp ? parseTimestamp(currentTimestamp) : Infinity;
        // Keep trades that exited before or exactly at current timestamp
        const visibleTrades = allOptionTrades.filter(t => parseTimestamp(t.exitTime) <= currentUnix);

        if (visibleTrades.length === 0) return { trades: [], metrics: null };

        const validTrades = visibleTrades.filter(t => t.optEntryPrice !== undefined && t.optExitPrice !== undefined);
        const wins = validTrades.filter(t => t.optPnl > 0);
        const losses = validTrades.filter(t => t.optPnl <= 0);
        const totalPnl = validTrades.reduce((a, t) => a + t.optPnl, 0);
        const avgPnl = validTrades.length > 0 ? totalPnl / validTrades.length : 0;
        const avgDuration = validTrades.length > 0 ? validTrades.reduce((a, t) => a + t.durationBars, 0) / validTrades.length : 0;
        const grossProfit = wins.reduce((a, t) => a + t.optPnl, 0);
        const grossLoss = Math.abs(losses.reduce((a, t) => a + t.optPnl, 0));
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

        let peak = 0, maxDD = 0, cumPnl = 0;
        for (const t of validTrades) {
            cumPnl += t.optPnl;
            if (cumPnl > peak) peak = cumPnl;
            const dd = peak - cumPnl;
            if (dd > maxDD) maxDD = dd;
        }

        const pnls = validTrades.map(t => t.optPnl);
        const meanPnl = pnls.length > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0;
        const stdPnl = pnls.length > 0 ? Math.sqrt(pnls.reduce((a, b) => a + (b - meanPnl) ** 2, 0) / pnls.length) : 0;
        const sharpe = stdPnl > 0 ? (meanPnl / stdPnl) * Math.sqrt(252) : 0;

        return {
            trades: validTrades,
            metrics: {
                totalTrades: validTrades.length,
                winRate: validTrades.length > 0 ? ((wins.length / validTrades.length) * 100).toFixed(1) : "0.0",
                totalPnl: totalPnl.toFixed(2),
                avgPnl: avgPnl.toFixed(2),
                profitFactor: profitFactor === Infinity ? '∞' : profitFactor.toFixed(2),
                maxDrawdown: maxDD.toFixed(2),
                sharpe: sharpe.toFixed(2),
                avgDuration: avgDuration.toFixed(0),
                wins: wins.length,
                losses: losses.length,
                grossProfit: grossProfit.toFixed(2),
                grossLoss: grossLoss.toFixed(2),
            }
        };
    }, [allOptionTrades, currentTimestamp]);

    // Trades Report Logic
    const generateTradesReport = async () => {
        if (zScoreSeries.length === 0 || !selectedExpiry) return;
        setIsReportLoading(true);

        const testZValues = [1.0, 1.5, 2.0, 2.5, 3.0];
        const allQueries: any[] = [];
        const rawTradesByZ: Record<number, any[]> = {};

        for (const testZ of testZValues) {
            let position: 'LONG' | 'SHORT' | null = null;
            let entryZ = 0; let entryTime = ''; let entryIdx = 0;
            let optionType: 'CE' | 'PE' = 'CE'; let strike = 0;
            const trades: any[] = [];

            for (let i = 0; i < zScoreSeries.length; i++) {
                const bar = zScoreSeries[i];
                const z = bar.z;
                if (mrTradingHoursOnly && bar.timeStr) {
                    const timePart = bar.timeStr.split(' ')[1];
                    if (timePart) {
                        const [hh, mm] = timePart.split(':').map(Number);
                        const mins = hh * 60 + mm;
                        if (mins < 9 * 60 + 20 || mins > 15 * 60 + 15) continue;
                    }
                }
                if (position === null) {
                    if (z < -testZ) {
                        position = 'LONG'; entryZ = z; entryTime = bar.timeStr; entryIdx = i;
                        optionType = 'CE'; strike = Math.round(bar.close / 50) * 50;
                    } else if (z > testZ) {
                        position = 'SHORT'; entryZ = z; entryTime = bar.timeStr; entryIdx = i;
                        optionType = 'PE'; strike = Math.round(bar.close / 50) * 50;
                    }
                } else if (position === 'LONG') {
                    if (z >= mrExitZ || z < -mrStopZ) {
                        trades.push({ entryTime, entryZ, exitTime: bar.timeStr, exitZ: z, strike, optionType });
                        position = null;
                    }
                } else if (position === 'SHORT') {
                    if (z <= -mrExitZ || z > mrStopZ) {
                        trades.push({ entryTime, entryZ, exitTime: bar.timeStr, exitZ: z, strike, optionType });
                        position = null;
                    }
                }
            }
            rawTradesByZ[testZ] = trades;
            
            trades.forEach((t, i) => {
                allQueries.push({ id: `Z${testZ}_entry_${i}`, timestamp: t.entryTime, strike: t.strike, right: t.optionType });
                allQueries.push({ id: `Z${testZ}_exit_${i}`, timestamp: t.exitTime, strike: t.strike, right: t.optionType });
            });
        }

        try {
            const res = await dataApi.getBacktestOptions(selectedExpiry, allQueries, globalUseUnified);
            const priceMap = res.results || {};
            
            const reportResults = testZValues.map(testZ => {
                const tr = rawTradesByZ[testZ];
                const validTrades = tr.map((t, i) => {
                    const optEntry = priceMap[`Z${testZ}_entry_${i}`];
                    const optExit = priceMap[`Z${testZ}_exit_${i}`];
                    let optPnl = 0;
                    if (optEntry !== undefined && optExit !== undefined) {
                        optPnl = optExit - optEntry;
                    }
                    return { ...t, optEntry, optExit, optPnl };
                }).filter(t => t.optEntry !== undefined && t.optExit !== undefined);

                const wins = validTrades.filter(t => t.optPnl > 0);
                const totalPnl = validTrades.reduce((a, t) => a + t.optPnl, 0);
                const winRate = validTrades.length > 0 ? (wins.length / validTrades.length) * 100 : 0;
                
                let peak = 0, maxDD = 0, cumPnl = 0;
                for (const t of validTrades) {
                    cumPnl += t.optPnl;
                    if (cumPnl > peak) peak = cumPnl;
                    if (peak - cumPnl > maxDD) maxDD = peak - cumPnl;
                }

                return {
                    entryZ: testZ,
                    totalTrades: validTrades.length,
                    winRate: winRate.toFixed(1),
                    totalPnl: totalPnl.toFixed(2),
                    maxDrawdown: maxDD.toFixed(2)
                };
            });

            setMrReport(reportResults);
        } catch (e) {
            console.error("Failed to generate Trades Report:", e);
        }
        setIsReportLoading(false);
    };

    // ── Test Mean Reversion Strategy Across Last 10 Expiries ──────────────────
    const runMeanReversionMultiBacktest = async () => {
        setMrMultiLoading(true);
        setMrMultiModalOpen(true);
        setMrMultiResult(null);
        setMrMultiSelectedExpiry(null);
        try {
            const result = await backtestApi.runMeanReversion({
                window: mrWindow,
                entry_z: mrEntryZ,
                exit_z: mrExitZ,
                stop_z: mrStopZ,
                trading_hours_only: mrTradingHoursOnly,
                num_expiries: mrNumExpiries,
                num_lots: mrNumLots,
                initial_budget: mrInitialBudget,
            });
            setMrMultiResult(result);
        } catch (e: any) {
            console.error("MR multi-expiry backtest failed:", e);
            setMrMultiResult({ error: e.message || "Backtest failed" });
        }
        setMrMultiLoading(false);
    };

    // Prepare Z-Score chart data (sampled to avoid rendering thousands of points)
    const zScoreChartData = useMemo(() => {
        if (zScoreSeries.length === 0) return [];
        const currentUnix = currentTimestamp ? parseTimestamp(currentTimestamp) : Infinity;
        const visible = zScoreSeries.filter(s => s.time <= currentUnix);
        // Sample every Nth point if too many
        const maxPoints = 300;
        const step = Math.max(1, Math.floor(visible.length / maxPoints));
        return visible.filter((_, i) => i % step === 0 || i === visible.length - 1).map(s => ({
            time: s.timeStr.split(' ')[1] || s.timeStr,
            z: s.z,
            close: s.close,
            upper: mrEntryZ,
            lower: -mrEntryZ,
        }));
    }, [zScoreSeries, currentTimestamp, mrEntryZ]);

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

                {/* ========== MEAN REVERSION Z-SCORE SECTION ========== */}
                {selectedExpiry && indexData.length > 0 && (
                    <div className="card fade-in" style={{
                        marginBottom: 16,
                        border: '1px solid rgba(168, 85, 247, 0.3)',
                        boxShadow: '0 0 20px rgba(168, 85, 247, 0.08)'
                    }}>
                        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div className="card-title" onClick={() => setIsMeanRevCollapsed(!isMeanRevCollapsed)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span>{isMeanRevCollapsed ? '▶' : '▼'}</span>
                                <span style={{
                                    background: 'linear-gradient(90deg, #A855F7, #EC4899)',
                                    WebkitBackgroundClip: 'text',
                                    WebkitTextFillColor: 'transparent',
                                    fontWeight: 800
                                }}>
                                    📊 Mean Reversion Z-Score Strategy
                                </span>
                                {currentZInfo && (
                                    <span style={{
                                        marginLeft: 12,
                                        padding: '3px 10px',
                                        borderRadius: 20,
                                        fontSize: 12,
                                        fontWeight: 800,
                                        background: Math.abs(currentZInfo.z) >= mrEntryZ
                                            ? (currentZInfo.z < 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)')
                                            : 'rgba(255, 255, 255, 0.05)',
                                        color: Math.abs(currentZInfo.z) >= mrEntryZ
                                            ? (currentZInfo.z < 0 ? 'var(--green)' : 'var(--red)')
                                            : 'var(--text-muted)',
                                        border: `1px solid ${Math.abs(currentZInfo.z) >= mrEntryZ
                                            ? (currentZInfo.z < 0 ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)')
                                            : 'rgba(255,255,255,0.1)'}`
                                    }}>
                                        Z: {currentZInfo.z.toFixed(2)} {Math.abs(currentZInfo.z) >= mrEntryZ ? (currentZInfo.z < 0 ? '🟢 LONG' : '🔴 SHORT') : '⚪ NEUTRAL'}
                                    </span>
                                )}
                                {mrBacktest.metrics && (
                                    <span style={{
                                        marginLeft: 8,
                                        fontSize: 11,
                                        color: parseFloat(mrBacktest.metrics.totalPnl) >= 0 ? 'var(--green)' : 'var(--red)',
                                        fontWeight: 700
                                    }}>
                                        P&L: {parseFloat(mrBacktest.metrics.totalPnl) >= 0 ? '+' : ''}{mrBacktest.metrics.totalPnl} pts
                                    </span>
                                )}
                            </div>
                        </div>

                        {!isMeanRevCollapsed && (
                            <div style={{ padding: '16px', borderTop: '1px solid var(--border-color)' }}>
                                {/* Parameter Controls */}
                                <div style={{
                                    display: 'flex',
                                    gap: 16,
                                    flexWrap: 'wrap',
                                    marginBottom: 20,
                                    padding: '12px 16px',
                                    background: 'rgba(255,255,255,0.02)',
                                    borderRadius: 10,
                                    border: '1px solid rgba(255,255,255,0.05)'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Window:</span>
                                        <select className="form-select" style={{ height: 28, padding: '0 6px', width: 70, fontSize: 11 }}
                                            value={mrWindow} onChange={e => setMrWindow(parseInt(e.target.value))}>
                                            {[5, 10, 15, 20, 30, 50, 60].map(v => <option key={v} value={v}>{v} min</option>)}
                                        </select>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Entry Z:</span>
                                        <select className="form-select" style={{ height: 28, padding: '0 6px', width: 60, fontSize: 11 }}
                                            value={mrEntryZ} onChange={e => setMrEntryZ(parseFloat(e.target.value))}>
                                            {[1.0, 1.5, 2.0, 2.5, 3.0].map(v => <option key={v} value={v}>±{v}</option>)}
                                        </select>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Exit Z:</span>
                                        <select className="form-select" style={{ height: 28, padding: '0 6px', width: 60, fontSize: 11 }}
                                            value={mrExitZ} onChange={e => setMrExitZ(parseFloat(e.target.value))}>
                                            {[0, 0.25, 0.5, 1.0].map(v => <option key={v} value={v}>{v}</option>)}
                                        </select>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Stop Z:</span>
                                        <select className="form-select" style={{ height: 28, padding: '0 6px', width: 60, fontSize: 11 }}
                                            value={mrStopZ} onChange={e => setMrStopZ(parseFloat(e.target.value))}>
                                            {[3.0, 3.5, 4.0, 5.0].map(v => <option key={v} value={v}>±{v}</option>)}
                                        </select>
                                    </div>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                                        <input type="checkbox" checked={mrTradingHoursOnly}
                                            onChange={e => setMrTradingHoursOnly(e.target.checked)} />
                                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Trading Hours Only (9:20–15:15)</span>
                                    </label>
                                </div>

                                {/* Z-Score Gauge Row */}
                                {currentZInfo && (
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 1fr 1fr',
                                        gap: 12,
                                        marginBottom: 20
                                    }}>
                                        {/* Z-Score Gauge */}
                                        <div style={{
                                            background: 'var(--bg-card)',
                                            borderRadius: 12,
                                            padding: '16px 20px',
                                            border: '1px solid rgba(255,255,255,0.06)',
                                            textAlign: 'center'
                                        }}>
                                            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>Current Z-Score</div>
                                            <div style={{
                                                fontSize: 36,
                                                fontWeight: 900,
                                                fontFamily: 'monospace',
                                                color: Math.abs(currentZInfo.z) >= mrStopZ ? '#ff4444'
                                                    : Math.abs(currentZInfo.z) >= mrEntryZ ? (currentZInfo.z < 0 ? '#10b981' : '#ef4444')
                                                    : Math.abs(currentZInfo.z) >= 1 ? '#eab308'
                                                    : '#6b7280',
                                                textShadow: Math.abs(currentZInfo.z) >= mrEntryZ ? `0 0 20px ${currentZInfo.z < 0 ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}` : 'none'
                                            }}>
                                                {currentZInfo.z >= 0 ? '+' : ''}{currentZInfo.z.toFixed(2)}
                                            </div>
                                            <div style={{
                                                marginTop: 8,
                                                fontSize: 11,
                                                fontWeight: 700,
                                                padding: '4px 12px',
                                                borderRadius: 20,
                                                display: 'inline-block',
                                                background: Math.abs(currentZInfo.z) >= mrEntryZ
                                                    ? (currentZInfo.z < 0 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)')
                                                    : 'rgba(255,255,255,0.05)',
                                                color: Math.abs(currentZInfo.z) >= mrEntryZ
                                                    ? (currentZInfo.z < 0 ? '#10b981' : '#ef4444')
                                                    : '#9ca3af'
                                            }}>
                                                {Math.abs(currentZInfo.z) >= mrStopZ ? '⚠ EXTREME' :
                                                 Math.abs(currentZInfo.z) >= mrEntryZ ? (currentZInfo.z < 0 ? '▲ BUY SIGNAL' : '▼ SELL SIGNAL') :
                                                 Math.abs(currentZInfo.z) >= 1 ? 'Mild Deviation' : 'Near Mean'}
                                            </div>
                                        </div>

                                        {/* Price Info */}
                                        <div style={{
                                            background: 'var(--bg-card)',
                                            borderRadius: 12,
                                            padding: '16px 20px',
                                            border: '1px solid rgba(255,255,255,0.06)'
                                        }}>
                                            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 1, marginBottom: 12 }}>Price Stats</div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                                <div>
                                                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Price</div>
                                                    <div style={{ fontSize: 16, fontWeight: 700 }}>{currentZInfo.close.toFixed(2)}</div>
                                                </div>
                                                <div>
                                                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>MA({mrWindow})</div>
                                                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--blue)' }}>{currentZInfo.ma.toFixed(2)}</div>
                                                </div>
                                                <div>
                                                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>StdDev</div>
                                                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--purple)' }}>{currentZInfo.std.toFixed(2)}</div>
                                                </div>
                                                <div>
                                                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Deviation</div>
                                                    <div style={{ fontSize: 16, fontWeight: 700, color: (currentZInfo.close - currentZInfo.ma) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                                        {(currentZInfo.close - currentZInfo.ma) >= 0 ? '+' : ''}{(currentZInfo.close - currentZInfo.ma).toFixed(2)}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Options Signal */}
                                        <div style={{
                                            background: 'var(--bg-card)',
                                            borderRadius: 12,
                                            padding: '16px 20px',
                                            border: '1px solid rgba(255,255,255,0.06)'
                                        }}>
                                            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 1, marginBottom: 12 }}>Options Signal</div>
                                            {Math.abs(currentZInfo.z) >= mrEntryZ ? (
                                                <div>
                                                    <div style={{
                                                        fontSize: 14, fontWeight: 800, marginBottom: 8,
                                                        color: currentZInfo.z < 0 ? 'var(--green)' : 'var(--red)'
                                                    }}>
                                                        {currentZInfo.z < 0 ? '🟢 Buy ATM CALL' : '🔴 Buy ATM PUT'}
                                                    </div>
                                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                                                        {currentZInfo.z < 0
                                                            ? `Price is ${Math.abs(currentZInfo.z).toFixed(1)}σ below mean. Oversold — expect bounce to MA (${currentZInfo.ma.toFixed(0)}).`
                                                            : `Price is ${currentZInfo.z.toFixed(1)}σ above mean. Overbought — expect pullback to MA (${currentZInfo.ma.toFixed(0)}).`}
                                                    </div>
                                                    <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                                                        Target: MA at {currentZInfo.ma.toFixed(0)} ({currentZInfo.z < 0 ? '+' : ''}{(currentZInfo.ma - currentZInfo.close).toFixed(1)} pts)
                                                    </div>
                                                </div>
                                            ) : (
                                                <div>
                                                    <div style={{ fontSize: 14, fontWeight: 800, color: '#6b7280', marginBottom: 8 }}>
                                                        ⚪ No Active Signal
                                                    </div>
                                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                                                        Price is within ±{mrEntryZ}σ of the mean. Waiting for Z-Score to breach the entry threshold.
                                                    </div>
                                                    {Math.abs(currentZInfo.z) >= 1 && (
                                                        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--yellow)' }}>
                                                            ⚠ Approaching threshold ({currentZInfo.z.toFixed(2)} / ±{mrEntryZ})
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Z-Score Chart */}
                                {zScoreChartData.length > 0 && (
                                    <div style={{ marginBottom: 20 }}>
                                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                                            Z-Score Timeline
                                        </div>
                                        <ResponsiveContainer width="100%" height={200}>
                                            <ComposedChart data={zScoreChartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                                <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#6b7280' }} interval="preserveStartEnd" />
                                                <YAxis tick={{ fontSize: 9, fill: '#6b7280' }} domain={['auto', 'auto']} />
                                                <Tooltip
                                                    contentStyle={{ background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                                                    labelStyle={{ color: '#9ca3af' }}
                                                />
                                                <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
                                                <ReferenceLine y={mrEntryZ} stroke="rgba(239,68,68,0.4)" strokeDasharray="5 5" label={{ value: `+${mrEntryZ}`, position: 'right', fill: '#ef4444', fontSize: 9 }} />
                                                <ReferenceLine y={-mrEntryZ} stroke="rgba(16,185,129,0.4)" strokeDasharray="5 5" label={{ value: `-${mrEntryZ}`, position: 'right', fill: '#10b981', fontSize: 9 }} />
                                                <Line type="monotone" dataKey="z" stroke="#a855f7" strokeWidth={1.5} dot={false} name="Z-Score" />
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}

                                {/* Backtest Metrics */}
                                {mrBacktest.metrics && (
                                    <div style={{ marginBottom: 20 }}>
                                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                                            Backtest Performance ({mrBacktest.metrics.totalTrades} trades up to current time)
                                        </div>
                                        <div style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(6, 1fr)',
                                            gap: 8
                                        }}>
                                            {[
                                                { label: 'Win Rate', value: `${mrBacktest.metrics.winRate}%`, color: parseFloat(mrBacktest.metrics.winRate) >= 50 ? 'var(--green)' : 'var(--red)' },
                                                { label: 'Total P&L', value: `${parseFloat(mrBacktest.metrics.totalPnl) >= 0 ? '+' : ''}${mrBacktest.metrics.totalPnl}`, color: parseFloat(mrBacktest.metrics.totalPnl) >= 0 ? 'var(--green)' : 'var(--red)' },
                                                { label: 'Sharpe', value: mrBacktest.metrics.sharpe, color: parseFloat(mrBacktest.metrics.sharpe) >= 1.5 ? 'var(--green)' : 'var(--yellow)' },
                                                { label: 'Profit Factor', value: mrBacktest.metrics.profitFactor, color: parseFloat(mrBacktest.metrics.profitFactor) >= 1.5 ? 'var(--green)' : 'var(--orange)' },
                                                { label: 'Max DD', value: `-${mrBacktest.metrics.maxDrawdown}`, color: 'var(--red)' },
                                                { label: 'Avg Duration', value: `${mrBacktest.metrics.avgDuration} bars`, color: 'var(--text-muted)' },
                                            ].map((m, i) => (
                                                <div key={i} style={{
                                                    background: 'rgba(255,255,255,0.02)',
                                                    borderRadius: 8,
                                                    padding: '10px 12px',
                                                    border: '1px solid rgba(255,255,255,0.05)',
                                                    textAlign: 'center'
                                                }}>
                                                    <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{m.label}</div>
                                                    <div style={{ fontSize: 16, fontWeight: 800, color: m.color }}>{m.value}</div>
                                                </div>
                                            ))}
                                        </div>
                                        <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-muted)' }}>
                                            <span>Wins: <strong style={{ color: 'var(--green)' }}>{mrBacktest.metrics.wins}</strong> ({mrBacktest.metrics.grossProfit} pts)</span>
                                            <span>Losses: <strong style={{ color: 'var(--red)' }}>{mrBacktest.metrics.losses}</strong> (-{mrBacktest.metrics.grossLoss} pts)</span>
                                            <span>Avg P&L/Trade: <strong style={{ color: parseFloat(mrBacktest.metrics.avgPnl) >= 0 ? 'var(--green)' : 'var(--red)' }}>{mrBacktest.metrics.avgPnl}</strong></span>
                                        </div>
                                    </div>
                                )}

                                {/* Trades (Opportunities) Table */}
                                {mrBacktest.trades.length > 0 && (
                                    <div>
                                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                                            Trade Opportunities ({mrBacktest.trades.length})
                                        </div>
                                        <div className="table-container" style={{ maxHeight: 300, overflowY: 'auto' }}>
                                            <table className="option-chain-table">
                                                <thead>
                                                    <tr>
                                                        <th>#</th>
                                                        <th>Type/Strike</th>
                                                        <th>Entry Time</th>
                                                        <th style={{ textAlign: 'right' }}>Idx / Opt Entry</th>
                                                        <th>Exit Time</th>
                                                        <th style={{ textAlign: 'right' }}>Idx / Opt Exit</th>
                                                        <th>Reason</th>
                                                        <th style={{ textAlign: 'right' }}>Opt P&L</th>
                                                        <th style={{ textAlign: 'right' }}>Duration</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {mrBacktest.trades.map((t: any, idx: number) => (
                                                        <tr key={idx} onClick={() => {
                                                            const timeIdx = timestamps.indexOf(t.entryTime);
                                                            if (timeIdx !== -1) {
                                                                setCurrentIndex(timeIdx);
                                                                loadChainAtTime(timestamps[timeIdx]);
                                                            }
                                                        }} style={{ cursor: 'pointer' }}>
                                                            <td style={{ color: 'var(--text-muted)', fontSize: 10 }}>{idx + 1}</td>
                                                            <td>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                    <span style={{
                                                                        fontWeight: 800, fontSize: 9, padding: '2px 6px', borderRadius: 4,
                                                                        background: t.optionType === 'CE' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                                                                        color: t.optionType === 'CE' ? '#10b981' : '#ef4444'
                                                                    }}>
                                                                        {t.optionType}
                                                                    </span>
                                                                    <span style={{ fontSize: 11, fontWeight: 700 }}>{t.strike}</span>
                                                                </div>
                                                            </td>
                                                            <td style={{ fontSize: 11 }}>
                                                                <div>{t.entryTime}</div>
                                                                <div style={{ fontSize: 9, color: 'var(--purple)' }}>Z: {t.entryZ.toFixed(2)}</div>
                                                            </td>
                                                            <td style={{ textAlign: 'right' }}>
                                                                <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Idx: {t.entryPrice.toFixed(2)}</div>
                                                                <div style={{ fontWeight: 600 }}>{t.optEntryPrice !== undefined ? t.optEntryPrice.toFixed(2) : '-'}</div>
                                                            </td>
                                                            <td style={{ fontSize: 11 }}>
                                                                <div>{t.exitTime}</div>
                                                                <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Z: {t.exitZ.toFixed(2)}</div>
                                                            </td>
                                                            <td style={{ textAlign: 'right' }}>
                                                                <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Idx: {t.exitPrice.toFixed(2)}</div>
                                                                <div style={{ fontWeight: 600 }}>{t.optExitPrice !== undefined ? t.optExitPrice.toFixed(2) : '-'}</div>
                                                            </td>
                                                            <td>
                                                                <span className="badge" style={{
                                                                    fontSize: 9,
                                                                    background: t.exitReason === 'Stop Loss' ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
                                                                    color: t.exitReason === 'Stop Loss' ? 'var(--red)' : 'var(--green)'
                                                                }}>
                                                                    {t.exitReason}
                                                                </span>
                                                            </td>
                                                            <td style={{
                                                                textAlign: 'right', fontWeight: 800,
                                                                color: t.optPnl > 0 ? 'var(--green)' : (t.optPnl < 0 ? 'var(--red)' : 'var(--text-muted)')
                                                            }}>
                                                                {t.optPnl > 0 ? '+' : ''}{t.optPnl.toFixed(2)}
                                                            </td>
                                                            <td style={{ textAlign: 'right', fontSize: 10, color: 'var(--text-muted)' }}>{t.durationBars} bars</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}

                                {/* Empty State */}
                                {zScoreSeries.length === 0 && (
                                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                                        Not enough index data. Need at least {mrWindow + 1} bars to compute Z-Score.
                                    </div>
                                )}
                                {zScoreSeries.length > 0 && mrBacktest.trades.length === 0 && (
                                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                                        No trades triggered with current parameters up to this timestamp. Try lowering Entry Z or adjusting Window.
                                    </div>
                                )}
                                
                                {/* Trades Report Section */}
                                {zScoreSeries.length > 0 && (
                                    <div style={{ marginTop: 24, padding: '16px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                            <div>
                                                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Trades Report Analysis</div>
                                                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Analyze strategy performance across multiple Entry Z thresholds</div>
                                            </div>
                                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                                                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Expiries:</span>
                                                    <select
                                                        value={mrNumExpiries}
                                                        onChange={e => setMrNumExpiries(Number(e.target.value))}
                                                        style={{ height: 28, padding: '0 6px', width: 64, fontSize: 11, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer' }}
                                                    >
                                                        {[5, 10, 15, 20, 30].map(v => <option key={v} value={v}>{v}</option>)}
                                                    </select>
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                                                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Lots:</span>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        value={mrNumLots}
                                                        onChange={e => setMrNumLots(Math.max(0, Number(e.target.value) || 0))}
                                                        style={{ height: 28, padding: '0 6px', width: 56, fontSize: 11, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', textAlign: 'center' }}
                                                    />
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                                                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Budget ₹:</span>
                                                    <input
                                                        type="number"
                                                        min={1000}
                                                        step={10000}
                                                        value={mrInitialBudget}
                                                        onChange={e => setMrInitialBudget(Math.max(1000, Number(e.target.value) || 100000))}
                                                        style={{ height: 28, padding: '0 6px', width: 96, fontSize: 11, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', textAlign: 'right' }}
                                                    />
                                                </div>
                                                <button
                                                    className="btn"
                                                    onClick={runMeanReversionMultiBacktest}
                                                    disabled={mrMultiLoading}
                                                    style={{
                                                        padding: '6px 14px', fontSize: 11,
                                                        background: 'linear-gradient(90deg, #10b981, #3B82F6)',
                                                        color: 'white', border: 'none', borderRadius: 4,
                                                        display: 'flex', alignItems: 'center', gap: 6,
                                                        fontWeight: 700, cursor: mrMultiLoading ? 'not-allowed' : 'pointer'
                                                    }}
                                                >
                                                    {mrMultiLoading
                                                        ? <><div className="spinner-small" /> Running...</>
                                                        : `🔬 Test Mean Reversion Strategy`}
                                                </button>
                                                <button 
                                                    className="btn" 
                                                    onClick={generateTradesReport}
                                                    disabled={isReportLoading}
                                                    style={{ padding: '6px 12px', fontSize: 11, background: 'linear-gradient(90deg, #A855F7, #3B82F6)', color: 'white', border: 'none', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6 }}
                                                >
                                                    {isReportLoading ? <div className="spinner-small" /> : 'Generate Trades Report'}
                                                </button>
                                            </div>
                                        </div>

                                        {mrReport && (
                                            <div className="table-container fade-in">
                                                <table className="option-chain-table">
                                                    <thead>
                                                        <tr>
                                                            <th style={{ textAlign: 'center' }}>Entry Z</th>
                                                            <th style={{ textAlign: 'center' }}>Total Trades</th>
                                                            <th style={{ textAlign: 'right' }}>Win Rate (%)</th>
                                                            <th style={{ textAlign: 'right' }}>Total Option P&L</th>
                                                            <th style={{ textAlign: 'right' }}>Max Drawdown</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {mrReport.map((r: any, idx: number) => (
                                                            <tr key={idx}>
                                                                <td style={{ textAlign: 'center', fontWeight: 800, color: 'var(--purple)' }}>±{r.entryZ.toFixed(1)}</td>
                                                                <td style={{ textAlign: 'center' }}>{r.totalTrades}</td>
                                                                <td style={{ textAlign: 'right', fontWeight: 700, color: parseFloat(r.winRate) >= 50 ? 'var(--green)' : 'var(--red)' }}>{r.winRate}%</td>
                                                                <td style={{ textAlign: 'right', fontWeight: 800, color: parseFloat(r.totalPnl) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                                                    {parseFloat(r.totalPnl) >= 0 ? '+' : ''}{r.totalPnl}
                                                                </td>
                                                                <td style={{ textAlign: 'right', color: 'var(--red)', fontWeight: 600 }}>-{r.maxDrawdown}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
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

            {/* ────── Mean Reversion Multi-Expiry Backtest Modal ────── */}
            {mrMultiModalOpen && (
                <div
                    style={{
                        position: 'fixed', inset: 0, zIndex: 3000,
                        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
                        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
                        paddingTop: 32, paddingBottom: 32, overflowY: 'auto'
                    }}
                    onClick={e => { if (e.target === e.currentTarget) setMrMultiModalOpen(false); }}
                >
                    <div style={{
                        width: '96%', maxWidth: 1200,
                        background: 'var(--bg-secondary)',
                        borderRadius: 16,
                        border: '1px solid rgba(16,185,129,0.3)',
                        boxShadow: '0 40px 80px rgba(0,0,0,0.6)',
                        overflow: 'hidden',
                    }}>
                        {/* Modal Header */}
                        <div style={{
                            padding: '16px 24px',
                            borderBottom: '1px solid var(--border-color)',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            background: 'linear-gradient(90deg, rgba(16,185,129,0.08), rgba(59,130,246,0.08))'
                        }}>
                            <div>
                                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    🔬 Test Mean Reversion Strategy — Last {mrMultiResult?.params?.num_expiries ?? 10} Expiries
                                </div>
                                {mrMultiResult?.params && (
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 16 }}>
                                        <span>Window: <strong>{mrMultiResult.params.window}</strong></span>
                                        <span>Entry Z: <strong>±{mrMultiResult.params.entry_z}</strong></span>
                                        <span>Exit Z: <strong>{mrMultiResult.params.exit_z}</strong></span>
                                        <span>Stop Z: <strong>±{mrMultiResult.params.stop_z}</strong></span>
                                        <span>Trading Hours: <strong>{mrMultiResult.params.trading_hours_only ? 'Yes' : 'No'}</strong></span>
                                        {mrMultiResult.params.auto_lots
                                            ? <span>Lots: <strong>Auto (Budget ₹{mrMultiResult.params.initial_budget?.toLocaleString()})</strong></span>
                                            : <span>Lots: <strong>{mrMultiResult.params.num_lots} × {mrMultiResult.params.lot_size} = {mrMultiResult.params.num_lots * mrMultiResult.params.lot_size} units</strong></span>
                                        }
                                        {mrMultiResult.time_ms && <span style={{ color: 'var(--text-muted)' }}>⏱ {mrMultiResult.time_ms}ms</span>}
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={() => setMrMultiModalOpen(false)}
                                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: '4px 8px' }}
                            >×</button>
                        </div>

                        <div style={{ padding: 24 }}>
                            {/* Loading */}
                            {mrMultiLoading && (
                                <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                                    <div className="spinner" style={{ margin: '0 auto 20px', width: 44, height: 44, borderColor: 'rgba(16,185,129,0.2)', borderTopColor: '#10b981' }} />
                                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)' }}>Running parameter sweep across last {mrNumExpiries} expiries...</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Loading index data, computing Z-scores and fetching option prices</div>
                                </div>
                            )}

                            {/* Error */}
                            {!mrMultiLoading && mrMultiResult?.error && (
                                <div style={{ padding: 24, textAlign: 'center', color: 'var(--red)' }}>
                                    <div style={{ fontSize: 24, marginBottom: 12 }}>⚠</div>
                                    <div style={{ fontWeight: 700 }}>{mrMultiResult.error}</div>
                                </div>
                            )}

                            {/* Results */}
                            {!mrMultiLoading && mrMultiResult && !mrMultiResult.error && (
                                <>
                                    {/* ── Parameter Sweep Section ── */}
                                    {mrMultiResult.param_sweep && mrMultiResult.param_sweep.length > 0 && (() => {
                                        const best = mrMultiResult.param_sweep[0];
                                        const bestPnlPos = best.total_pnl >= 0;
                                        return (
                                            <div style={{ marginBottom: 24 }}>
                                                {/* Best Combo Banner */}
                                                <div style={{
                                                    padding: '14px 18px', marginBottom: 12,
                                                    background: bestPnlPos ? 'rgba(234,179,8,0.08)' : 'rgba(239,68,68,0.06)',
                                                    border: `1px solid ${bestPnlPos ? 'rgba(234,179,8,0.45)' : 'rgba(239,68,68,0.3)'}`,
                                                    borderRadius: 10, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap'
                                                }}>
                                                    <span style={{ fontSize: 20 }}>🏆</span>
                                                    <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                                                        Best Combination
                                                    </div>
                                                    {[
                                                        { label: 'Window', value: best.window },
                                                        { label: 'Entry Z', value: `±${best.entry_z}` },
                                                        { label: 'Exit Z', value: best.exit_z },
                                                        { label: 'Stop Z', value: `±${best.stop_z}` },
                                                        { label: 'Trades', value: best.total_trades },
                                                        { label: 'Win Rate', value: `${best.win_rate}%` },
                                                        { label: 'Total P&L', value: `${best.total_pnl >= 0 ? '+' : ''}${best.total_pnl}`, color: bestPnlPos ? 'var(--green)' : 'var(--red)', bold: true },
                                                        { label: 'Profit Factor', value: best.profit_factor != null ? best.profit_factor : '—' },
                                                        { label: 'Sharpe', value: best.sharpe },
                                                    ].map((item, i) => (
                                                        <div key={i} style={{ textAlign: 'center' }}>
                                                            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>{item.label}</div>
                                                            <div style={{ fontSize: 15, fontWeight: item.bold ? 900 : 700, color: item.color ?? 'var(--text-primary)' }}>{item.value}</div>
                                                        </div>
                                                    ))}
                                                </div>

                                                {/* Full sweep table */}
                                                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                                                    Parameter Sweep — All {mrMultiResult.param_sweep.length} Combinations (sorted by Total P&L)
                                                </div>

                                                {/* Filter Controls */}
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10, padding: '10px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }}>
                                                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', width: '100%', marginBottom: 2 }}>Filters</div>
                                                    {([
                                                        { label: 'Window', val: swpFilterWindow, set: setSwpFilterWindow, ph: 'e.g. 20', w: 72 },
                                                        { label: 'Entry Z', val: swpFilterEntryZ, set: setSwpFilterEntryZ, ph: 'e.g. 2.0', w: 72 },
                                                        { label: 'Exit Z', val: swpFilterExitZ, set: setSwpFilterExitZ, ph: 'e.g. 0.5', w: 72 },
                                                        { label: 'Stop Z', val: swpFilterStopZ, set: setSwpFilterStopZ, ph: 'e.g. 3.5', w: 72 },
                                                        { label: 'Min Win%', val: swpFilterMinWinRate, set: setSwpFilterMinWinRate, ph: 'e.g. 50', w: 76 },
                                                        { label: 'Min P&L', val: swpFilterMinPnl, set: setSwpFilterMinPnl, ph: 'e.g. 1000', w: 88 },
                                                        { label: 'Min PF', val: swpFilterMinPF, set: setSwpFilterMinPF, ph: 'e.g. 1.5', w: 72 },
                                                    ] as { label: string; val: string; set: (v: string) => void; ph: string; w: number }[]).map(f => (
                                                        <div key={f.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                            <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>{f.label}</span>
                                                            <input
                                                                type="number"
                                                                placeholder={f.ph}
                                                                value={f.val}
                                                                onChange={e => f.set(e.target.value)}
                                                                style={{ height: 26, padding: '0 6px', width: f.w, fontSize: 11, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                                                            />
                                                        </div>
                                                    ))}
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'flex-end' }}>
                                                        <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Profitable Only</span>
                                                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', height: 26 }}>
                                                            <input type="checkbox" checked={swpFilterOnlyProfit} onChange={e => setSwpFilterOnlyProfit(e.target.checked)} />
                                                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Yes</span>
                                                        </label>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                                                        <button
                                                            onClick={() => { setSwpFilterWindow(''); setSwpFilterEntryZ(''); setSwpFilterExitZ(''); setSwpFilterStopZ(''); setSwpFilterMinWinRate(''); setSwpFilterMinPnl(''); setSwpFilterMinPF(''); setSwpFilterOnlyProfit(false); }}
                                                            style={{ height: 26, padding: '0 10px', fontSize: 10, borderRadius: 4, border: '1px solid var(--border)', background: 'rgba(239,68,68,0.1)', color: 'var(--red)', cursor: 'pointer', fontWeight: 700 }}
                                                        >Clear</button>
                                                    </div>
                                                </div>

                                                {/* Filtered & displayed sweep rows */}
                                                {(() => {
                                                    const rows: any[] = mrMultiResult.param_sweep.filter((ps: any) => {
                                                        if (swpFilterWindow    !== '' && Number(ps.window)   !== Number(swpFilterWindow))   return false;
                                                        if (swpFilterEntryZ    !== '' && Number(ps.entry_z)  !== Number(swpFilterEntryZ))   return false;
                                                        if (swpFilterExitZ     !== '' && Number(ps.exit_z)   !== Number(swpFilterExitZ))    return false;
                                                        if (swpFilterStopZ     !== '' && Number(ps.stop_z)   !== Number(swpFilterStopZ))    return false;
                                                        if (swpFilterMinWinRate !== '' && ps.win_rate < Number(swpFilterMinWinRate))        return false;
                                                        if (swpFilterMinPnl    !== '' && ps.total_pnl < Number(swpFilterMinPnl))           return false;
                                                        if (swpFilterMinPF     !== '' && (ps.profit_factor == null || ps.profit_factor < Number(swpFilterMinPF))) return false;
                                                        if (swpFilterOnlyProfit && ps.total_pnl <= 0)                                      return false;
                                                        return true;
                                                    });
                                                    return (
                                                        <div>
                                                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>Showing {rows.length} of {mrMultiResult.param_sweep.length} combinations</div>
                                                            <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 8 }}>
                                                                <table className="option-chain-table" style={{ fontSize: 11 }}>
                                                                    <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-secondary)' }}>
                                                                        <tr>
                                                                            <th style={{ textAlign: 'center' }}>#</th>
                                                                            <th style={{ textAlign: 'center' }}>Window</th>
                                                                            <th style={{ textAlign: 'center' }}>Entry Z</th>
                                                                            <th style={{ textAlign: 'center' }}>Exit Z</th>
                                                                            <th style={{ textAlign: 'center' }}>Stop Z</th>
                                                                            <th style={{ textAlign: 'center' }}>Trades</th>
                                                                            <th style={{ textAlign: 'right' }}>Win Rate</th>
                                                                            <th style={{ textAlign: 'right' }}>Total P&L</th>
                                                                            <th style={{ textAlign: 'right' }}>Profit Factor</th>
                                                                            <th style={{ textAlign: 'right' }}>Max DD</th>
                                                                            <th style={{ textAlign: 'right' }}>Sharpe</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {rows.map((ps: any, pi: number) => {
                                                                            const pPos = ps.total_pnl >= 0;
                                                                            const isTop = pi === 0;
                                                                            return (
                                                                                <tr key={`${ps.window}_${ps.entry_z}_${ps.exit_z}_${ps.stop_z}`} style={{
                                                                                    background: isTop ? 'rgba(234,179,8,0.07)' : 'inherit',
                                                                                    borderLeft: isTop ? '3px solid rgba(234,179,8,0.6)' : '3px solid transparent',
                                                                                }}>
                                                                                    <td style={{ textAlign: 'center', color: isTop ? 'rgb(234,179,8)' : 'var(--text-muted)', fontWeight: isTop ? 800 : 400 }}>{pi + 1}</td>
                                                                                    <td style={{ textAlign: 'center', fontWeight: 600 }}>{ps.window}</td>
                                                                                    <td style={{ textAlign: 'center', fontWeight: 700 }}>±{ps.entry_z}</td>
                                                                                    <td style={{ textAlign: 'center' }}>{ps.exit_z}</td>
                                                                                    <td style={{ textAlign: 'center' }}>±{ps.stop_z}</td>
                                                                                    <td style={{ textAlign: 'center' }}>{ps.total_trades}</td>
                                                                                    <td style={{ textAlign: 'right', color: ps.win_rate >= 50 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{ps.win_rate}%</td>
                                                                                    <td style={{ textAlign: 'right', fontWeight: 800, color: pPos ? 'var(--green)' : 'var(--red)' }}>{pPos ? '+' : ''}{ps.total_pnl}</td>
                                                                                    <td style={{ textAlign: 'right', color: ps.profit_factor != null && ps.profit_factor >= 1.5 ? 'var(--green)' : 'var(--text-muted)' }}>{ps.profit_factor ?? '—'}</td>
                                                                                    <td style={{ textAlign: 'right', color: 'var(--red)' }}>{ps.max_drawdown}</td>
                                                                                    <td style={{ textAlign: 'right', color: ps.sharpe > 0 ? 'var(--green)' : 'var(--text-muted)' }}>{ps.sharpe}</td>
                                                                                </tr>
                                                                            );
                                                                        })}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        );
                                    })()}

                                    {/* ── Summary Card ── */}
                                    {mrMultiResult.summary && (() => {
                                        const s = mrMultiResult.summary;
                                        const pnlPositive = s.total_pnl >= 0;
                                        return (
                                            <div style={{
                                                marginBottom: 24, padding: '20px',
                                                background: pnlPositive ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
                                                border: `1px solid ${pnlPositive ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
                                                borderRadius: 12
                                            }}>
                                                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>
                                                    Consolidated Summary
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                                                    {[
                                                        { label: 'Total P&L', value: `${pnlPositive ? '+' : ''}${s.total_pnl}`, color: pnlPositive ? 'var(--green)' : 'var(--red)', big: true },
                                                        { label: 'Win Rate', value: `${s.win_rate}%`, color: s.win_rate >= 50 ? 'var(--green)' : 'var(--red)', big: true },
                                                        { label: 'Profit Factor', value: s.profit_factor != null ? s.profit_factor : '—', color: s.profit_factor != null && s.profit_factor >= 1.5 ? 'var(--green)' : 'var(--yellow)', big: true },
                                                        { label: 'Total Trades', value: s.total_trades, color: 'var(--text-primary)', big: true },
                                                    ].map((m, i) => (
                                                        <div key={i} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '14px 16px', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
                                                            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>{m.label}</div>
                                                            <div style={{ fontSize: 22, fontWeight: 900, color: m.color }}>{m.value}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                                                    {[
                                                        { label: 'Profitable Expiries', value: `${s.profitable_expiries} / ${s.total_expiries}`, color: 'var(--text-primary)' },
                                                        { label: 'Wins / Losses', value: `${s.total_wins} / ${s.total_losses}`, color: 'var(--text-muted)' },
                                                        { label: 'Gross Profit', value: `+${s.gross_profit}`, color: 'var(--green)' },
                                                        { label: 'Gross Loss', value: `-${s.gross_loss}`, color: 'var(--red)' },
                                                    ].map((m, i) => (
                                                        <div key={i} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 8, padding: '10px 12px', border: '1px solid rgba(255,255,255,0.04)', textAlign: 'center' }}>
                                                            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>{m.label}</div>
                                                            <div style={{ fontSize: 14, fontWeight: 700, color: m.color }}>{m.value}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                                {s.final_capital != null && (
                                                    <div style={{ marginTop: 12, display: 'flex', gap: 20, fontSize: 11, padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
                                                        <span style={{ color: 'var(--text-muted)' }}>Initial Budget: <strong style={{ color: 'var(--text-primary)' }}>₹{s.initial_budget?.toLocaleString()}</strong></span>
                                                        <span style={{ color: s.final_capital >= s.initial_budget ? 'var(--green)' : 'var(--red)' }}>Final Capital: <strong>₹{s.final_capital?.toLocaleString()}</strong></span>
                                                        <span style={{ color: s.final_capital >= s.initial_budget ? 'var(--green)' : 'var(--red)', fontWeight: 800 }}>ROI: <strong>{s.initial_budget > 0 ? `${((s.final_capital - s.initial_budget) / s.initial_budget * 100).toFixed(1)}%` : '—'}</strong></span>
                                                    </div>
                                                )}
                                                {(s.best_expiry || s.worst_expiry) && (
                                                    <div style={{ marginTop: 12, display: 'flex', gap: 12, fontSize: 11 }}>
                                                        {s.best_expiry && (
                                                            <span style={{ color: 'var(--green)' }}>
                                                                🏆 Best: <strong>{s.best_expiry.date}</strong> (+{s.best_expiry.pnl})
                                                            </span>
                                                        )}
                                                        {s.worst_expiry && (
                                                            <span style={{ color: 'var(--red)' }}>
                                                                ⚠ Worst: <strong>{s.worst_expiry.date}</strong> ({s.worst_expiry.pnl})
                                                            </span>
                                                        )}
                                                        <span style={{ color: 'var(--text-muted)' }}>
                                                            Avg P&L/Expiry: <strong style={{ color: s.avg_pnl_per_expiry >= 0 ? 'var(--green)' : 'var(--red)' }}>{s.avg_pnl_per_expiry >= 0 ? '+' : ''}{s.avg_pnl_per_expiry}</strong>
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}

                                    {/* ── Per-Expiry Table ── */}
                                    {mrMultiResult.results && (
                                        <div>
                                            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                                                Per-Expiry Results — click a row to see trades
                                            </div>
                                            <div className="table-container" style={{ marginBottom: 20 }}>
                                                <table className="option-chain-table">
                                                    <thead>
                                                        <tr>
                                                            <th>#</th>
                                                            <th>Expiry</th>
                                                            <th style={{ textAlign: 'center' }}>Trades</th>
                                                            <th style={{ textAlign: 'center' }}>W / L</th>
                                                            <th style={{ textAlign: 'right' }}>Win Rate</th>
                                                            <th style={{ textAlign: 'right' }}>Total P&L</th>
                                                            <th style={{ textAlign: 'right' }}>Profit Factor</th>
                                                            <th style={{ textAlign: 'right' }}>Max DD</th>
                                                            <th style={{ textAlign: 'right' }}>Sharpe</th>
                                                            <th style={{ textAlign: 'center' }}>Status</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {mrMultiResult.results.map((r: any, idx: number) => {
                                                            const m = r.metrics;
                                                            const hasError = !!r.error;
                                                            const selected = mrMultiSelectedExpiry === r.expiry;
                                                            return (
                                                                <tr
                                                                    key={idx}
                                                                    onClick={() => setMrMultiSelectedExpiry(selected ? null : r.expiry)}
                                                                    style={{
                                                                        cursor: 'pointer',
                                                                        background: selected ? 'rgba(16,185,129,0.08)' : 'inherit',
                                                                        borderLeft: selected ? '3px solid #10b981' : '3px solid transparent',
                                                                    }}
                                                                >
                                                                    <td style={{ color: 'var(--text-muted)', fontSize: 10 }}>{idx + 1}</td>
                                                                    <td>
                                                                        <div style={{ fontWeight: 700, fontSize: 12 }}>{r.expiry_date || r.expiry}</div>
                                                                        <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{r.expiry}</div>
                                                                    </td>
                                                                    <td style={{ textAlign: 'center' }}>{hasError ? '—' : (m?.total_trades ?? 0)}</td>
                                                                    <td style={{ textAlign: 'center', fontSize: 11 }}>
                                                                        {hasError ? '—' : (
                                                                            <span>
                                                                                <strong style={{ color: 'var(--green)' }}>{m?.wins ?? 0}</strong>
                                                                                <span style={{ color: 'var(--text-muted)' }}> / </span>
                                                                                <strong style={{ color: 'var(--red)' }}>{m?.losses ?? 0}</strong>
                                                                            </span>
                                                                        )}
                                                                    </td>
                                                                    <td style={{ textAlign: 'right', color: m?.win_rate >= 50 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                                                                        {hasError ? '—' : `${m?.win_rate ?? 0}%`}
                                                                    </td>
                                                                    <td style={{ textAlign: 'right', fontWeight: 800, color: m?.total_pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                                                        {hasError ? '—' : `${m?.total_pnl >= 0 ? '+' : ''}${m?.total_pnl ?? 0}`}
                                                                    </td>
                                                                    <td style={{ textAlign: 'right', color: m?.profit_factor != null && m.profit_factor >= 1.5 ? 'var(--green)' : 'var(--yellow)' }}>
                                                                        {hasError ? '—' : (m?.profit_factor != null ? m.profit_factor : '—')}
                                                                    </td>
                                                                    <td style={{ textAlign: 'right', color: 'var(--red)' }}>
                                                                        {hasError ? '—' : `-${m?.max_drawdown ?? 0}`}
                                                                    </td>
                                                                    <td style={{ textAlign: 'right', color: m?.sharpe >= 1.5 ? 'var(--green)' : m?.sharpe >= 0 ? 'var(--yellow)' : 'var(--red)' }}>
                                                                        {hasError ? '—' : (m?.sharpe ?? 0)}
                                                                    </td>
                                                                    <td style={{ textAlign: 'center' }}>
                                                                        {hasError ? (
                                                                            <span style={{ fontSize: 9, color: 'var(--red)', background: 'rgba(239,68,68,0.1)', padding: '2px 6px', borderRadius: 4 }} title={r.error}>Error</span>
                                                                        ) : m?.total_trades === 0 ? (
                                                                            <span style={{ fontSize: 9, color: 'var(--text-muted)', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4 }}>No Trades</span>
                                                                        ) : m?.total_pnl > 0 ? (
                                                                            <span style={{ fontSize: 9, color: 'var(--green)', background: 'rgba(16,185,129,0.1)', padding: '2px 6px', borderRadius: 4 }}>Profitable</span>
                                                                        ) : (
                                                                            <span style={{ fontSize: 9, color: 'var(--red)', background: 'rgba(239,68,68,0.1)', padding: '2px 6px', borderRadius: 4 }}>Loss</span>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>

                                            {/* ── Expanded Trade Detail for Selected Expiry ── */}
                                            {mrMultiSelectedExpiry && (() => {
                                                const sel = mrMultiResult.results.find((r: any) => r.expiry === mrMultiSelectedExpiry);
                                                if (!sel || sel.trades.length === 0) return (
                                                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                                                        {sel?.error ? `Error: ${sel.error}` : 'No trades for this expiry.'}
                                                    </div>
                                                );
                                                return (
                                                    <div className="fade-in" style={{ marginTop: 8 }}>
                                                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <span>Trade Details — {sel.expiry_date || sel.expiry} ({sel.trades.length} trades)</span>
                                                            {sel.metrics && (
                                                                <span style={{ fontSize: 11, color: sel.metrics.total_pnl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                                                                    P&L: {sel.metrics.total_pnl >= 0 ? '+' : ''}{sel.metrics.total_pnl} | WR: {sel.metrics.win_rate}% | PF: {sel.metrics.profit_factor ?? '—'}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="table-container" style={{ maxHeight: 340, overflowY: 'auto' }}>
                                                            <table className="option-chain-table">
                                                                <thead>
                                                                    <tr>
                                                                        <th>#</th>
                                                                        <th>Opt</th>
                                                                        <th>Strike</th>
                                                                        <th>Entry Time</th>
                                                                        <th style={{ textAlign: 'right' }}>Entry Z</th>
                                                                        <th style={{ textAlign: 'right' }}>Idx Entry</th>
                                                                        <th style={{ textAlign: 'right' }}>Opt Entry</th>
                                                                        <th>Exit Time</th>
                                                                        <th style={{ textAlign: 'right' }}>Exit Z</th>
                                                                        <th style={{ textAlign: 'right' }}>Idx Exit</th>
                                                                        <th style={{ textAlign: 'right' }}>Opt Exit</th>
                                                                        <th>Reason</th>
                                                                        <th style={{ textAlign: 'center' }}>Lots</th>
                                                                        <th style={{ textAlign: 'right' }}>Capital In</th>
                                                                        <th style={{ textAlign: 'right' }}>Opt P&L</th>
                                                                        <th style={{ textAlign: 'right' }}>Bars</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {sel.trades.map((t: any) => (
                                                                        <tr key={t.num}>
                                                                            <td style={{ color: 'var(--text-muted)', fontSize: 10 }}>{t.num}</td>
                                                                            <td>
                                                                                <span style={{
                                                                                    fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
                                                                                    background: t.option_type === 'CE' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                                                                                    color: t.option_type === 'CE' ? '#10b981' : '#ef4444'
                                                                                }}>{t.option_type}</span>
                                                                            </td>
                                                                            <td style={{ fontWeight: 700, fontSize: 11 }}>{t.strike}</td>
                                                                            <td style={{ fontSize: 10 }}>
                                                                                <div>{t.entry_time}</div>
                                                                            </td>
                                                                            <td style={{ textAlign: 'right', fontSize: 10, color: t.entry_z < 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                                                                                {t.entry_z >= 0 ? '+' : ''}{t.entry_z}
                                                                            </td>
                                                                            <td style={{ textAlign: 'right', fontSize: 10, color: 'var(--text-muted)' }}>{t.entry_price}</td>
                                                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                                                                {t.opt_entry != null ? t.opt_entry : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                                                            </td>
                                                                            <td style={{ fontSize: 10 }}>
                                                                                <div>{t.exit_time}</div>
                                                                            </td>
                                                                            <td style={{ textAlign: 'right', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>
                                                                                {t.exit_z >= 0 ? '+' : ''}{t.exit_z}
                                                                            </td>
                                                                            <td style={{ textAlign: 'right', fontSize: 10, color: 'var(--text-muted)' }}>{t.exit_price}</td>
                                                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                                                                {t.opt_exit != null ? t.opt_exit : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                                                            </td>
                                                                            <td>
                                                                                <span style={{
                                                                                    fontSize: 9, padding: '2px 6px', borderRadius: 4,
                                                                                    background: t.exit_reason === 'Stop Loss' ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
                                                                                    color: t.exit_reason === 'Stop Loss' ? 'var(--red)' : 'var(--green)'
                                                                                }}>{t.exit_reason}</span>
                                                                            </td>
                                                                            <td style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--purple)' }}>{t.lots ?? '—'}</td>
                                                                            <td style={{ textAlign: 'right', fontSize: 10, color: 'var(--text-muted)' }}>
                                                                                {t.capital_before != null ? `₹${t.capital_before.toLocaleString()}` : '—'}
                                                                            </td>
                                                                            <td style={{
                                                                                textAlign: 'right', fontWeight: 800, fontSize: 12,
                                                                                color: t.opt_pnl == null ? 'var(--text-muted)' : t.opt_pnl > 0 ? 'var(--green)' : t.opt_pnl < 0 ? 'var(--red)' : 'var(--text-muted)'
                                                                            }}>
                                                                                {t.opt_pnl != null ? `${t.opt_pnl > 0 ? '+' : ''}${t.opt_pnl}` : '—'}
                                                                            </td>
                                                                            <td style={{ textAlign: 'right', fontSize: 10, color: 'var(--text-muted)' }}>{t.duration_bars}</td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
}
