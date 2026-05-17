import { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { ordersApi, catalog } from '../lib/tauri';
import type { OrderDetail } from '../lib/types';
import { computeOrderTotals, type EditableItem } from '../lib/orderEdit';
import { useToast } from '../lib/toast';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Separator } from './ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import SearchPicker from './SearchPicker';

interface EditOrderDialogProps {
  detail: OrderDetail;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditOrderDialog({ detail, onClose, onSaved }: EditOrderDialogProps) {
  const [items, setItems] = useState<EditableItem[]>(() =>
    detail.items.map((it) => ({
      productId: it.productId,
      nameTh: it.nameTh,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
    })),
  );
  const [discount, setDiscount] = useState(detail.discount);
  const [deliveryFee, setDeliveryFee] = useState(detail.deliveryFee);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { toast } = useToast();

  const totals = useMemo(
    () => computeOrderTotals(items, discount, deliveryFee),
    [items, discount, deliveryFee],
  );

  useEffect(() => {
    setError('');
  }, [items, discount, deliveryFee]);

  const updateItem = (index: number, patch: Partial<EditableItem>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const addItem = (productId: string, nameTh: string, unitPrice: number) => {
    setItems((prev) => {
      const existing = prev.findIndex((it) => it.productId === productId);
      if (existing >= 0) {
        return prev.map((it, i) =>
          i === existing ? { ...it, quantity: it.quantity + 1 } : it,
        );
      }
      return [...prev, { productId, nameTh, quantity: 1, unitPrice }];
    });
  };

  const handleSave = async () => {
    if (items.length === 0) {
      setError('Order must have at least one item');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await ordersApi.update(detail.id, {
        items: items
          .filter((it) => it.quantity > 0)
          .map((it) => ({
            productId: it.productId,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
          })),
        discount,
        deliveryFee,
      });
      toast({
        title: 'Order updated',
        description: `${detail.orderNumber} marked sync-locked.`,
        variant: 'success',
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit order {detail.orderNumber}</DialogTitle>
          <DialogDescription>
            Saving will lock this order from future Google Sheet sync. Local edits stay.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Items</Label>
            <div className="rounded-md border border-border divide-y divide-border">
              {items.length === 0 && (
                <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                  No items yet — add one below.
                </div>
              )}
              {items.map((it, i) => (
                <ItemRow
                  key={`${it.productId}-${i}`}
                  item={it}
                  onChange={(patch) => updateItem(i, patch)}
                  onRemove={() => removeItem(i)}
                />
              ))}
            </div>
          </div>

          <div>
            <Label>Add item</Label>
            <div className="mt-2">
              <SearchPicker
                placeholder="Search product…"
                createLabel="Add manually"
                search={async (q) => {
                  const results = await catalog.searchProducts(q);
                  return results.map((p) => ({
                    id: p.id,
                    primary: p.nameTh,
                    secondary: p.nameEn ?? `฿${p.sellingPrice}`,
                  }));
                }}
                onPick={async (r) => {
                  const results = await catalog.searchProducts(r.primary, 5);
                  const found = results.find((p) => p.id === r.id);
                  addItem(r.id, r.primary, found?.sellingPrice ?? 0);
                }}
                onCreate={() => {
                  // No manual create path here — products must already exist in the catalog.
                  setError('Create products via Sync first; this dialog only edits existing items.');
                }}
              />
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-discount">Discount (฿)</Label>
              <Input
                id="edit-discount"
                type="number"
                inputMode="numeric"
                value={discount}
                onChange={(e) => setDiscount(parseInt(e.target.value || '0', 10))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-delivery">Delivery fee (฿)</Label>
              <Input
                id="edit-delivery"
                type="number"
                inputMode="numeric"
                value={deliveryFee}
                onChange={(e) => setDeliveryFee(parseInt(e.target.value || '0', 10))}
              />
            </div>
          </div>

          <div className="rounded-md bg-muted p-3 space-y-1.5">
            <div className="flex justify-between text-sm text-muted-foreground tabular-nums">
              <span>Subtotal</span>
              <span>฿{totals.subtotal}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-sm text-destructive tabular-nums">
                <span>Discount</span>
                <span>−฿{discount}</span>
              </div>
            )}
            {deliveryFee > 0 && (
              <div className="flex justify-between text-sm text-muted-foreground tabular-nums">
                <span>Delivery</span>
                <span>+฿{deliveryFee}</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold tabular-nums pt-1">
              <span>Total</span>
              <span>฿{totals.total}</span>
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 text-destructive px-3 py-2 text-sm">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="secondary" size="lg" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="lg" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save & lock from sync'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ItemRowProps {
  item: EditableItem;
  onChange: (patch: Partial<EditableItem>) => void;
  onRemove: () => void;
}

function ItemRow({ item, onChange, onRemove }: ItemRowProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5">
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{item.nameTh}</div>
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="iconSm"
          aria-label="Decrease"
          onClick={() => onChange({ quantity: Math.max(0, item.quantity - 1) })}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Input
          type="number"
          inputMode="numeric"
          value={item.quantity}
          inputSize="sm"
          className="w-16 text-center tabular-nums"
          onChange={(e) =>
            onChange({ quantity: Math.max(0, parseInt(e.target.value || '0', 10)) })
          }
        />
        <Button
          variant="outline"
          size="iconSm"
          aria-label="Increase"
          onClick={() => onChange({ quantity: item.quantity + 1 })}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <span>฿</span>
        <Input
          type="number"
          inputMode="numeric"
          value={item.unitPrice}
          inputSize="sm"
          className="w-20 text-right tabular-nums"
          onChange={(e) =>
            onChange({ unitPrice: Math.max(0, parseInt(e.target.value || '0', 10)) })
          }
        />
      </div>
      <div className="w-20 text-right text-sm font-semibold tabular-nums">
        ฿{item.quantity * item.unitPrice}
      </div>
      <Button
        variant="ghost"
        size="iconSm"
        aria-label="Remove item"
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
