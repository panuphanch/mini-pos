import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { printer as tauriPrinter } from '../lib/tauri';
import type { Order, AppConfig, ReceiptData, PrinterConfig } from '../lib/types';

interface OrdersPageProps {
  appConfig: AppConfig | null;
}

export default function OrdersPage({ appConfig }: OrdersPageProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [reprintingId, setReprintingId] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.orders.getRecent();
      setOrders(result.data);
    } catch (err) {
      console.error('Failed to fetch orders:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleReprint = async (order: Order) => {
    if (!appConfig) return;
    setReprintingId(order.id);
    try {
      // Build a minimal receipt from order data
      const receiptData: ReceiptData = {
        customerName: order.customer.name,
        items: [{ name: `Order ${order.orderNumber}`, quantity: 1, price: order.totalAmount }],
        discountType: 'none',
        discount: 0,
        deliveryFee: 0,
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

      try {
        const settings = await api.settings.getAll();
        const m = new Map(settings.map((s) => [s.key, s.value]));
        printerConfig.shopName = m.get('shopName') || 'Granny\'s Bakery';
        printerConfig.shopPhone = m.get('shopPhone') || '';
        printerConfig.shopLine = m.get('shopLine') || '';
        printerConfig.qrText = m.get('promptpayQrText') || 'Scan to Pay';
        printerConfig.qrCodeType = m.get('promptpayType') || 'phone';
        printerConfig.qrCodeValue = m.get('promptpayValue') || '';
        printerConfig.thankYouMessage = m.get('thankYouMessage') || 'Thank you!';
      } catch {
        // use defaults
      }

      await tauriPrinter.printReceipt(receiptData, printerConfig);
    } catch (err) {
      console.error('Reprint failed:', err);
    } finally {
      setReprintingId(null);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString('th-TH', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return 'text-blue-400';
      case 'completed': return 'text-green-400';
      case 'cancelled': return 'text-red-400';
      default: return 'text-yellow-400';
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-900 p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-white text-xl font-bold">Recent Orders</h2>
        <button
          onClick={fetchOrders}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          Loading orders...
        </div>
      ) : orders.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          No orders yet
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-gray-800">
              <tr className="text-gray-400 text-sm text-left">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Order #</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                  <td className="px-3 py-2 text-gray-300 text-sm">
                    {formatDate(order.orderDate)}
                  </td>
                  <td className="px-3 py-2 text-white text-sm font-mono">
                    {order.orderNumber}
                  </td>
                  <td className="px-3 py-2 text-white text-sm">
                    {order.customer.name}
                  </td>
                  <td className="px-3 py-2 text-white text-sm text-right font-medium">
                    ฿{order.totalAmount.toFixed(0)}
                  </td>
                  <td className={`px-3 py-2 text-sm capitalize ${statusColor(order.status)}`}>
                    {order.status}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => handleReprint(order)}
                      disabled={reprintingId === order.id}
                      className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs rounded"
                    >
                      {reprintingId === order.id ? 'Printing...' : 'Reprint'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
