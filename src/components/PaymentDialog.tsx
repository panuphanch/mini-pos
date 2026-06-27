import { useState } from 'react';
import { Printer } from 'lucide-react';
import { useCartStore, type DiscountType } from '../stores/cart';
import NumPad from './NumPad';
import { printer as tauriPrinter } from '../lib/tauri';
import type { ReceiptData } from '../lib/types';
import { Button } from './ui/button';
import { Label } from './ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Separator } from './ui/separator';
import { cn } from '../lib/cn';

interface PaymentDialogProps {
  onClose: () => void;
}

export default function PaymentDialog({ onClose }: PaymentDialogProps) {
  const items = useCartStore((s) => s.items);
  const customerName = useCartStore((s) => s.customerName);
  const discountType = useCartStore((s) => s.discountType);
  const discountValue = useCartStore((s) => s.discountValue);
  const deliveryFee = useCartStore((s) => s.deliveryFee);
  const setDiscount = useCartStore((s) => s.setDiscount);
  const setDeliveryFee = useCartStore((s) => s.setDeliveryFee);
  const getSubtotal = useCartStore((s) => s.getSubtotal);
  const getDiscountAmount = useCartStore((s) => s.getDiscountAmount);
  const getTotal = useCartStore((s) => s.getTotal);
  const clear = useCartStore((s) => s.clear);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [numPadTarget, setNumPadTarget] = useState<'discount' | 'delivery' | null>(null);
  const [numPadValue, setNumPadValue] = useState('');

  const subtotal = getSubtotal();
  const discountAmount = getDiscountAmount();
  const total = getTotal();

  const handlePrint = async () => {
    if (items.length === 0) {
      setError('Cart is empty');
      return;
    }
    setSaving(true);
    setError('');

    try {
      const receiptData: ReceiptData = {
        customerName: customerName || '(walk-in)',
        items: items.map((i) => ({
          name: i.product.nameTh,
          quantity: i.quantity,
          price: i.product.sellingPrice,
        })),
        discountType:
          discountType === 'none' ? 'none' : discountType === 'percentage' ? 'percentage' : 'fixed',
        discount: discountValue,
        deliveryFee,
      };
      await tauriPrinter.printReceipt(receiptData);
      clear();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Print failed');
    } finally {
      setSaving(false);
    }
  };

  const openNumPad = (target: 'discount' | 'delivery') => {
    setNumPadTarget(target);
    setNumPadValue(
      target === 'discount' ? String(discountValue || '') : String(deliveryFee || ''),
    );
  };

  const confirmNumPad = () => {
    const val = parseFloat(numPadValue) || 0;
    if (numPadTarget === 'discount') setDiscount(discountType, val);
    else if (numPadTarget === 'delivery') setDeliveryFee(val);
    setNumPadTarget(null);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Payment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Customer
            </div>
            <div className="font-medium">{customerName || 'Not selected'}</div>
          </div>

          <Separator />

          <div className="space-y-1.5">
            {items.map((item) => (
              <div
                key={item.product.id}
                className="flex justify-between text-sm tabular-nums"
              >
                <span className="text-muted-foreground">
                  {item.product.nameTh} × {item.quantity}
                </span>
                <span>฿{(item.product.sellingPrice * item.quantity).toFixed(0)}</span>
              </div>
            ))}
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>Discount</Label>
            <div className="flex gap-2 flex-wrap">
              {(['none', 'percentage', 'amount'] as DiscountType[]).map((t) => (
                <Button
                  key={t}
                  variant={discountType === t ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDiscount(t, t === 'none' ? 0 : discountValue)}
                >
                  {t === 'none' ? 'None' : t === 'percentage' ? '%' : '฿'}
                </Button>
              ))}
              {discountType !== 'none' && (
                <Button
                  variant="outline"
                  size="sm"
                  className={cn('flex-1 justify-end tabular-nums')}
                  onClick={() => openNumPad('discount')}
                >
                  {discountValue || 'Set value'}
                </Button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label>Delivery fee</Label>
            <Button
              variant="outline"
              size="sm"
              className="tabular-nums min-w-[6rem]"
              onClick={() => openNumPad('delivery')}
            >
              ฿{deliveryFee.toFixed(0)}
            </Button>
          </div>

          <Separator />

          <div className="space-y-1.5">
            <div className="flex justify-between text-sm text-muted-foreground tabular-nums">
              <span>Subtotal</span>
              <span>฿{subtotal.toFixed(2)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-sm text-destructive tabular-nums">
                <span>Discount</span>
                <span>−฿{discountAmount.toFixed(2)}</span>
              </div>
            )}
            {deliveryFee > 0 && (
              <div className="flex justify-between text-sm text-muted-foreground tabular-nums">
                <span>Delivery</span>
                <span>฿{deliveryFee.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-xl font-bold tabular-nums pt-1">
              <span>Total</span>
              <span>฿{total.toFixed(2)}</span>
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
          <Button
            variant="success"
            size="lg"
            onClick={handlePrint}
            disabled={saving}
            className="flex-1"
          >
            <Printer className="h-5 w-5" />
            {saving ? 'Printing…' : 'Print receipt'}
          </Button>
        </DialogFooter>
      </DialogContent>

      {numPadTarget && (
        <NumPad
          label={numPadTarget === 'discount' ? 'Discount value' : 'Delivery fee (฿)'}
          value={numPadValue}
          onChange={setNumPadValue}
          onConfirm={confirmNumPad}
          onClose={() => setNumPadTarget(null)}
        />
      )}
    </Dialog>
  );
}
