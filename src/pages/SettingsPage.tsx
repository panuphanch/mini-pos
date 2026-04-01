import { useState, useEffect } from 'react';
import { appConfig as tauriConfig } from '../lib/tauri';
import { printer as tauriPrinter } from '../lib/tauri';
import type { AppConfig } from '../lib/types';

interface SettingsPageProps {
  appConfig: AppConfig | null;
  onConfigSaved: (config: AppConfig) => void;
}

export default function SettingsPage({ appConfig, onConfigSaved }: SettingsPageProps) {
  const [printerIp, setPrinterIp] = useState('');
  const [paperWidth, setPaperWidth] = useState<number>(80);
  const [apiUrl, setApiUrl] = useState('');
  const [serviceUsername, setServiceUsername] = useState('');
  const [servicePassword, setServicePassword] = useState('');

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (appConfig) {
      setPrinterIp(appConfig.printerIp);
      setPaperWidth(appConfig.paperWidth);
      setApiUrl(appConfig.apiUrl);
      setServiceUsername(appConfig.serviceUsername);
      setServicePassword(appConfig.servicePassword);
    }
  }, [appConfig]);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const config: AppConfig = {
        printerIp,
        paperWidth,
        apiUrl,
        serviceUsername,
        servicePassword,
      };
      await tauriConfig.save(config);
      onConfigSaved(config);
      setMessage('Settings saved successfully');
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTestPrint = async () => {
    setTesting(true);
    setMessage('');
    try {
      await tauriPrinter.testPrint(printerIp);
      setMessage('Test page sent to printer');
    } catch (err) {
      setMessage(`Print test failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-900 p-6">
      <h2 className="text-white text-xl font-bold mb-6">Settings</h2>

      <div className="max-w-lg space-y-6">
        {/* Printer section */}
        <section className="bg-gray-800 rounded-lg p-4 space-y-4">
          <h3 className="text-white font-semibold text-base">Printer</h3>

          <div>
            <label className="block text-gray-400 text-sm mb-1">Printer IP Address</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={printerIp}
                onChange={(e) => setPrinterIp(e.target.value)}
                placeholder="192.168.1.55"
                className="flex-1 bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleTestPrint}
                disabled={testing || !printerIp}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white rounded-lg text-sm font-medium"
              >
                {testing ? 'Testing...' : 'Test Print'}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-gray-400 text-sm mb-1">Paper Width</label>
            <div className="flex gap-2">
              {[58, 80].map((w) => (
                <button
                  key={w}
                  onClick={() => setPaperWidth(w)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium ${
                    paperWidth === w
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {w}mm
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* API section */}
        <section className="bg-gray-800 rounded-lg p-4 space-y-4">
          <h3 className="text-white font-semibold text-base">API Connection</h3>

          <div>
            <label className="block text-gray-400 text-sm mb-1">API URL</label>
            <input
              type="text"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="http://localhost:3000/api"
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-gray-400 text-sm mb-1">Service Username</label>
            <input
              type="text"
              value={serviceUsername}
              onChange={(e) => setServiceUsername(e.target.value)}
              placeholder="pos-service"
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-gray-400 text-sm mb-1">Service Password</label>
            <input
              type="password"
              value={servicePassword}
              onChange={(e) => setServicePassword(e.target.value)}
              placeholder="Enter password"
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </section>

        {/* Message */}
        {message && (
          <div
            className={`text-sm px-4 py-2 rounded-lg ${
              message.startsWith('Error') ? 'bg-red-900/50 text-red-400' : 'bg-green-900/50 text-green-400'
            }`}
          >
            {message}
          </div>
        )}

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white rounded-lg font-bold text-base"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
