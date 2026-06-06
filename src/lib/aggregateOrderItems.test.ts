import { describe, expect, it } from 'vitest';
import { aggregateOrderItems, type DisplayItem } from './aggregateOrderItems';

const item = (productId: string, quantity: number, unitPrice: number): DisplayItem => ({
  productId,
  nameTh: productId,
  quantity,
  unitPrice,
});

describe('aggregateOrderItems', () => {
  // Reproduces P'Gig week 30-31/05/26: a merged ×4 order with 4 Carrot Cake
  // Cranberry (Loaf) @260 and 1 Carrot Cake Original (Loaf) @230 across 5 rows.
  it('collapses a merged order into one line per product (5 rows -> 2)', () => {
    const rows: DisplayItem[] = [
      item('cranberry', 1, 260),
      item('cranberry', 1, 260),
      item('cranberry', 1, 260),
      item('original', 1, 230),
      item('cranberry', 1, 260),
    ];
    const out = aggregateOrderItems(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ productId: 'cranberry', quantity: 4, unitPrice: 260 });
    expect(out[1]).toMatchObject({ productId: 'original', quantity: 1, unitPrice: 230 });
  });

  it('keeps the same product on separate lines when the unit price differs', () => {
    const out = aggregateOrderItems([item('cranberry', 2, 260), item('cranberry', 1, 240)]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ quantity: 2, unitPrice: 260 });
    expect(out[1]).toMatchObject({ quantity: 1, unitPrice: 240 });
  });

  it('preserves first-seen order and does not mutate the input', () => {
    const input = [item('b', 1, 10), item('a', 1, 20), item('b', 2, 10)];
    const out = aggregateOrderItems(input);
    expect(out.map((i) => i.productId)).toEqual(['b', 'a']);
    expect(out[0].quantity).toBe(3);
    expect(input[0].quantity).toBe(1); // original untouched
  });

  it('leaves a single-line order unchanged', () => {
    const out = aggregateOrderItems([item('a', 1, 100)]);
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe(1);
  });
});
