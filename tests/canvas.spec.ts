import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('status').first()).toHaveText('Saved on this device');
}
async function draw(page: Page) {
  await page.mouse.move(350, 250);
  await page.mouse.down();
  await page.mouse.move(500, 330, { steps: 20 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
}
async function saved(page: Page) {
  await expect(page.getByRole('status').first()).toHaveText('Saved on this device');
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('pen', 1); r.onsuccess = () => resolve(r.result);
    });
    return new Promise<{strokes: {points: {x: number; y: number; p: number}[]; color: string}[]; view: {x: number; y: number; zoom: number}}>((resolve) => {
      const r = db.transaction('drawings').objectStore('drawings').get('current');
      r.onsuccess = () => { db.close(); resolve(r.result); };
    });
  });
}

test('draws, persists, undoes, redoes, erases and exports', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page); await draw(page);
  expect((await saved(page)).strokes).toHaveLength(1);
  await page.reload();
  await expect(page.locator('#welcome')).toHaveClass('welcome hidden');
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await page.mouse.click(425, 290);
  expect((await saved(page)).strokes).toHaveLength(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await saved(page)).strokes).toHaveLength(1);
  await page.keyboard.press('Control+Shift+Z');
  expect((await saved(page)).strokes).toHaveLength(0);
  await page.keyboard.press('Control+z');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save file' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pen\.json$/);
  const png = page.waitForEvent('download'); await page.getByRole('button', { name: 'PNG', exact: true }).click();
  expect((await png).suggestedFilename()).toMatch(/\.png$/);
  expect(errors).toEqual([]);
});

test('zooms, pans without drawing, resets view, and imports a backup', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('#zoom-label')).toHaveText('125%');
  await page.keyboard.down('Space');
  await page.mouse.move(400, 250); await page.mouse.down(); await page.mouse.move(500, 300); await page.mouse.up();
  await page.keyboard.up('Space');
  expect((await saved(page)).strokes).toHaveLength(0);
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect(page.locator('#zoom-label')).toHaveText('100%');
  await page.locator('#file').setInputFiles({ name: 'test.pen.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, view: { x: 200, y: 200, zoom: 2 }, strokes: [{ color: '#d76b57', width: 4, points: [{ x: 0, y: 0, p: .5 }, { x: 20, y: 20, p: .7 }] }] })) });
  await expect(page.locator('#toast')).toHaveText('Drawing opened.');
  expect((await saved(page)).strokes[0].color).toBe('#d76b57');
  await page.locator('#file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":2}') });
  await expect(page.locator('#toast')).toHaveText('Unsupported drawing format.');
  expect((await saved(page)).strokes).toHaveLength(1);
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Clear canvas', exact: true }).click();
  expect((await saved(page)).strokes).toHaveLength(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await saved(page)).strokes).toHaveLength(1);
});

test('supports pen pressure and rejects palm drawing; touch pans and pinches', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.locator('#canvas').evaluate(canvas => {
    const send = (type: string, options: PointerEventInit) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, ...options }));
    // Synthetic pointers cannot be captured; provide a stub for this input test.
    canvas.setPointerCapture = () => {};
    send('pointerdown', { pointerId: 1, pointerType: 'pen', clientX: 100, clientY: 200, pressure: .2, button: 0 });
    send('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 300, button: 0 });
    send('pointermove', { pointerId: 1, pointerType: 'pen', clientX: 130, clientY: 220, pressure: .9 });
    send('pointerup', { pointerId: 2, pointerType: 'touch' });
    send('pointerup', { pointerId: 1, pointerType: 'pen' });
  });
  const first = await saved(page);
  expect(first.strokes).toHaveLength(1);
  expect(first.strokes[0].points[0].p).toBeCloseTo(.2);
  expect(first.strokes[0].points[1].p).toBeCloseTo(.9);
  await page.locator('#canvas').evaluate(canvas => {
    const send = (type: string, id: number, x: number, y: number) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, button: 0, bubbles: true }));
    send('pointerdown', 3, 100, 200); send('pointermove', 3, 120, 220);
    send('pointerdown', 4, 220, 220); send('pointermove', 4, 320, 220);
    send('pointerup', 3, 120, 220); send('pointerup', 4, 320, 220);
  });
  const after = await saved(page);
  expect(after.strokes).toHaveLength(1); expect(after.view.zoom).toBe(2);
  const toolbar = await page.getByRole('toolbar').boundingBox();
  expect(toolbar!.x).toBeGreaterThanOrEqual(0);
  expect(toolbar!.x + toolbar!.width).toBeLessThanOrEqual(390);
});
