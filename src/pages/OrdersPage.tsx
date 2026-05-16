import { useCallback, useEffect, useState } from 'react';
import { ordersApi } from '../lib/tauri';
import type { AppConfig, OrderDetail, OrderListRow } from '../lib/types';

interface OrdersPageProps { appConfig: AppConfig | null; }

export default function OrdersPage({ appConfig }: OrdersPageProps) {
  const [orders, setOrders] = useState<OrderListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<string>('');
  const [showRemoved, setShowRemoved] = useState(false);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, OrderDetail>>({});

  const fetchOrders = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const rows = await ordersApi.list({
        tab: filterTab || undefined,
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

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

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
      // Refresh the row's detail too, since printedAt/printCount changed.
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

  const tabs = Array.from(new Set(orders.map((o) => o.sourceTab).filter((t): t is string => !!t)));

  return (
    <div className="h-full flex flex-col bg-gray-900 p-4">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h2 className="text-white text-xl font-bold flex-1">Orders</h2>
        <select value={filterTab} onChange={(e) => setFilterTab(e.target.value)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm">
          <option value="">All weeks</option>
          {tabs.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="text-sm text-gray-300 flex items-center gap-1">
          <input type="checkbox" checked={showRemoved}
            onChange={(e) => setShowRemoved(e.target.checked)} />
          Show removed
        </label>
        <button onClick={fetchOrders}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm">
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-900/60 text-red-200 px-3 py-2 text-sm rounded mb-2">{error}</div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">Loading…</div>
      ) : orders.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">No orders</div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-gray-800">
              <tr className="text-gray-400 text-sm text-left">
                <th className="w-8 px-2 py-2"></th>
                <th className="px-3 py-2">Order #</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Items / Delivery</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const isExpanded = expandedId === o.id;
                const detail = details[o.id];
                return (
                  <FragmentRow
                    key={o.id}
                    row={o}
                    isExpanded={isExpanded}
                    detail={detail}
                    printing={printingId === o.id}
                    onToggle={() => toggleExpand(o)}
                    onPrint={() => handlePrint(o)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FragmentRow({ row, isExpanded, detail, printing, onToggle, onPrint }: {
  row: OrderListRow;
  isExpanded: boolean;
  detail: OrderDetail | undefined;
  printing: boolean;
  onToggle: () => void;
  onPrint: () => void;
}) {
  const stopAndPrint = (e: React.MouseEvent) => { e.stopPropagation(); onPrint(); };

  return (
    <>
      <tr
        onClick={row.deletedAt ? undefined : onToggle}
        className={
          `border-b border-gray-800 ` +
          (row.deletedAt
            ? 'opacity-50'
            : 'hover:bg-gray-800/50 cursor-pointer ' + (isExpanded ? 'bg-gray-800/40' : ''))
        }
      >
        <td className="w-8 px-2 py-2 text-gray-500 text-sm select-none">
          {row.deletedAt ? '' : isExpanded ? '▾' : '▸'}
        </td>
        <td className="px-3 py-2 text-white text-sm font-mono">{row.orderNumber}</td>
        <td className="px-3 py-2 text-white text-sm">{row.customerName}</td>
        <td className="px-3 py-2 text-gray-300 text-sm">{row.channel ?? ''}</td>
        <td className="px-3 py-2 text-sm">
          <div className="text-gray-300">{row.itemsSummary}</div>
          {row.deliveryLocation && (
            <div className="text-xs text-gray-500 mt-0.5">📍 {row.deliveryLocation}</div>
          )}
        </td>
        <td className="px-3 py-2 text-white text-sm text-right">฿{row.totalAmount}</td>
        <td className="px-3 py-2 text-gray-400 text-sm">{row.notes ?? ''}</td>
        <td className="px-3 py-2">
          {row.deletedAt ? (
            <span className="text-xs text-yellow-400">removed</span>
          ) : (
            <button onClick={stopAndPrint} disabled={printing}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded">
              {printing ? 'Printing…' : row.printedAt ? `✓ Reprint (${row.printCount})` : '🖨 Print'}
            </button>
          )}
        </td>
      </tr>
      {isExpanded && !row.deletedAt && (
        <tr className="bg-gray-800/30">
          <td></td>
          <td colSpan={7} className="px-3 py-3">
            {detail ? <DetailPanel detail={detail} /> : (
              <div className="text-gray-400 text-sm">Loading detail…</div>
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
    <div className="space-y-3 max-w-3xl">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-500 text-xs uppercase tracking-wide">
            <th className="text-left font-normal py-1">Item</th>
            <th className="text-right font-normal py-1 w-16">Qty</th>
            <th className="text-right font-normal py-1 w-20">Unit</th>
            <th className="text-right font-normal py-1 w-20">Line</th>
          </tr>
        </thead>
        <tbody>
          {detail.items.map((it) => (
            <tr key={it.productId} className="border-t border-gray-700/50">
              <td className="py-1 text-gray-200">{it.nameTh}</td>
              <td className="py-1 text-right text-gray-300">{it.quantity}</td>
              <td className="py-1 text-right text-gray-300">฿{it.unitPrice}</td>
              <td className="py-1 text-right text-gray-100">฿{it.unitPrice * it.quantity}</td>
            </tr>
          ))}
          <tr className="border-t border-gray-700">
            <td colSpan={3} className="py-1 text-right text-gray-400 text-xs">Items subtotal</td>
            <td className="py-1 text-right text-gray-300">฿{itemsSubtotal}</td>
          </tr>
          {detail.discount > 0 && (
            <tr>
              <td colSpan={3} className="py-1 text-right text-gray-400 text-xs">Discount</td>
              <td className="py-1 text-right text-gray-300">−฿{detail.discount}</td>
            </tr>
          )}
          {detail.deliveryFee > 0 && (
            <tr>
              <td colSpan={3} className="py-1 text-right text-gray-400 text-xs">Delivery fee</td>
              <td className="py-1 text-right text-gray-300">+฿{detail.deliveryFee}</td>
            </tr>
          )}
          <tr className="border-t border-gray-700">
            <td colSpan={3} className="py-1 text-right text-gray-300 text-xs font-semibold">Total</td>
            <td className="py-1 text-right text-white font-semibold">฿{detail.totalAmount}</td>
          </tr>
        </tbody>
      </table>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
        {detail.deliveryLocation && (
          <>
            <dt className="text-gray-500">Delivery</dt>
            <dd className="text-gray-200">{detail.deliveryLocation}</dd>
          </>
        )}
        <dt className="text-gray-500">Order date</dt>
        <dd className="text-gray-200">{detail.orderDate}</dd>
        {detail.printedAt && (
          <>
            <dt className="text-gray-500">Last printed</dt>
            <dd className="text-gray-200">
              {new Date(detail.printedAt).toLocaleString()} · {detail.printCount}×
            </dd>
          </>
        )}
        {detail.sourceTab && (
          <>
            <dt className="text-gray-500">Source</dt>
            <dd className="text-gray-200 font-mono">{detail.sourceTab} row {detail.sourceRow}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
