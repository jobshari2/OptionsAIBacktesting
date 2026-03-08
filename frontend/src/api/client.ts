const API_BASE = 'http://localhost:8000';

async function fetchJSON(url: string, options?: RequestInit) {
    const res = await fetch(`${API_BASE}${url}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
}

import { formatToApiDate } from '../utils/date';

// --- Data APIs ---
export const dataApi = {
    getExpiries: (startDate?: string, endDate?: string) => {
        const params = new URLSearchParams();
        if (startDate) params.set('start_date', formatToApiDate(startDate) || '');
        if (endDate) params.set('end_date', formatToApiDate(endDate) || '');
        return fetchJSON(`/api/data/expiries?${params}`);
    },
    getOptionChain: (expiry: string, timestamp?: string, useUnified?: boolean) => {
        const params = new URLSearchParams({ expiry });
        if (timestamp) params.set('timestamp', timestamp);
        if (useUnified !== undefined) params.set('use_unified', String(useUnified));
        return fetchJSON(`/api/data/option-chain?${params}`);
    },
    getIndexData: (expiry: string) =>
        fetchJSON(`/api/data/index-data?expiry=${expiry}`),
    getFuturesData: (expiry: string) =>
        fetchJSON(`/api/data/futures-data?expiry=${expiry}`),
    getCacheInfo: () => fetchJSON('/api/data/cache-info'),
    clearCache: () => fetchJSON('/api/data/clear-cache', { method: 'POST' }),
    runBenchmark: (count: number = 5) => fetchJSON(`/api/data/benchmark?count=${count}`),
    getConfig: () => fetchJSON('/api/data/config'),
    setConfig: (useUnified: boolean) => fetchJSON('/api/data/config', { method: 'POST', body: JSON.stringify({ use_unified: useUnified }) }),
    getOISpikes: (expiry: string, threshold: number = 0.5, volThreshold: number = 0.5, minLtp: number = 0, useUnified?: boolean) => {
        const params = new URLSearchParams({
            expiry,
            threshold: String(threshold),
            vol_threshold: String(volThreshold),
            min_ltp: String(minLtp)
        });
        if (useUnified !== undefined) params.set('use_unified', String(useUnified));
        return fetchJSON(`/api/data/oi-spikes?${params}`);
    },
};

// --- Strategy APIs ---
export const strategyApi = {
    list: () => fetchJSON('/api/strategies/'),
    getTemplates: () => fetchJSON('/api/strategies/templates'),
    get: (name: string) => fetchJSON(`/api/strategies/${name}`),
    create: (data: any) =>
        fetchJSON('/api/strategies/', { method: 'POST', body: JSON.stringify(data) }),
    update: (name: string, data: any) =>
        fetchJSON(`/api/strategies/${name}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (name: string) =>
        fetchJSON(`/api/strategies/${name}`, { method: 'DELETE' }),
};

// --- Backtest APIs ---
export const backtestApi = {
    run: (data: any) => {
        const payload = { ...data };
        if (payload.start_date) payload.start_date = formatToApiDate(payload.start_date);
        if (payload.end_date) payload.end_date = formatToApiDate(payload.end_date);
        return fetchJSON('/api/backtest/run', { method: 'POST', body: JSON.stringify(payload) });
    },
    getStatus: (runId: string) => fetchJSON(`/api/backtest/status/${runId}`),
    stop: (runId: string) => fetchJSON(`/api/backtest/stop/${runId}`, { method: 'POST' }),
    listResults: () => fetchJSON('/api/backtest/results'),
    getResult: (runId: string) => fetchJSON(`/api/backtest/results/${runId}`),
    getTrades: (runId: string) => fetchJSON(`/api/backtest/trades/${runId}`),
    getAnimation: (data: any) =>
        fetchJSON('/api/backtest/animation', { method: 'POST', body: JSON.stringify(data) }),
};

// --- Analytics APIs ---
export const analyticsApi = {
    getMetrics: (runId: string) => fetchJSON(`/api/analytics/metrics/${runId}`),
    getPayoff: (data: any) =>
        fetchJSON('/api/analytics/payoff', { method: 'POST', body: JSON.stringify(data) }),
    getGreeks: (data: any) =>
        fetchJSON('/api/analytics/greeks', { method: 'POST', body: JSON.stringify(data) }),
    getIV: (data: any) =>
        fetchJSON('/api/analytics/implied-volatility', { method: 'POST', body: JSON.stringify(data) }),
    compare: (runIds: string[]) =>
        fetchJSON(`/api/analytics/compare?run_ids=${runIds.join(',')}`),
};

// --- AI APIs ---
export const aiApi = {
    optimize: (data: any) => {
        const payload = { ...data };
        if (payload.start_date) payload.start_date = formatToApiDate(payload.start_date);
        if (payload.end_date) payload.end_date = formatToApiDate(payload.end_date);
        return fetchJSON('/api/ai/optimize', { method: 'POST', body: JSON.stringify(payload) });
    },
    getLearningHistory: (strategyName?: string) => {
        const params = strategyName ? `?strategy_name=${strategyName}` : '';
        return fetchJSON(`/api/ai/learning-history${params}`);
    },
    getParameterChanges: (strategyName?: string) => {
        const params = strategyName ? `?strategy_name=${strategyName}` : '';
        return fetchJSON(`/api/ai/parameter-changes${params}`);
    },
    getSuggestions: (strategyName: string) =>
        fetchJSON(`/api/ai/suggestions/${strategyName}`),
    getModels: () =>
        fetchJSON('/api/ai/models'),
    analyzeChain: async (payload: {
        expiry: string;
        spot_price: number;
        futures_price: number;
        option_chain: any[];
        spikes: any[];
        model_name?: string;
    }) => {
        return fetchJSON('/api/ai/analyze-chain', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }
};

// --- Intelligence Engine APIs ---
export const intelligenceApi = {
    getFeatures: (expiry: string) =>
        fetchJSON(`/api/intelligence/features/${expiry}`),
    getRegime: (expiry: string) =>
        fetchJSON(`/api/intelligence/regime/${expiry}`),
    getRegimeMapping: () =>
        fetchJSON('/api/intelligence/regime-mapping'),
    runIntelligentBacktest: (data: any) => {
        const payload = { ...data };
        if (payload.start_date) payload.start_date = formatToApiDate(payload.start_date);
        if (payload.end_date) payload.end_date = formatToApiDate(payload.end_date);
        return fetchJSON('/api/intelligence/run', { method: 'POST', body: JSON.stringify(payload) });
    },
    getExperience: (strategy?: string, regime?: string, limit?: number) => {
        const params = new URLSearchParams();
        if (strategy) params.set('strategy', strategy);
        if (regime) params.set('regime', regime);
        if (limit) params.set('limit', String(limit));
        return fetchJSON(`/api/intelligence/experience?${params}`);
    },
    getExperiencePerformance: (regime?: string) => {
        const params = regime ? `?regime=${regime}` : '';
        return fetchJSON(`/api/intelligence/experience/performance${params}`);
    },
    getExperienceSummary: () =>
        fetchJSON('/api/intelligence/experience/summary'),
    trainModel: () =>
        fetchJSON('/api/intelligence/train', { method: 'POST' }),
    getModelStatus: () =>
        fetchJSON('/api/intelligence/model-status'),
};

// --- Adaptive Engine APIs ---
export const adaptiveApi = {
    info: () => fetchJSON('/api/adaptive/'),
    listExpiries: (startDate?: string, endDate?: string) => {
        const params = new URLSearchParams();
        if (startDate) params.set('start_date', formatToApiDate(startDate) || '');
        if (endDate) params.set('end_date', formatToApiDate(endDate) || '');
        const qs = params.toString();
        return fetchJSON(`/api/adaptive/expiries${qs ? '?' + qs : ''}`);
    },
    run: (data: any) => {
        const payload = { ...data };
        if (payload.start_date) payload.start_date = formatToApiDate(payload.start_date);
        if (payload.end_date) payload.end_date = formatToApiDate(payload.end_date);
        return fetchJSON('/api/adaptive/run', { method: 'POST', body: JSON.stringify(payload) });
    },
    stop: (runId: string) =>
        fetchJSON(`/api/adaptive/stop/${runId}`, { method: 'POST' }),
    getStatus: (runId: string) =>
        fetchJSON(`/api/adaptive/status/${runId}`),
    getResult: (runId: string) =>
        fetchJSON(`/api/adaptive/result/${runId}`),
    getRiskDashboard: (runId: string) =>
        fetchJSON(`/api/adaptive/risk-dashboard/${runId}`),
    getAdjustments: (runId: string) =>
        fetchJSON(`/api/adaptive/adjustments/${runId}`),
    getGreeksTimeline: (runId: string) =>
        fetchJSON(`/api/adaptive/greeks-timeline/${runId}`),
    getPositionSnapshot: (runId: string, expiry: string) =>
        fetchJSON(`/api/adaptive/position-snapshot/${runId}/${expiry}`),
};

// --- ML API ---
export const mlApi = {
    getStatus: () => fetchJSON('/api/ml/status'),
    predict: (expiry: string, timestamp: string, useUnified: boolean = true) =>
        fetchJSON(`/api/ml/predict?expiry=${expiry}&timestamp=${timestamp}&use_unified=${useUnified}`, { method: 'POST' }),
    train: () => fetchJSON('/api/ml/train', { method: 'POST' }),
    getHistoricalPredictions: (expiry: string) => fetchJSON(`/api/ml/historical/${expiry}`),
};
