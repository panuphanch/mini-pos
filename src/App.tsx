import { useState, useEffect, useCallback } from 'react';
import type { AppConfig } from './lib/types';
import { appConfig as tauriConfig } from './lib/tauri';
import StatusBar from './components/StatusBar';
import POSPage from './pages/POSPage';
import OrdersPage from './pages/OrdersPage';
import SyncPage from './pages/SyncPage';
import SettingsPage from './pages/SettingsPage';

type Tab = 'pos' | 'orders' | 'sync' | 'settings';

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

  useEffect(() => { initialize(); }, [initialize]);

  const handleConfigSaved = useCallback((newConfig: AppConfig) => {
    setConfig(newConfig);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white overflow-hidden">
      <StatusBar printerIp={config?.printerIp || ''} />
      {initError && (
        <div className="bg-red-900/60 text-red-300 text-sm px-4 py-2 text-center">
          {initError}
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'pos' && <POSPage appConfig={config} />}
        {activeTab === 'orders' && <OrdersPage appConfig={config} />}
        {activeTab === 'sync' && <SyncPage appConfig={config} />}
        {activeTab === 'settings' && (
          <SettingsPage appConfig={config} onConfigSaved={handleConfigSaved} />
        )}
      </div>
      <div className="flex border-t border-gray-700 bg-gray-800">
        <TabButton label="Orders" active={activeTab === 'orders'} onClick={() => setActiveTab('orders')} />
        <TabButton label="Sync" active={activeTab === 'sync'} onClick={() => setActiveTab('sync')} />
        <TabButton label="POS" active={activeTab === 'pos'} onClick={() => setActiveTab('pos')} />
        <TabButton label="Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
      </div>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void; }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-3 text-center text-sm font-medium transition-colors ${
        active
          ? 'text-blue-400 border-t-2 border-blue-400 bg-gray-900'
          : 'text-gray-400 hover:text-gray-200'
      }`}
    >
      {label}
    </button>
  );
}

export default App;
