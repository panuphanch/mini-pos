import { useState } from 'react';
import { useCartStore, type DiscountType } from '../stores/cart';
import NumPad from './NumPad';
import { api } from '../lib/api';
import { printer as tauriPrinter } from '../lib/tauri';
import type { AppConfig, PrinterConfig, ReceiptData } from '../lib/types';

interface PaymentDialogProps {
  onClose: () => void;
  appConfig: AppConfig | null;
}

export default function PaymentDialog({ onClose, appConfig }: PaymentDialogProps) {
  const items = useCartStore((s) => s.items);
  const customerId = useCartStore((s) => s.customerId);
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

  const handleSave = async (withPrint: boolean) => {
    if (!customerId) {
      setError('Please select a customer first');
      return;
    }
    setSaving(true);
    setError('');

    try {
      const order = await api.orders.create({
        customerId,
        platform: 'walk-in',
        deliveryType: 'pickup',
        items: items.map((i) => ({
          productId: i.product.id,
          quantity: i.quantity,
          unitPrice: i.product.sellingPrice,
        })),
        discount: discountAmount > 0 ? discountAmount : undefined,
        deliveryFee: deliveryFee > 0 ? deliveryFee : undefined,
      });

      if (withPrint && appConfig) {
        try {
          const receiptData: ReceiptData = {
            customerName: customerName || 'Walk-in',
            items: items.map((i) => ({
              name: i.product.nameTh,
              quantity: i.quantity,
              price: i.product.sellingPrice,
            })),
            discountType: discountType === 'none' ? 'none' : discountType === 'percentage' ? 'percentage' : 'fixed',
            discount: discountValue,
            deliveryFee,
          };
          const printerConfig: PrinterConfig = {
            ip: appConfig.printerIp,
            paperWidth: appConfig.paperWidth,
            shopName: '',
            shopPhone: '',
            shopLine: '',
            qrText: '',
            qrCodeType: 'phone',
            qrCodeValue: '',
            thankYouMessage: '',
          };

          // Try to load shop settings from API
          try {
            const settings = await api.settings.getAll();
            const settingsMap = new Map(settings.map((s) => [s.key, s.value]));
            printerConfig.shopName = settingsMap.get('shopName') || 'Granny\'s Bakery';
            printerConfig.shopPhone = settingsMap.get('shopPhone') || '';
            printerConfig.shopLine = settingsMap.get('shopLine') || '';
            printerConfig.qrText = settingsMap.get('promptpayQrText') || 'Scan to Pay';
            printerConfig.qrCodeType = settingsMap.get('promptpayType') || 'phone';
            printerConfig.qrCodeValue = settingsMap.get('promptpayValue') || '';
            printerConfig.thankYouMessage = settingsMap.get('thankYouMessage') || 'Thank you!';
          } catch {
            // Use defaults if settings fail
          }

          await tauriPrinter.printReceipt(receiptData, printerConfig);
        } catch (printErr) {
          console.error('Print failed:', printErr);
          // Order was saved, just print failed — don't block
        }
      }

      console.log('Order created:', order.orderNumber);
      clear();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save order');
    } finally {
      setSaving(false);
    }
  };

  const openNumPad = (target: 'discount' | 'delivery') => {
    setNumPadTarget(target);
    setNumPadValue(target === 'discount' ? String(discountValue || '') : String(deliveryFee || ''));
  };

  const confirmNumPad = () => {
    const val = parseFloat(numPadValue) || 0;
    if (numPadTarget === 'discount') {
      setDiscount(discountType, val);
    } else if (numPadTarget === 'delivery') {
      setDeliveryFee(val);
    }
    setNumPadTarget(null);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-40" onClick={onClose}>
      <div
        className="bg-gray-800 rounded-xl w-[420px] max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-white text-lg font-bold">Payment</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">
            ✕
          </button>
        </div>

        {/* Order summary */}
        <div className="p-4 space-y-1 border-b border-gray-700">
          <div className="text-gray-400 text-sm mb-2">
            Customer: <span className="text-white">{customerName || 'Not selected'}</span>
          </div>
          {items.map((item) => (
            <div key={item.product.id} className="flex justify-between text-sm">
              <span className="text-gray-300">
                {item.product.nameTh} x{item.quantity}
              </span>
              <span className="text-white">
                ฿{(item.product.sellingPrice * item.quantity).toFixed(0)}
              </span>
            </div>
          ))}
        </div>

        {/* Discount */}
        <div className="p-4 border-b border-gray-700 space-y-2">
          <div className="text-gray-400 text-sm">Discount</div>
          <div className="flex gap-2">
            {(['none', 'percentage', 'amount'] as DiscountType[]).map((t) => (
              <button
                key={t}
                onClick={() => setDiscount(t, t === 'none' ? 0 : discountValue)}
                className={`px-3 py-1.5 rounded text-sm font-medium ${
                  discountType === t
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {t === 'none' ? 'None' : t === 'percentage' ? '%' : '฿'}
              </button>
            ))}
            {discountType !== 'none' && (
              <button
                onClick={() => openNumPad('discount')}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white rounded px-3 py-1.5 text-sm text-right"
              >
                {discountValue || 'Set value'}
              </button>
            )}
          </div>
        </div>

        {/* Delivery fee */}
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center justify-between">
            <span className="text-gray-400 text-sm">Delivery fee</span>
            <button
              onClick={() => openNumPad('delivery')}
              className="bg-gray-700 hover:bg-gray-600 text-white rounded px-4 py-1.5 text-sm"
            >
              ฿{deliveryFee.toFixed(0)}
            </button>
          </div>
        </div>

        {/* Totals */}
        <div className="p-4 space-y-1 border-b border-gray-700">
          <div className="flex justify-between text-sm text-gray-400">
            <span>Subtotal</span>
            <span>฿{subtotal.toFixed(2)}</span>
          </div>
          {discountAmount > 0 && (
            <div className="flex justify-between text-sm text-red-400">
              <span>Discount</span>
              <span>-฿{discountAmount.toFixed(2)}</span>
            </div>
          )}
          {deliveryFee > 0 && (
            <div className="flex justify-between text-sm text-gray-400">
              <span>Delivery</span>
              <span>฿{deliveryFee.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-white text-xl font-bold pt-1">
            <span>Total</span>
            <span>฿{total.toFixed(2)}</span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 pt-3 text-red-400 text-sm">{error}</div>
        )}

        {/* Actions */}
        <div className="p-4 flex gap-2">
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white rounded-lg font-medium"
          >
            {saving ? 'Saving...' : 'Save Order'}
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={saving}
            className="flex-1 py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white rounded-lg font-medium"
          >
            {saving ? 'Saving...' : 'Save & Print'}
          </button>
        </div>
      </div>

      {/* NumPad overlay */}
      {numPadTarget && (
        <NumPad
          label={numPadTarget === 'discount' ? 'Discount value' : 'Delivery fee (฿)'}
          value={numPadValue}
          onChange={setNumPadValue}
          onConfirm={confirmNumPad}
          onClose={() => setNumPadTarget(null)}
        />
      )}
    </div>
  );
}
