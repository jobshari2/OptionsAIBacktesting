import './index.css';
import { useUIStore, useDataStore } from './stores/appStore';
import { useEffect } from 'react';
import { dataApi } from './api/client';
import Dashboard from './pages/Dashboard';
import StrategyBuilder from './pages/StrategyBuilder';
import BacktestDashboard from './pages/BacktestDashboard';
import TradeLog from './pages/TradeLog';
import OptionChainExplorer from './pages/OptionChainExplorer';
import StrategyAnimation from './pages/StrategyAnimation';
import StrategyComparison from './pages/StrategyComparison';
import AIOptimizer from './pages/AIOptimizer';
import IntelligenceEngine from './pages/IntelligenceEngine';
import AdaptiveDashboard from './pages/AdaptiveDashboard';
import DataPerformance from './pages/DataPerformance';
import MLPredictor from './pages/MLPredictor';

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊', section: 'Overview' },
  { id: 'strategy-builder', label: 'Strategy Builder', icon: '🔧', section: 'Trading' },
  { id: 'backtest', label: 'Backtest', icon: '⚡', section: 'Trading' },
  { id: 'trades', label: 'Trade Log', icon: '📋', section: 'Trading' },
  { id: 'comparison', label: 'Compare', icon: '⚖️', section: 'Trading' },
  { id: 'option-chain', label: 'Option Chain', icon: '🔗', section: 'Research' },
  { id: 'animation', label: 'Replay', icon: '▶️', section: 'Research' },
  { id: 'ai-optimizer', label: 'AI Optimizer', icon: '🤖', section: 'AI' },
  { id: 'intelligence', label: 'Intelligence Engine', icon: '🧠', section: 'AI' },
  { id: 'adaptive', label: 'Adaptive Engine', icon: '⚡', section: 'AI' },
  { id: 'ml-predict', label: 'Option Predictor', icon: '🔮', section: 'AI' },
  { id: 'performance', label: 'Performance', icon: '🚀', section: 'Research' },
];

function App() {
  const { activePage, setActivePage } = useUIStore();
  const { globalUseUnified, setGlobalUseUnified } = useDataStore();

  useEffect(() => {
    dataApi.getConfig()
      .then(res => setGlobalUseUnified(res.use_unified))
      .catch(console.error);
  }, []);

  const handleToggle = async (checked: boolean) => {
    setGlobalUseUnified(checked);
    try {
      await dataApi.setConfig(checked);
    } catch (e) {
      console.error("Failed to update global config", e);
    }
  };

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard': return <Dashboard />;
      case 'strategy-builder': return <StrategyBuilder />;
      case 'backtest': return <BacktestDashboard />;
      case 'trades': return <TradeLog />;
      case 'comparison': return <StrategyComparison />;
      case 'option-chain': return <OptionChainExplorer />;
      case 'animation': return <StrategyAnimation />;
      case 'ai-optimizer': return <AIOptimizer />;
      case 'intelligence': return <IntelligenceEngine />;
      case 'adaptive': return <AdaptiveDashboard />;
      case 'ml-predict': return <MLPredictor />;
      case 'performance': return <DataPerformance />;
      default: return <Dashboard />;
    }
  };

  const pageTitles: Record<string, { title: string; subtitle: string }> = {
    dashboard: { title: 'Dashboard', subtitle: 'Platform overview and recent activity' },
    'strategy-builder': { title: 'Strategy Builder', subtitle: 'Create and configure options strategies' },
    backtest: { title: 'Backtesting', subtitle: 'Run and analyze strategy backtests' },
    trades: { title: 'Trade Log', subtitle: 'Detailed trade history and analysis' },
    comparison: { title: 'Strategy Comparison', subtitle: 'Compare multiple backtest runs' },
    'option-chain': { title: 'Option Chain Explorer', subtitle: 'Historical option chain data' },
    animation: { title: 'Strategy Replay', subtitle: 'Minute-by-minute strategy animation' },
    'ai-optimizer': { title: 'AI Optimizer', subtitle: 'AI-powered strategy optimization' },
    intelligence: { title: 'Intelligence Engine', subtitle: 'ML-powered regime detection & adaptive strategy switching' },
    adaptive: { title: 'Adaptive Engine', subtitle: 'Full adaptive backtesting with adjustments, risk management & Greeks monitoring' },
    'ml-predict': { title: 'Option Predictor', subtitle: 'Short-term movement forecasting and ensemble ML signals' },
    performance: { title: 'Data Engine Performance', subtitle: 'Benchmark unified vs individual file loading speeds' },
  };

  const sections = [...new Set(navItems.map(n => n.section))];
  const info = pageTitles[activePage] || pageTitles.dashboard;

  return (
    <>
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon">N</div>
          <div>
            <h1>NiftyQuant</h1>
            <span>Options Research Platform</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          {sections.map(section => (
            <div className="nav-section" key={section}>
              <div className="nav-section-title">{section}</div>
              {navItems.filter(n => n.section === section).map(item => (
                <div
                  key={item.id}
                  className={`nav-item ${activePage === item.id ? 'active' : ''}`}
                  onClick={() => setActivePage(item.id)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </div>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2>{info.title}</h2>
            <div className="subtitle">{info.subtitle}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--bg-card)', padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Data Source:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', color: !globalUseUnified ? 'var(--text-strong)' : 'var(--text-muted)', fontWeight: !globalUseUnified ? 600 : 'normal' }}>Individual</span>
              <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', position: 'relative' }}>
                <input
                  type="checkbox"
                  checked={globalUseUnified}
                  onChange={e => handleToggle(e.target.checked)}
                  style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
                />
                <span style={{
                  display: 'flex', width: '36px', height: '20px', background: globalUseUnified ? 'var(--blue)' : 'var(--border-color)', borderRadius: '20px', alignItems: 'center', padding: '2px', transition: 'background 0.2s'
                }}>
                  <span style={{ display: 'block', width: '16px', height: '16px', background: '#fff', borderRadius: '50%', transform: `translateX(${globalUseUnified ? '16px' : '0'})`, transition: 'transform 0.2s' }} />
                </span>
              </label>
              <span style={{ fontSize: '13px', color: globalUseUnified ? 'var(--green)' : 'var(--text-muted)', fontWeight: globalUseUnified ? 600 : 'normal' }}>Unified Parquet</span>
            </div>
          </div>
        </header>
        <div className="page-body fade-in" key={activePage}>
          {renderPage()}
        </div>
      </main>
    </>
  );
}

export default App;
