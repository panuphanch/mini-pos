import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { appConfig as tauriConfig, printer, sheets } from '../lib/tauri';
import type { AppConfig, TabStrategy } from '../lib/types';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';

interface SettingsPageProps {
  appConfig: AppConfig | null;
  onConfigSaved: (cfg: AppConfig) => void;
}

export default function SettingsPage({ appConfig, onConfigSaved }: SettingsPageProps) {
  const [cfg, setCfg] = useState<AppConfig | null>(appConfig);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [tabs, setTabs] = useState<string[]>([]);

  useEffect(() => {
    setCfg(appConfig);
  }, [appConfig]);

  if (!cfg) {
    return <div className="p-6 text-muted-foreground">Loading config…</div>;
  }

  const update = (patch: Partial<AppConfig>) => setCfg({ ...cfg, ...patch });

  const save = async () => {
    setError('');
    setMessage('');
    try {
      await tauriConfig.save(cfg);
      onConfigSaved(cfg);
      setMessage('Settings saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const testPrinter = async () => {
    setError('');
    setMessage('');
    try {
      await printer.test(cfg.printerIp);
      setMessage('Test page sent');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const testSheets = async () => {
    setError('');
    setMessage('');
    try {
      const result = await sheets.testConnection(cfg);
      setTabs(result.map((t) => t.name));
      setMessage(`Found ${result.length} tabs`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const strategyValue: 'latest' | 'currentWeek' | 'pinned' =
    cfg.defaultTabStrategy === 'latest'
      ? 'latest'
      : cfg.defaultTabStrategy === 'currentWeek'
        ? 'currentWeek'
        : 'pinned';

  const setStrategy = (v: string, pinned?: string) => {
    let s: TabStrategy = 'latest';
    if (v === 'currentWeek') s = 'currentWeek';
    if (v === 'pinned') s = { pinned: pinned ?? '' };
    update({ defaultTabStrategy: s });
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-3xl p-6 space-y-6">
        <header className="space-y-3">
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          {error && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 text-destructive px-3 py-2 text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {message && (
            <div className="flex items-start gap-2 rounded-md bg-success/10 text-success px-3 py-2 text-sm">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{message}</span>
            </div>
          )}
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Printer</CardTitle>
            <CardDescription>Thermal printer connection and paper size.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              label="Printer IP"
              value={cfg.printerIp}
              onChange={(v) => update({ printerIp: v })}
            />
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
              <div className="space-y-2">
                <Label htmlFor="paper-width">Paper width</Label>
                <Select
                  value={String(cfg.paperWidth)}
                  onValueChange={(v) => update({ paperWidth: parseInt(v, 10) })}
                >
                  <SelectTrigger id="paper-width">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="58">58 mm</SelectItem>
                    <SelectItem value="80">80 mm</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" onClick={testPrinter}>
                Test print
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Google Sheets</CardTitle>
            <CardDescription>Source of truth for weekly order tabs.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              label="Spreadsheet ID"
              value={cfg.spreadsheetId}
              onChange={(v) => update({ spreadsheetId: v })}
            />
            <Field
              label="Service account file"
              value={cfg.serviceAccountPath}
              onChange={(v) => update({ serviceAccountPath: v })}
              help="Filename relative to the app data dir (default: service-account.json). Place the JSON key file there."
            />
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
              <div className="space-y-2">
                <Label htmlFor="default-tab">Default tab</Label>
                <Select
                  value={strategyValue}
                  onValueChange={(v) =>
                    setStrategy(
                      v,
                      typeof cfg.defaultTabStrategy === 'object'
                        ? cfg.defaultTabStrategy.pinned
                        : '',
                    )
                  }
                >
                  <SelectTrigger id="default-tab">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="latest">Latest tab</SelectItem>
                    <SelectItem value="currentWeek">Current ISO week</SelectItem>
                    <SelectItem value="pinned">Pinned</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" onClick={testSheets}>
                Test connection
              </Button>
            </div>
            {strategyValue === 'pinned' && (
              <Field
                label="Pinned tab name"
                value={
                  typeof cfg.defaultTabStrategy === 'object' ? cfg.defaultTabStrategy.pinned : ''
                }
                onChange={(v) => setStrategy('pinned', v)}
                placeholder="e.g. Order_30"
              />
            )}
            {tabs.length > 0 && (
              <div className="text-xs text-muted-foreground">Tabs: {tabs.join(', ')}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Shop</CardTitle>
            <CardDescription>Printed on every receipt.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Shop name" value={cfg.shopName} onChange={(v) => update({ shopName: v })} />
            <Field label="Phone" value={cfg.shopPhone} onChange={(v) => update({ shopPhone: v })} />
            <Field label="LINE ID" value={cfg.shopLine} onChange={(v) => update({ shopLine: v })} />
            <div className="space-y-2">
              <Label htmlFor="promptpay-type">PromptPay type</Label>
              <Select
                value={cfg.promptpayType}
                onValueChange={(v) => update({ promptpayType: v })}
              >
                <SelectTrigger id="promptpay-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="phone">Phone</SelectItem>
                  <SelectItem value="id_card">ID card</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Field
              label="PromptPay value"
              value={cfg.promptpayValue}
              onChange={(v) => update({ promptpayValue: v })}
            />
            <Field
              label="Thank-you message"
              value={cfg.thankYouMessage}
              onChange={(v) => update({ thankYouMessage: v })}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end pb-2">
          <Button onClick={save} size="lg">
            Save settings
          </Button>
        </div>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  help?: string;
}

function Field({ label, value, onChange, placeholder, help }: FieldProps) {
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}
