export interface Point { x: number; y: number; p: number }
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
export interface Stroke { id: string; color: string; width: number; points: Point[]; bounds: Bounds }
export interface View { x: number; y: number; zoom: number }
export interface Drawing { version: 1; strokes: Stroke[]; view: View }
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 16;
export const PAPER = '#f7f6f2';

// IDs are document-local, not credentials. getRandomValues also works on HTTP
// (useful for local device testing before a domain's TLS is provisioned).
export function newId(): string {
  return crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
}

export function worldPoint(x: number, y: number, view: View) {
  return { x: (x - view.x) / view.zoom, y: (y - view.y) / view.zoom };
}
export function zoomAt(view: View, x: number, y: number, factor: number): View {
  const anchor = worldPoint(x, y, view);
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom * factor));
  return { x: x - anchor.x * zoom, y: y - anchor.y * zoom, zoom };
}
export function boundsOf(points: Point[], width: number): Bounds {
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of points) expandBounds(bounds, p, width);
  return bounds;
}
export function expandBounds(b: Bounds, p: Point, width: number) {
  b.minX = Math.min(b.minX, p.x - width); b.maxX = Math.max(b.maxX, p.x + width);
  b.minY = Math.min(b.minY, p.y - width); b.maxY = Math.max(b.maxY, p.y + width);
}
export function intersects(a: Bounds, b: Bounds) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
export function segmentDistance(p: {x: number; y: number}, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function hitStroke(stroke: Stroke, p: {x: number; y: number}, radius: number) {
  const r = radius + stroke.width / 2;
  if (!intersects(stroke.bounds, { minX: p.x - r, maxX: p.x + r, minY: p.y - r, maxY: p.y + r })) return false;
  if (stroke.points.length === 1) return segmentDistance(p, stroke.points[0], stroke.points[0]) <= r;
  return stroke.points.some((point, i) => i > 0 && segmentDistance(p, stroke.points[i - 1], point) <= r);
}

const finite = (n: unknown, limit = 1e12): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= limit;
export function parseDrawing(data: unknown): Drawing {
  if (!data || typeof data !== 'object') throw new Error('Not a Pen drawing.');
  const d = data as Drawing;
  if (d.version !== 1 || !Array.isArray(d.strokes) || d.strokes.length > 100_000) throw new Error('Unsupported drawing format.');
  if (!d.view || !finite(d.view.x) || !finite(d.view.y) || !finite(d.view.zoom) || d.view.zoom < MIN_ZOOM || d.view.zoom > MAX_ZOOM) throw new Error('Invalid drawing view.');
  let count = 0;
  const strokes = d.strokes.map((s): Stroke => {
    if (!s || typeof s.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(s.color) || !finite(s.width, 1000) || s.width <= 0 || !Array.isArray(s.points) || s.points.length === 0) throw new Error('Invalid stroke.');
    count += s.points.length;
    if (count > 1_000_000) throw new Error('Drawing is too large (maximum one million points).');
    const points = s.points.map((p): Point => {
      if (!p || !finite(p.x) || !finite(p.y) || !finite(p.p, 1) || p.p < 0) throw new Error('Invalid stroke point.');
      return { x: p.x, y: p.y, p: p.p };
    });
    return { id: newId(), color: s.color, width: s.width, points, bounds: boundsOf(points, s.width) };
  });
  return { version: 1, strokes, view: { x: d.view.x, y: d.view.y, zoom: d.view.zoom } };
}
