export interface EditableItem {
  productId: string;
  nameTh: string;
  quantity: number;
  unitPrice: number;
}

export interface OrderTotals {
  subtotal: number;
  total: number;
}

export function computeOrderTotals(
  items: EditableItem[],
  discount: number,
  deliveryFee: number,
): OrderTotals {
  const subtotal = items.reduce((sum, it) => {
    if (it.quantity <= 0) return sum;
    return sum + it.quantity * it.unitPrice;
  }, 0);
  const total = Math.max(0, subtotal - discount + deliveryFee);
  return { subtotal, total };
}

export interface UpdatePayload {
  items: Array<{ productId: string; quantity: number; unitPrice: number }>;
  discount: number;
  deliveryFee: number;
}

export type PayloadResult =
  | { ok: true; payload: UpdatePayload }
  | { ok: false; error: string };

const isNonNegativeFinite = (n: number) => Number.isFinite(n) && n >= 0;

export function buildUpdatePayload(
  items: EditableItem[],
  discount: number,
  deliveryFee: number,
): PayloadResult {
  if (!isNonNegativeFinite(discount)) {
    return { ok: false, error: 'Discount must be a non-negative number' };
  }
  if (!isNonNegativeFinite(deliveryFee)) {
    return { ok: false, error: 'Delivery fee must be a non-negative number' };
  }
  if (items.some((it) => it.quantity > 0 && it.unitPrice <= 0)) {
    return {
      ok: false,
      error: 'Items need a price greater than ฿0 — use discount for free items',
    };
  }
  const filtered = items.filter((it) => it.quantity > 0);
  if (filtered.length === 0) {
    return { ok: false, error: 'Order must have at least one item' };
  }
  return {
    ok: true,
    payload: {
      items: filtered.map((it) => ({
        productId: it.productId,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
      })),
      discount,
      deliveryFee,
    },
  };
}
