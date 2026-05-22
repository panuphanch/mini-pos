import { describe, expect, it } from 'vitest';
import { buildUpdatePayload, computeOrderTotals, type EditableItem } from './orderEdit';

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

describe('buildUpdatePayload', () => {
  it('returns ok payload with stripped fields for the happy path', () => {
    const result = buildUpdatePayload(items([[2, 100], [1, 50]]), 20, 30);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toEqual({
      items: [
        { productId: 'p0', quantity: 2, unitPrice: 100 },
        { productId: 'p1', quantity: 1, unitPrice: 50 },
      ],
      discount: 20,
      deliveryFee: 30,
    });
  });

  it('errors when every row has zero quantity', () => {
    const result = buildUpdatePayload(items([[0, 100], [0, 50]]), 0, 0);
    expect(result).toEqual({ ok: false, error: 'Order must have at least one item' });
  });

  it('drops zero-quantity rows but keeps positive ones', () => {
    const result = buildUpdatePayload(items([[2, 100], [0, 999], [3, 25]]), 0, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.items).toEqual([
      { productId: 'p0', quantity: 2, unitPrice: 100 },
      { productId: 'p2', quantity: 3, unitPrice: 25 },
    ]);
  });

  it('errors when an active row has a zero or negative unit price', () => {
    const result = buildUpdatePayload(items([[1, 0]]), 0, 0);
    expect(result).toEqual({
      ok: false,
      error: 'Items need a price greater than ฿0 — use discount for free items',
    });
  });

  it('errors when discount is NaN', () => {
    const result = buildUpdatePayload(items([[1, 100]]), Number.NaN, 0);
    expect(result).toEqual({ ok: false, error: 'Discount must be a non-negative number' });
  });

  it('errors when delivery fee is NaN or negative', () => {
    expect(buildUpdatePayload(items([[1, 100]]), 0, Number.NaN)).toEqual({
      ok: false,
      error: 'Delivery fee must be a non-negative number',
    });
    expect(buildUpdatePayload(items([[1, 100]]), 0, -5)).toEqual({
      ok: false,
      error: 'Delivery fee must be a non-negative number',
    });
  });
});
