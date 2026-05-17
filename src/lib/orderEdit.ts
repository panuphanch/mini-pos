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
