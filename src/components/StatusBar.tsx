import { useState, useEffect, useCallback } from 'react';
import { printer as tauriPrinter } from '../lib/tauri';
import { checkApiHealth } from '../lib/api';

interface StatusBarProps {
  printerIp: string;
}

export default function StatusBar({ printerIp }: StatusBarProps) {
  const [printerOnline, setPrinterOnline] = useState<boolean | null>(null);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

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

  const checkApi = useCallback(async () => {
    const ok = await checkApiHealth();
    setApiOnline(ok);
  }, []);

  useEffect(() => {
    checkPrinter();
    checkApi();
    const interval = setInterval(() => {
      checkPrinter();
      checkApi();
    }, 30000);
    return () => clearInterval(interval);
  }, [checkPrinter, checkApi]);

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
    <div className="flex items-center justify-between bg-gray-900 border-b border-gray-700 px-4 py-2 text-sm">
      <div className="flex items-center gap-4">
        <span className="font-bold text-white text-base">Granny's POS</span>
      </div>
      <div className="flex items-center gap-4">
        <StatusDot label="API" online={apiOnline} />
        <StatusDot label="Printer" online={printerOnline} />
        <span className="text-gray-400">
          {dateStr} {timeStr}
        </span>
      </div>
    </div>
  );
}

function StatusDot({ label, online }: { label: string; online: boolean | null }) {
  const color =
    online === null ? 'bg-yellow-500' : online ? 'bg-green-500' : 'bg-red-500';
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
      <span className="text-gray-300">{label}</span>
    </span>
  );
}
