import { create } from 'zustand';

// --- Strategy Store ---
interface StrategyState {
    strategies: any[];
    selectedStrategy: any | null;
    templates: any[];
    loading: boolean;
    setStrategies: (s: any[]) => void;
    setSelectedStrategy: (s: any) => void;
    setTemplates: (t: any[]) => void;
    setLoading: (l: boolean) => void;
}

export const useStrategyStore = create<StrategyState>((set) => ({
    strategies: [],
    selectedStrategy: null,
    templates: [],
    loading: false,
    setStrategies: (strategies) => set({ strategies }),
    setSelectedStrategy: (selectedStrategy) => set({ selectedStrategy }),
    setTemplates: (templates) => set({ templates }),
    setLoading: (loading) => set({ loading }),
}));

// --- Backtest Store ---
interface BacktestState {
    results: any[];
    currentResult: any | null;
    trades: any[];
    isRunning: boolean;
    animationFrames: any[];
    animationIndex: number;
    isPlaying: boolean;
    setResults: (r: any[]) => void;
    setCurrentResult: (r: any) => void;
    setTrades: (t: any[]) => void;
    setIsRunning: (r: boolean) => void;
    setAnimationFrames: (f: any[]) => void;
    setAnimationIndex: (i: number) => void;
    setIsPlaying: (p: boolean) => void;
}

export const useBacktestStore = create<BacktestState>((set) => ({
    results: [],
    currentResult: null,
    trades: [],
    isRunning: false,
    animationFrames: [],
    animationIndex: 0,
    isPlaying: false,
    setResults: (results) => set({ results }),
    setCurrentResult: (currentResult) => set({ currentResult }),
    setTrades: (trades) => set({ trades }),
    setIsRunning: (isRunning) => set({ isRunning }),
    setAnimationFrames: (animationFrames) => set({ animationFrames }),
    setAnimationIndex: (animationIndex) => set({ animationIndex }),
    setIsPlaying: (isPlaying) => set({ isPlaying }),
}));

// --- Data Store ---
interface DataState {
    expiries: any[];
    selectedExpiry: string;
    optionChain: any[];
    indexData: any[];
    globalUseUnified: boolean;
    setExpiries: (e: any[]) => void;
    setSelectedExpiry: (e: string) => void;
    setOptionChain: (d: any[]) => void;
    setIndexData: (d: any[]) => void;
    setGlobalUseUnified: (v: boolean) => void;
}

export const useDataStore = create<DataState>((set) => ({
    expiries: [],
    selectedExpiry: '',
    optionChain: [],
    indexData: [],
    globalUseUnified: true,
    setExpiries: (expiries) => set({ expiries }),
    setSelectedExpiry: (selectedExpiry) => set({ selectedExpiry }),
    setOptionChain: (optionChain) => set({ optionChain }),
    setIndexData: (indexData) => set({ indexData }),
    setGlobalUseUnified: (globalUseUnified) => set({ globalUseUnified }),
}));

// --- UI Store ---
interface UIState {
    sidebarOpen: boolean;
    activePage: string;
    theme: 'dark' | 'light';
    notifications: { id: string; message: string; type: string }[];
    toggleSidebar: () => void;
    setActivePage: (p: string) => void;
    addNotification: (msg: string, type?: string) => void;
    removeNotification: (id: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
    sidebarOpen: true,
    activePage: 'dashboard',
    theme: 'dark',
    notifications: [],
    toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    setActivePage: (activePage) => set({ activePage }),
    addNotification: (message, type = 'info') =>
        set((s) => ({
            notifications: [...s.notifications, { id: Date.now().toString(), message, type }],
        })),
    removeNotification: (id) =>
        set((s) => ({
            notifications: s.notifications.filter((n) => n.id !== id),
        })),
}));
