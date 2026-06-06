import { expect, test } from '@playwright/test';

// Regression for the Edit-order dialog blowing out when an item name is long.
// Root cause: DialogContent is a CSS grid; its grid items defaulted to
// min-width:auto and refused to shrink, so `truncate` on the name never fired
// and the row pushed past the dialog. Fix: [&>*]:min-w-0 on DialogContent.
test.describe('Edit order — long item name', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/e2e/fixtures/itemrow.html');
    await page.getByTestId('itemlist').waitFor();
  });

  test('the dialog does not overflow horizontally', async ({ page }) => {
    // The Radix DialogContent carries role="dialog".
    const dialog = page.getByRole('dialog');
    const { scrollWidth, clientWidth } = await dialog.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    // Allow 1px for sub-pixel rounding.
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test('a long name is clipped (ellipsed), not rendered at full width', async ({
    page,
  }) => {
    const name = page.getByTestId('itemlist').locator('.font-medium').first();
    const { scrollWidth, clientWidth } = await name.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    // Ellipsing means the rendered (client) width is narrower than the full
    // text (scroll) width.
    expect(scrollWidth).toBeGreaterThan(clientWidth);
  });

  test('hovering the name exposes the full text via title', async ({ page }) => {
    const name = page.getByTestId('itemlist').locator('.font-medium').first();
    await expect(name).toHaveAttribute('title', /ลอนดอนช็อคโกแลตคาราเมลเค้ก/);
  });
});
