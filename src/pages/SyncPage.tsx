import { useCallback, useEffect, useState } from 'react';
import { sheets } from '../lib/tauri';
import type { AppConfig, SyncMappings, SyncPreview, SyncResult, TabStrategy } from '../lib/types';
import MappingForm from '../components/MappingForm';

interface SyncPageProps {
  appConfig: AppConfig | null;
}

// ISO 8601 week number (Thursday-anchored). Matches `Order_NN` tab naming.
function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// Pick which tab to preselect, honoring the user's defaultTabStrategy setting.
// Every branch falls back silently to the leftmost tab when no match is found —
// the wife's convention is that the leftmost tab is the current week.
function pickDefaultTab(names: string[], strategy: TabStrategy): string {
  if (names.length === 0) return '';
  if (strategy === 'latest') return names[0];
  if (strategy === 'currentWeek') {
    const target = `Order_${isoWeekNumber(new Date())}`;
    return names.includes(target) ? target : names[0];
  }
  return names.includes(strategy.pinned) ? strategy.pinned : names[0];
}

export default function SyncPage({ appConfig }: SyncPageProps) {
  const [tabs, setTabs] = useState<string[]>([]);
  const [selectedTab, setSelectedTab] = useState<string>('');
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [applying, setApplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadTabs = useCallback(async () => {
    if (!appConfig || !appConfig.spreadsheetId) {
      setError('Configure Spreadsheet ID and service account in Settings');
      return;
    }
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await sheets.testConnection(appConfig);
      const names = result.map((t) => t.name);
      setTabs(names);
      if (names.length > 0 && !selectedTab) {
        setSelectedTab(pickDefaultTab(names, appConfig.defaultTabStrategy));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [appConfig, selectedTab]);

  useEffect(() => { loadTabs(); }, [loadTabs]);

  const runSync = async () => {
    if (!appConfig || !selectedTab) return;
    setBusy(true); setError(''); setMessage(''); setPreview(null);
    try {
      const p = await sheets.syncWeek(appConfig, selectedTab);
      setPreview(p);
      if (p.unknownMenus.length === 0 && p.unknownCustomers.length === 0) {
        // No unknowns — apply immediately with empty mappings.
        await doApply({ menu: [], customer: [] }, p);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doApply = async (mappings: SyncMappings, p: SyncPreview) => {
    if (!appConfig) return;
    setApplying(true); setError('');
    try {
      const res: SyncResult = await sheets.applySync(appConfig, p.tab, mappings);
      setMessage(`Synced ${p.tab}: +${res.rowsAdded} new, ~${res.rowsUpdated} updated, −${res.rowsSoftDeleted} removed`);
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="h-full bg-gray-900 flex flex-col">
      <header className="p-4 border-b border-gray-700 flex items-center gap-3">
        <h2 className="text-white text-xl font-bold flex-1">Sync from Google Sheet</h2>
        <select
          value={selectedTab}
          onChange={(e) => setSelectedTab(e.target.value)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
        >
          {tabs.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={loadTabs} disabled={busy}
          className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm">
          Refresh tabs
        </button>
        <button onClick={runSync} disabled={busy || !selectedTab}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm">
          Sync now
        </button>
      </header>

      {error && (
        <div className="bg-red-900/60 text-red-200 px-4 py-2 text-sm">{error}</div>
      )}
      {message && (
        <div className="bg-green-900/60 text-green-200 px-4 py-2 text-sm">{message}</div>
      )}

      <div className="flex-1 overflow-hidden">
        {preview && (preview.unknownMenus.length > 0 || preview.unknownCustomers.length > 0) ? (
          <MappingForm
            preview={preview}
            applying={applying}
            onApply={(m) => doApply(m, preview)}
            onCancel={() => setPreview(null)}
          />
        ) : (
          <div className="p-4 text-gray-400 text-sm">
            {busy ? 'Working…' : 'Pick a tab and click Sync now.'}
          </div>
        )}
      </div>
    </div>
  );
}
