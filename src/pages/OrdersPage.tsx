import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Lock,
  MapPin,
  PencilLine,
  Printer,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { ordersApi } from '../lib/tauri';
import type { AppConfig, OrderDetail, OrderListRow } from '../lib/types';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import EditOrderDialog from '../components/EditOrderDialog';
import { aggregateOrderItems } from '../lib/aggregateOrderItems';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
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
  const [editing, setEditing] = useState<OrderDetail | null>(null);
  const [editingLoading, setEditingLoading] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingTarget, setDeletingTarget] = useState<OrderListRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [mergeConfirm, setMergeConfirm] = useState<OrderListRow[] | null>(null);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openMergeConfirm = () => {
    const selected = orders.filter((o) => selectedIds.has(o.id));
    if (selected.length < 2) return;
    setMergeConfirm(selected);
  };

  const confirmMerge = async () => {
    if (!mergeConfirm) return;
    setMerging(true);
    try {
      await ordersApi.merge(mergeConfirm.map((o) => o.id));
      setMergeConfirm(null);
      setSelectedIds(new Set());
      setDetails({});
      await fetchOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMerging(false);
    }
  };

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
      setSelectedIds((prev) => {
        const validIds = new Set(rows.map((r) => r.id));
        const next = new Set<string>();
        prev.forEach((id) => { if (validIds.has(id)) next.add(id); });
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filterTab, showRemoved]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const confirmDelete = async () => {
    if (!deletingTarget) return;
    setDeletingId(deletingTarget.id);
    try {
      await ordersApi.delete(deletingTarget.id);
      setDeletingTarget(null);
      await fetchOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  };

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

  const handleEdit = async (row: OrderListRow) => {
    if (row.deletedAt) return;
    setEditingLoading(row.id);
    try {
      const fresh = await ordersApi.get(row.id);
      if (fresh) setEditing(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEditingLoading(null);
    }
  };

  const afterEditSaved = async () => {
    setDetails({});
    await fetchOrders();
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
      <header className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-border">
        <h1 className="text-2xl font-bold tracking-tight flex-1 min-w-0">Orders</h1>
        <Label className="inline-flex h-11 items-center gap-2 cursor-pointer select-none px-1">
          <Checkbox
            checked={showRemoved}
            onCheckedChange={(v) => setShowRemoved(v === true)}
          />
          <span>Show removed</span>
        </Label>
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
        {selectedIds.size >= 2 && (
          <Button onClick={openMergeConfirm} disabled={merging}>
            Merge {selectedIds.size} orders
          </Button>
        )}
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
                <th className="w-10 px-2 py-3"></th>
                <th className="px-3 py-3 font-medium">Order #</th>
                <th className="px-3 py-3 font-medium">Customer</th>
                <th className="px-3 py-3 font-medium">Channel</th>
                <th className="px-3 py-3 font-medium">Items / Delivery</th>
                <th className="px-3 py-3 font-medium text-right">Total</th>
                <th className="px-3 py-3 font-medium">Note</th>
                <th className="w-20 px-2 py-3 font-medium"></th>
                <th className="w-32 px-3 py-3 font-medium text-right"></th>
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
                  editingLoading={editingLoading === o.id}
                  deleting={deletingId === o.id}
                  selected={selectedIds.has(o.id)}
                  onToggle={() => toggleExpand(o)}
                  onPrint={() => handlePrint(o)}
                  onEdit={() => handleEdit(o)}
                  onDelete={() => setDeletingTarget(o)}
                  onSelect={() => toggleSelect(o.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <EditOrderDialog
          detail={editing}
          onClose={() => setEditing(null)}
          onSaved={afterEditSaved}
        />
      )}
      {deletingTarget && (
        <Dialog open onOpenChange={(open) => !open && !deletingId && setDeletingTarget(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Remove this order?</DialogTitle>
              <DialogDescription>
                Order {deletingTarget.orderNumber} ({deletingTarget.customerName}) will be hidden
                from the list and locked so the next Re-sync won't bring it back. You can still
                see it under <em>Show removed</em>.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeletingTarget(null)}
                disabled={!!deletingId}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={confirmDelete}
                disabled={!!deletingId}
              >
                {deletingId ? 'Removing…' : 'Remove'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {mergeConfirm && (
        <Dialog open onOpenChange={(open) => !open && !merging && setMergeConfirm(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Merge {mergeConfirm.length} orders?</DialogTitle>
              <DialogDescription>
                {(() => {
                  const sorted = [...mergeConfirm].sort(
                    (a, b) => (a.sourceRow ?? 0) - (b.sourceRow ?? 0)
                  );
                  const master = sorted[0];
                  const donors = sorted.slice(1);
                  const customers = new Set(mergeConfirm.map((o) => o.customerName));
                  const sameCustomer = customers.size === 1;
                  if (sameCustomer) {
                    return (
                      <>
                        All items will be combined under <strong>{master.orderNumber}</strong>{' '}
                        ({master.customerName}). They'll receive one receipt with all items and
                        one QR code.
                      </>
                    );
                  }
                  return (
                    <>
                      {donors.map((d) => d.customerName).join(', ')}'s order
                      {donors.length > 1 ? 's' : ''} will be merged into{' '}
                      <strong>{master.customerName}</strong>'s order ({master.orderNumber}).
                      Only <strong>{master.customerName}</strong> will receive a receipt.
                    </>
                  );
                })()}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setMergeConfirm(null)}
                disabled={merging}
              >
                Cancel
              </Button>
              <Button onClick={confirmMerge} disabled={merging}>
                {merging ? 'Merging…' : 'Merge'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

interface OrderRowProps {
  row: OrderListRow;
  isExpanded: boolean;
  detail: OrderDetail | undefined;
  printing: boolean;
  editingLoading: boolean;
  deleting: boolean;
  selected: boolean;
  onToggle: () => void;
  onPrint: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSelect: () => void;
}

function OrderRow({
  row,
  isExpanded,
  detail,
  printing,
  editingLoading,
  deleting,
  selected,
  onToggle,
  onPrint,
  onEdit,
  onDelete,
  onSelect,
}: OrderRowProps) {
  const stopAndPrint = (e: React.MouseEvent) => {
    e.stopPropagation();
    onPrint();
  };
  const stopAndEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit();
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
        <td
          className="w-10 px-2 py-3"
          onClick={(e) => e.stopPropagation()}
        >
          {!removed && (
            <Checkbox
              checked={selected}
              onCheckedChange={() => onSelect()}
              aria-label={`Select order ${row.orderNumber}`}
            />
          )}
        </td>
        <td className="w-10 px-2 py-3 text-muted-foreground">
          {!removed &&
            (isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            ))}
        </td>
        <td className="px-3 py-3 font-mono text-sm">
          <div className="flex items-center gap-2">
            <span>{row.orderNumber}</span>
            {row.syncLocked && (
              <Badge variant="warning" className="gap-1 font-normal" title="Locked from sync">
                <Lock className="h-3 w-3" />
                locked
              </Badge>
            )}
            {row.mergedFromCount > 0 && (
              <Badge variant="muted" className="gap-1 font-normal" title="This order has merged-in rows">
                merged ×{row.mergedFromCount + 1}
              </Badge>
            )}
            {row.mergedIntoId && (
              <Badge variant="muted" className="font-normal" title="Merged into another order">
                merged into {row.mergedIntoOrderNumber ?? '…'}
              </Badge>
            )}
          </div>
        </td>
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
        <td className="w-20 px-2 py-3 text-center">
          {!removed && (
            <div className="flex items-center justify-center gap-1">
              <Button
                variant="ghost"
                size="iconSm"
                aria-label="Edit order"
                onClick={stopAndEdit}
                disabled={editingLoading}
              >
                <PencilLine className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="iconSm"
                aria-label="Delete order"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                disabled={deleting}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </td>
        <td className="w-32 px-3 py-3 text-right">
          {removed ? (
            <Badge variant="muted">removed</Badge>
          ) : (
            <Button
              variant={row.printedAt ? 'outline' : 'default'}
              size="sm"
              onClick={stopAndPrint}
              disabled={printing}
              className="min-w-[7rem] justify-center"
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
          <td colSpan={9} className="px-3 py-4">
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
  const items = aggregateOrderItems(detail.items);
  const itemsSubtotal = items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
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
          {items.map((it) => (
            <tr key={`${it.productId}-${it.unitPrice}`} className="border-t border-border">
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
