import { useEffect, useState } from 'react';
import { appConfig as tauriConfig, printer, sheets } from '../lib/tauri';
import type { AppConfig, TabStrategy } from '../lib/types';

interface SettingsPageProps {
  appConfig: AppConfig | null;
  onConfigSaved: (cfg: AppConfig) => void;
}

export default function SettingsPage({ appConfig, onConfigSaved }: SettingsPageProps) {
  const [cfg, setCfg] = useState<AppConfig | null>(appConfig);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [tabs, setTabs] = useState<string[]>([]);

  useEffect(() => { setCfg(appConfig); }, [appConfig]);

  if (!cfg) return <div className="p-4 text-gray-400">Loading config…</div>;

  const update = (patch: Partial<AppConfig>) => setCfg({ ...cfg, ...patch });

  const save = async () => {
    setError(''); setMessage('');
    try {
      await tauriConfig.save(cfg);
      onConfigSaved(cfg);
      setMessage('Settings saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const testPrinter = async () => {
    setError(''); setMessage('');
    try { await printer.test(cfg.printerIp); setMessage('Test page sent'); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const testSheets = async () => {
    setError(''); setMessage('');
    try {
      const result = await sheets.testConnection(cfg);
      setTabs(result.map((t) => t.name));
      setMessage(`Found ${result.length} tabs`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const strategyValue: string =
    cfg.defaultTabStrategy === 'latest' ? 'latest'
      : cfg.defaultTabStrategy === 'currentWeek' ? 'currentWeek'
      : 'pinned';

  const setStrategy = (v: string, pinned?: string) => {
    let s: TabStrategy = 'latest';
    if (v === 'currentWeek') s = 'currentWeek';
    if (v === 'pinned') s = { pinned: pinned ?? '' };
    update({ defaultTabStrategy: s });
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-8 bg-gray-900 text-white">
      <header>
        <h2 className="text-xl font-bold">Settings</h2>
        {error && <div className="mt-2 bg-red-900/60 text-red-200 px-3 py-2 text-sm rounded">{error}</div>}
        {message && <div className="mt-2 bg-green-900/60 text-green-200 px-3 py-2 text-sm rounded">{message}</div>}
      </header>

      <section className="bg-gray-800/40 p-4 rounded-lg space-y-3">
        <h3 className="font-semibold">Printer</h3>
        <LabeledInput label="Printer IP" value={cfg.printerIp}
          onChange={(v) => update({ printerIp: v })} />
        <div className="flex items-center gap-3">
          <label className="text-sm">Paper width</label>
          <select value={cfg.paperWidth}
            onChange={(e) => update({ paperWidth: parseInt(e.target.value, 10) })}
            className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm">
            <option value={58}>58 mm</option>
            <option value={80}>80 mm</option>
          </select>
          <button onClick={testPrinter}
            className="ml-auto px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm">
            Test print
          </button>
        </div>
      </section>

      <section className="bg-gray-800/40 p-4 rounded-lg space-y-3">
        <h3 className="font-semibold">Google Sheets</h3>
        <LabeledInput label="Spreadsheet ID" value={cfg.spreadsheetId}
          onChange={(v) => update({ spreadsheetId: v })} />
        <LabeledInput label="Service account file"
          value={cfg.serviceAccountPath}
          onChange={(v) => update({ serviceAccountPath: v })}
          help="Filename relative to app data dir (default: service-account.json). Place the JSON key file in that folder." />
        <div className="flex items-center gap-3">
          <label className="text-sm">Default tab</label>
          <select value={strategyValue}
            onChange={(e) => setStrategy(e.target.value,
              typeof cfg.defaultTabStrategy === 'object' ? cfg.defaultTabStrategy.pinned : '')}
            className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm">
            <option value="latest">Latest tab</option>
            <option value="currentWeek">Current ISO week</option>
            <option value="pinned">Pinned</option>
          </select>
          {strategyValue === 'pinned' && (
            <input
              value={typeof cfg.defaultTabStrategy === 'object' ? cfg.defaultTabStrategy.pinned : ''}
              onChange={(e) => setStrategy('pinned', e.target.value)}
              placeholder="Tab name (e.g. Order_30)"
              className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm" />
          )}
          <button onClick={testSheets}
            className="ml-auto px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm">
            Test connection
          </button>
        </div>
        {tabs.length > 0 && (
          <div className="text-xs text-gray-400">Tabs: {tabs.join(', ')}</div>
        )}
      </section>

      <section className="bg-gray-800/40 p-4 rounded-lg space-y-3">
        <h3 className="font-semibold">Shop</h3>
        <LabeledInput label="Shop name" value={cfg.shopName} onChange={(v) => update({ shopName: v })} />
        <LabeledInput label="Phone" value={cfg.shopPhone} onChange={(v) => update({ shopPhone: v })} />
        <LabeledInput label="LINE ID" value={cfg.shopLine} onChange={(v) => update({ shopLine: v })} />
        <div className="flex items-center gap-3">
          <label className="text-sm w-40">PromptPay type</label>
          <select value={cfg.promptpayType}
            onChange={(e) => update({ promptpayType: e.target.value })}
            className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm">
            <option value="phone">Phone</option>
            <option value="id_card">ID card</option>
          </select>
        </div>
        <LabeledInput label="PromptPay value" value={cfg.promptpayValue}
          onChange={(v) => update({ promptpayValue: v })} />
        <LabeledInput label="Thank-you message" value={cfg.thankYouMessage}
          onChange={(v) => update({ thankYouMessage: v })} />
      </section>

      <div className="flex justify-end">
        <button onClick={save}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg">
          Save settings
        </button>
      </div>
    </div>
  );
}

function LabeledInput({ label, value, onChange, help }: {
  label: string; value: string; onChange: (v: string) => void; help?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-gray-300">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm" />
      {help && <span className="text-xs text-gray-500">{help}</span>}
    </div>
  );
}
