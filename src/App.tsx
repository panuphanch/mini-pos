import { useState, useEffect, useCallback } from 'react';
import { ClipboardList, RefreshCw, ShoppingCart, Settings as SettingsIcon } from 'lucide-react';
import type { AppConfig } from './lib/types';
import { appConfig as tauriConfig } from './lib/tauri';
import { cn } from './lib/cn';
import { Toaster } from './lib/toast';
import StatusBar from './components/StatusBar';
import POSPage from './pages/POSPage';
import OrdersPage from './pages/OrdersPage';
import SyncPage from './pages/SyncPage';
import SettingsPage from './pages/SettingsPage';

type Tab = 'pos' | 'orders' | 'sync' | 'settings';

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'orders', label: 'Orders', icon: ClipboardList },
  { id: 'sync', label: 'Sync', icon: RefreshCw },
  { id: 'pos', label: 'POS', icon: ShoppingCart },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('orders');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [initError, setInitError] = useState('');

  const initialize = useCallback(async () => {
    try {
      const loaded = await tauriConfig.load();
      setConfig(loaded);
    } catch (err) {
      setInitError(err instanceof Error ? err.message : 'Failed to load config');
    }
  }, []);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const handleConfigSaved = useCallback((newConfig: AppConfig) => {
    setConfig(newConfig);
  }, []);

  return (
    <Toaster>
      <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
        <StatusBar printerIp={config?.printerIp || ''} />
        {initError && (
          <div className="bg-destructive/15 text-destructive text-sm px-4 py-2 text-center border-b border-destructive/30">
            {initError}
          </div>
        )}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'pos' && <POSPage />}
          {activeTab === 'orders' && <OrdersPage />}
          {activeTab === 'sync' && <SyncPage appConfig={config} />}
          {activeTab === 'settings' && (
            <SettingsPage appConfig={config} onConfigSaved={handleConfigSaved} />
          )}
        </div>
        <nav className="flex border-t border-border bg-card">
          {TABS.map((t) => (
            <TabButton
              key={t.id}
              label={t.label}
              icon={t.icon}
              active={activeTab === t.id}
              onClick={() => setActiveTab(t.id)}
            />
          ))}
        </nav>
      </div>
    </Toaster>
  );
}

interface TabButtonProps {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
}

function TabButton({ label, icon: Icon, active, onClick }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 flex flex-col items-center justify-center gap-1 py-3 text-sm font-medium transition-colors min-h-[68px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        active
          ? 'text-primary border-t-2 border-primary bg-background'
          : 'text-muted-foreground hover:text-foreground border-t-2 border-transparent',
      )}
    >
      <Icon className="h-5 w-5" />
      <span>{label}</span>
    </button>
  );
}

export default App;
