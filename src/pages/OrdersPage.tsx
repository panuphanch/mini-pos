import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  MapPin,
  Printer,
  RefreshCw,
} from 'lucide-react';
import { ordersApi } from '../lib/tauri';
import type { AppConfig, OrderDetail, OrderListRow } from '../lib/types';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { cn } from '../lib/cn';

interface OrdersPageProps {
  appConfig: AppConfig | null;
}

const ALL_TABS = '__all__';

export default function OrdersPage({ appConfig }: OrdersPageProps) {
  const [orders, setOrders] = useState<OrderListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<string>(ALL_TABS);
  const [showRemoved, setShowRemoved] = useState(false);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, OrderDetail>>({});

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await ordersApi.list({
        tab: filterTab === ALL_TABS ? undefined : filterTab,
        includeDeleted: showRemoved,
        limit: 500,
      });
      setOrders(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filterTab, showRemoved]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const toggleExpand = async (row: OrderListRow) => {
    if (expandedId === row.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(row.id);
    if (!details[row.id]) {
      try {
        const d = await ordersApi.get(row.id);
        if (d) setDetails((prev) => ({ ...prev, [row.id]: d }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  const handlePrint = async (row: OrderListRow) => {
    if (!appConfig) return;
    setPrintingId(row.id);
    try {
      await ordersApi.print(appConfig, row.id);
      setDetails((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      await fetchOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPrintingId(null);
    }
  };

  const tabs = Array.from(
    new Set(orders.map((o) => o.sourceTab).filter((t): t is string => !!t)),
  );

  return (
    <div className="h-full flex flex-col bg-background">
      <header className="flex flex-wrap items-end gap-3 px-5 py-4 border-b border-border">
        <h1 className="text-2xl font-bold tracking-tight flex-1 min-w-0">Orders</h1>
        <div className="w-44">
          <Select value={filterTab} onValueChange={setFilterTab}>
            <SelectTrigger aria-label="Filter by week">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TABS}>All weeks</SelectItem>
              {tabs.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Label className="flex items-center gap-2 cursor-pointer select-none">
          <Checkbox
            checked={showRemoved}
            onCheckedChange={(v) => setShowRemoved(v === true)}
          />
          <span>Show removed</span>
        </Label>
        <Button variant="outline" onClick={fetchOrders}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </header>

      {error && (
        <div className="flex items-start gap-2 bg-destructive/10 text-destructive px-5 py-2.5 text-sm border-b border-destructive/30">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          Loading…
        </div>
      ) : orders.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          No orders
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <table className="w-full">
            <thead className="sticky top-0 bg-card border-b border-border z-10">
              <tr className="text-muted-foreground text-xs uppercase tracking-wide text-left">
                <th className="w-10 px-2 py-3"></th>
                <th className="px-3 py-3 font-medium">Order #</th>
                <th className="px-3 py-3 font-medium">Customer</th>
                <th className="px-3 py-3 font-medium">Channel</th>
                <th className="px-3 py-3 font-medium">Items / Delivery</th>
                <th className="px-3 py-3 font-medium text-right">Total</th>
                <th className="px-3 py-3 font-medium">Note</th>
                <th className="px-3 py-3 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <OrderRow
                  key={o.id}
                  row={o}
                  isExpanded={expandedId === o.id}
                  detail={details[o.id]}
                  printing={printingId === o.id}
                  onToggle={() => toggleExpand(o)}
                  onPrint={() => handlePrint(o)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface OrderRowProps {
  row: OrderListRow;
  isExpanded: boolean;
  detail: OrderDetail | undefined;
  printing: boolean;
  onToggle: () => void;
  onPrint: () => void;
}

function OrderRow({ row, isExpanded, detail, printing, onToggle, onPrint }: OrderRowProps) {
  const stopAndPrint = (e: React.MouseEvent) => {
    e.stopPropagation();
    onPrint();
  };
  const removed = !!row.deletedAt;

  return (
    <>
      <tr
        onClick={removed ? undefined : onToggle}
        className={cn(
          'border-b border-border align-top',
          removed ? 'opacity-50' : 'hover:bg-accent/40 cursor-pointer',
          isExpanded && !removed && 'bg-accent/30',
        )}
      >
        <td className="w-10 px-2 py-3 text-muted-foreground">
          {!removed &&
            (isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            ))}
        </td>
        <td className="px-3 py-3 font-mono text-sm">{row.orderNumber}</td>
        <td className="px-3 py-3 text-sm font-medium">{row.customerName}</td>
        <td className="px-3 py-3 text-sm text-muted-foreground">{row.channel ?? ''}</td>
        <td className="px-3 py-3 text-sm">
          <div>{row.itemsSummary}</div>
          {row.deliveryLocation && (
            <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" />
              {row.deliveryLocation}
            </div>
          )}
        </td>
        <td className="px-3 py-3 text-right text-sm font-medium tabular-nums">
          ฿{row.totalAmount}
        </td>
        <td className="px-3 py-3 text-sm text-muted-foreground">{row.notes ?? ''}</td>
        <td className="px-3 py-3 text-right">
          {removed ? (
            <Badge variant="muted">removed</Badge>
          ) : (
            <Button
              variant={row.printedAt ? 'outline' : 'default'}
              size="sm"
              onClick={stopAndPrint}
              disabled={printing}
            >
              <Printer className="h-4 w-4" />
              {printing
                ? 'Printing…'
                : row.printedAt
                  ? `Reprint · ${row.printCount}`
                  : 'Print'}
            </Button>
          )}
        </td>
      </tr>
      {isExpanded && !removed && (
        <tr className="bg-accent/20">
          <td></td>
          <td colSpan={7} className="px-3 py-4">
            {detail ? (
              <DetailPanel detail={detail} />
            ) : (
              <div className="text-muted-foreground text-sm">Loading detail…</div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function DetailPanel({ detail }: { detail: OrderDetail }) {
  const itemsSubtotal = detail.items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
  return (
    <div className="max-w-3xl space-y-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground text-xs uppercase tracking-wide">
            <th className="text-left font-medium py-1.5">Item</th>
            <th className="text-right font-medium py-1.5 w-16">Qty</th>
            <th className="text-right font-medium py-1.5 w-20">Unit</th>
            <th className="text-right font-medium py-1.5 w-20">Line</th>
          </tr>
        </thead>
        <tbody>
          {detail.items.map((it) => (
            <tr key={it.productId} className="border-t border-border">
              <td className="py-1.5">{it.nameTh}</td>
              <td className="py-1.5 text-right tabular-nums">{it.quantity}</td>
              <td className="py-1.5 text-right tabular-nums">฿{it.unitPrice}</td>
              <td className="py-1.5 text-right tabular-nums font-medium">
                ฿{it.unitPrice * it.quantity}
              </td>
            </tr>
          ))}
          <tr className="border-t border-border">
            <td colSpan={3} className="py-1.5 text-right text-muted-foreground text-xs">
              Items subtotal
            </td>
            <td className="py-1.5 text-right tabular-nums">฿{itemsSubtotal}</td>
          </tr>
          {detail.discount > 0 && (
            <tr>
              <td colSpan={3} className="py-1.5 text-right text-muted-foreground text-xs">
                Discount
              </td>
              <td className="py-1.5 text-right text-destructive tabular-nums">
                −฿{detail.discount}
              </td>
            </tr>
          )}
          {detail.deliveryFee > 0 && (
            <tr>
              <td colSpan={3} className="py-1.5 text-right text-muted-foreground text-xs">
                Delivery fee
              </td>
              <td className="py-1.5 text-right tabular-nums">+฿{detail.deliveryFee}</td>
            </tr>
          )}
          <tr className="border-t border-border">
            <td colSpan={3} className="py-1.5 text-right font-semibold">
              Total
            </td>
            <td className="py-1.5 text-right font-bold tabular-nums">฿{detail.totalAmount}</td>
          </tr>
        </tbody>
      </table>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
        {detail.deliveryLocation && (
          <>
            <dt className="text-muted-foreground">Delivery</dt>
            <dd>{detail.deliveryLocation}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Order date</dt>
        <dd className="tabular-nums">{detail.orderDate}</dd>
        {detail.printedAt && (
          <>
            <dt className="text-muted-foreground">Last printed</dt>
            <dd className="tabular-nums">
              {new Date(detail.printedAt).toLocaleString()} · {detail.printCount}×
            </dd>
          </>
        )}
        {detail.sourceTab && (
          <>
            <dt className="text-muted-foreground">Source</dt>
            <dd className="font-mono">
              {detail.sourceTab} row {detail.sourceRow}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
