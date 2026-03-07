import './index.css';
import { useUIStore } from './stores/appStore';
import Dashboard from './pages/Dashboard';
import StrategyBuilder from './pages/StrategyBuilder';
import BacktestDashboard from './pages/BacktestDashboard';
import TradeLog from './pages/TradeLog';
import OptionChainExplorer from './pages/OptionChainExplorer';
import StrategyAnimation from './pages/StrategyAnimation';
import StrategyComparison from './pages/StrategyComparison';
import AIOptimizer from './pages/AIOptimizer';
import IntelligenceEngine from './pages/IntelligenceEngine';

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
];

function App() {
  const { activePage, setActivePage } = useUIStore();

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
        <header className="page-header">
          <div>
            <h2>{info.title}</h2>
            <div className="subtitle">{info.subtitle}</div>
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
