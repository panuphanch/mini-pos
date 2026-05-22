import { useState, useEffect, useCallback } from 'react';
import { Moon, Sun, Printer } from 'lucide-react';
import { printer as tauriPrinter } from '../lib/tauri';
import { useTheme } from '../lib/theme';
import { Button } from './ui/button';
import { cn } from '../lib/cn';

interface StatusBarProps {
  printerIp: string;
}

export default function StatusBar({ printerIp }: StatusBarProps) {
  const [printerOnline, setPrinterOnline] = useState<boolean | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const { theme, toggle } = useTheme();

  const checkPrinter = useCallback(async () => {
    if (!printerIp) {
      setPrinterOnline(false);
      return;
    }
    try {
      const ok = await tauriPrinter.checkStatus(printerIp);
      setPrinterOnline(ok);
    } catch {
      setPrinterOnline(false);
    }
  }, [printerIp]);

  useEffect(() => {
    checkPrinter();
    const interval = setInterval(checkPrinter, 30000);
    return () => clearInterval(interval);
  }, [checkPrinter]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeStr = currentTime.toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const dateStr = currentTime.toLocaleDateString('th-TH', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <header className="flex items-center justify-between gap-4 bg-card border-b border-border px-4 py-2.5 text-sm">
      <div className="flex items-center gap-3">
        <span className="font-bold text-base tracking-tight">Granny's POS</span>
      </div>
      <div className="flex items-center gap-4">
        <PrinterStatus online={printerOnline} />
        <span className="text-muted-foreground tabular-nums hidden sm:inline">
          {dateStr} · {timeStr}
        </span>
        <Button
          variant="ghost"
          size="iconSm"
          onClick={toggle}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>
      </div>
    </header>
  );
}

function PrinterStatus({ online }: { online: boolean | null }) {
  const dotClass =
    online === null
      ? 'bg-warning'
      : online
        ? 'bg-success'
        : 'bg-destructive';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium',
      )}
    >
      <Printer className="h-3.5 w-3.5 text-muted-foreground" />
      <span className={cn('inline-block h-2 w-2 rounded-full', dotClass)} />
      <span className="text-muted-foreground">
        Printer {online === null ? '…' : online ? 'online' : 'offline'}
      </span>
    </span>
  );
}
