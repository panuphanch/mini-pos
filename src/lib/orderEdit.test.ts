import { describe, expect, it } from 'vitest';
import { computeOrderTotals, type EditableItem } from './orderEdit';

const items = (rows: Array<[number, number]>): EditableItem[] =>
  rows.map(([qty, price], i) => ({
    productId: `p${i}`,
    nameTh: `item${i}`,
    quantity: qty,
    unitPrice: price,
  }));

describe('computeOrderTotals', () => {
  it('sums line items into a subtotal', () => {
    const r = computeOrderTotals(items([[2, 100], [1, 50]]), 0, 0);
    expect(r.subtotal).toBe(250);
    expect(r.total).toBe(250);
  });

  it('subtracts discount and adds delivery fee', () => {
    const r = computeOrderTotals(items([[3, 80]]), 30, 40);
    expect(r.subtotal).toBe(240);
    expect(r.total).toBe(250); // 240 - 30 + 40
  });

  it('clamps total at zero when discount exceeds subtotal', () => {
    const r = computeOrderTotals(items([[1, 50]]), 200, 0);
    expect(r.total).toBe(0);
  });

  it('ignores rows with non-positive quantity', () => {
    const r = computeOrderTotals(items([[2, 100], [0, 999], [-1, 999]]), 0, 0);
    expect(r.subtotal).toBe(200);
  });
});
