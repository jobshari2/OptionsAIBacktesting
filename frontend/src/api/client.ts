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

// --- Data APIs ---
export const dataApi = {
    getExpiries: (startDate?: string, endDate?: string) => {
        const params = new URLSearchParams();
        if (startDate) params.set('start_date', startDate);
        if (endDate) params.set('end_date', endDate);
        return fetchJSON(`/api/data/expiries?${params}`);
    },
    getOptionChain: (expiry: string, timestamp?: string) => {
        const params = new URLSearchParams({ expiry });
        if (timestamp) params.set('timestamp', timestamp);
        return fetchJSON(`/api/data/option-chain?${params}`);
    },
    getIndexData: (expiry: string) =>
        fetchJSON(`/api/data/index-data?expiry=${expiry}`),
    getFuturesData: (expiry: string) =>
        fetchJSON(`/api/data/futures-data?expiry=${expiry}`),
    getCacheInfo: () => fetchJSON('/api/data/cache-info'),
    clearCache: () => fetchJSON('/api/data/clear-cache', { method: 'POST' }),
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
    run: (data: any) =>
        fetchJSON('/api/backtest/run', { method: 'POST', body: JSON.stringify(data) }),
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
    optimize: (data: any) =>
        fetchJSON('/api/ai/optimize', { method: 'POST', body: JSON.stringify(data) }),
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
};
