import { describe, expect, it, vi } from 'vitest';
import { boundsOf, hitStroke, intersects, MAX_ZOOM, MIN_ZOOM, newId, parseDrawing, segmentDistance, worldPoint, zoomAt } from './model';
import type { Stroke } from './model';

const points = [{ x: 0, y: 0, p: .5 }, { x: 100, y: 0, p: 1 }];
const stroke: Stroke = { id: 'a', color: '#242a38', width: 4, points, bounds: boundsOf(points, 4) };
const drawing = () => ({ version: 1, strokes: [structuredClone(stroke)], view: { x: 100, y: 200, zoom: 1 } });

describe('infinite canvas geometry', () => {
  it('converts screen coordinates to world space', () => {
    expect(worldPoint(50, 80, { x: 10, y: 20, zoom: 2 })).toEqual({ x: 20, y: 30 });
  });
  it('keeps the cursor anchor stationary when zooming', () => {
    const view = { x: -500, y: 400, zoom: .3 };
    const before = worldPoint(123, 456, view);
    const after = worldPoint(123, 456, zoomAt(view, 123, 456, 2));
    expect(after.x).toBeCloseTo(before.x); expect(after.y).toBeCloseTo(before.y);
  });
  it('clamps zoom without moving the anchor', () => {
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, 0, 0, 1e9).zoom).toBe(MAX_ZOOM);
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, 0, 0, 1e-9).zoom).toBe(MIN_ZOOM);
  });
  it('finds padded bounds and visibility', () => {
    expect(stroke.bounds).toEqual({ minX: -4, minY: -4, maxX: 104, maxY: 4 });
    expect(intersects(stroke.bounds, { minX: 104, minY: 4, maxX: 200, maxY: 20 })).toBe(true);
    expect(intersects(stroke.bounds, { minX: 105, minY: 4, maxX: 200, maxY: 20 })).toBe(false);
  });
  it('erases segments and single points, not just vertices', () => {
    expect(hitStroke(stroke, { x: 50, y: 5 }, 4)).toBe(true);
    expect(hitStroke(stroke, { x: 50, y: 8 }, 4)).toBe(false);
    expect(hitStroke({ ...stroke, points: [points[0]] }, { x: 1, y: 1 }, 2)).toBe(true);
    expect(segmentDistance({ x: 3, y: 4 }, points[0], points[0])).toBe(5);
  });
});
describe('document IDs', () => {
  it('also works in non-secure local device testing without randomUUID', () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal('crypto', { getRandomValues });
    try {
      expect(newId()).toMatch(/^[0-9a-f]{32}$/);
      expect(newId()).not.toBe(newId());
    } finally { vi.unstubAllGlobals(); }
  });
});
describe('untrusted drawing imports', () => {
  it('round trips valid documents and recalculates bounds', () => {
    const data = drawing(); data.strokes[0].bounds.minX = -999;
    const parsed = parseDrawing(JSON.parse(JSON.stringify(data)));
    expect(parsed.strokes[0].bounds.minX).toBe(-4);
    expect(parsed.strokes[0].points).toEqual(points);
    expect(parsed.strokes[0].id).not.toBe('a');
  });
  it('rejects wrong versions, invalid views, colors, widths, and pressure', () => {
    for (const change of [
      (d: ReturnType<typeof drawing>) => { d.version = 2; },
      (d: ReturnType<typeof drawing>) => { d.view.zoom = 0; },
      (d: ReturnType<typeof drawing>) => { d.view.x = Infinity; },
      (d: ReturnType<typeof drawing>) => { d.strokes[0].color = 'url(evil)'; },
      (d: ReturnType<typeof drawing>) => { d.strokes[0].width = -1; },
      (d: ReturnType<typeof drawing>) => { d.strokes[0].points[0].p = 2; },
      (d: ReturnType<typeof drawing>) => { d.strokes[0].points = []; },
    ]) { const d = drawing(); change(d); expect(() => parseDrawing(d)).toThrow(); }
    expect(() => parseDrawing(null)).toThrow();
  });
});
