import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { sheets } from '../lib/tauri';
import type {
  AppConfig,
  SyncMappings,
  SyncPreview,
  SyncResult,
  TabStrategy,
} from '../lib/types';
import MappingForm from '../components/MappingForm';
import { Button } from '../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';

interface SyncPageProps {
  appConfig: AppConfig | null;
}

function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

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
    setBusy(true);
    setError('');
    setMessage('');
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

  useEffect(() => {
    loadTabs();
  }, [loadTabs]);

  const runSync = async () => {
    if (!appConfig || !selectedTab) return;
    setBusy(true);
    setError('');
    setMessage('');
    setPreview(null);
    try {
      const p = await sheets.syncWeek(selectedTab);
      setPreview(p);
      if (p.unknownMenus.length === 0 && p.unknownCustomers.length === 0) {
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
    setApplying(true);
    setError('');
    try {
      const res: SyncResult = await sheets.applySync(p.tab, mappings);
      setMessage(
        `Synced ${p.tab}: +${res.rowsAdded} new · ~${res.rowsUpdated} updated · −${res.rowsSoftDeleted} removed`,
      );
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="h-full bg-background flex flex-col">
      <header className="p-5 border-b border-border flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Sync from Google Sheet</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pull weekly order tabs into the local database.
          </p>
        </div>
        <div className="w-56">
          <Select value={selectedTab} onValueChange={setSelectedTab}>
            <SelectTrigger>
              <SelectValue placeholder="Choose tab" />
            </SelectTrigger>
            <SelectContent>
              {tabs.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={loadTabs} disabled={busy}>
          <RefreshCw className="h-4 w-4" />
          Refresh tabs
        </Button>
        <Button onClick={runSync} disabled={busy || !selectedTab}>
          Sync now
        </Button>
      </header>

      {error && (
        <div className="flex items-start gap-2 bg-destructive/10 text-destructive px-5 py-2.5 text-sm border-b border-destructive/30">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {message && (
        <div className="flex items-start gap-2 bg-success/10 text-success px-5 py-2.5 text-sm border-b border-success/30">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{message}</span>
        </div>
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
          <div className="p-6 text-muted-foreground text-sm">
            {busy ? 'Working…' : 'Pick a tab and click Sync now.'}
          </div>
        )}
      </div>
    </div>
  );
}
