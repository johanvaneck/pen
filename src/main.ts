import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-800.css';
import './style.css';
import { boundsOf, expandBounds, hitStroke, intersects, MAX_ZOOM, MIN_ZOOM, PAPER, parseDrawing, worldPoint, zoomAt } from './model';
import type { Drawing, Point, Stroke, View } from './model';
import { load, save } from './storage';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d')!;
let width = innerWidth, height = innerHeight, dpr = 1;
let view: View = { x: width / 2, y: height / 2, zoom: 1 };
let strokes: Stroke[] = [];
let active: Stroke | undefined;
let tool: 'pen' | 'eraser' | 'hand' = 'pen';
let color = '#242a38', size = 4;
let space = false, ready = false, dirty = false, revision = 0;
let drawPointer: number | undefined;
let panPointer: number | undefined;
let lastPan = { x: 0, y: 0 };
let eraseBefore: Stroke[] | undefined;
const touches = new Map<number, { x: number; y: number }>();
let undo: Stroke[][] = [], redo: Stroke[][] = [];
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let toastTimer: ReturnType<typeof setTimeout>;
let frame = 0;
const icons: Record<string, string> = {
  pen: '<path d="m15 3 6 6-12 12H3v-6L15 3Z"/><path d="m12 6 6 6M3 21l6-6"/>',
  eraser: '<path d="m15 3 6 6a2 2 0 0 1 0 3l-9 9H7l-5-5a2 2 0 0 1 0-3L12 3a2 2 0 0 1 3 0Z"/><path d="m7 8 10 10M12 21h9"/>',
  hand: '<path d="M8 13V6a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-6a2 2 0 0 1 4 0v6-3a2 2 0 0 1 4 0v7c0 5-3 8-7 8h-2c-2 0-4-1-5-3l-5-7a2 2 0 0 1 3-2l2 3" transform="translate(-2 -1) scale(.94)"/>',
  undo: '<path d="m9 5-5 5 5 5M4 10h10a6 6 0 0 1 0 12" transform="translate(0 -2)"/>',
  redo: '<path d="m15 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12" transform="translate(0 -2)"/>',
};
for (const [id, paths] of Object.entries(icons)) $(id).innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const colors = [ ['Graphite', '#242a38'], ['Coral', '#d76b57'], ['Ochre', '#cea343'], ['Sage', '#7e9574'], ['Blue', '#6d8fbd'] ];
for (const [name, ink] of colors) {
  const button = document.createElement('button');
  button.className = `color${ink === color ? ' active' : ''}`;
  button.style.setProperty('--ink', ink);
  button.dataset.color = ink;
  button.setAttribute('aria-label', `${name} ink`);
  button.setAttribute('aria-pressed', String(ink === color));
  button.title = name;
  button.onclick = () => selectColor(ink);
  $('colors').append(button);
}
function selectColor(ink: string) {
  color = ink;
  for (const button of document.querySelectorAll<HTMLButtonElement>('.color')) {
    button.classList.toggle('active', button.dataset.color === ink);
    button.setAttribute('aria-pressed', String(button.dataset.color === ink));
  }
  $('size-dot').style.background = ink;
  $<HTMLInputElement>('custom-color').value = ink;
  selectTool('pen');
}
function selectTool(value: typeof tool) {
  finishInteraction();
  tool = value;
  for (const id of ['pen', 'eraser', 'hand']) {
    $(id).classList.toggle('active', value === id);
    $(id).setAttribute('aria-pressed', String(value === id));
  }
  updateCursor();
}
for (const id of ['pen', 'eraser', 'hand'] as const) $(id).onclick = () => selectTool(id);
$<HTMLInputElement>('custom-color').oninput = (e) => selectColor((e.target as HTMLInputElement).value);
$<HTMLInputElement>('size').oninput = (e) => {
  size = Number((e.target as HTMLInputElement).value);
  $('size-dot').style.width = $('size-dot').style.height = `${Math.max(3, size / 1.8)}px`;
};
function updateCursor() { canvas.style.cursor = space || tool === 'hand' ? 'grab' : tool === 'eraser' ? 'cell' : 'crosshair'; }
function toast(message: string) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}
function status(message: string, error = false) {
  $('save-status').textContent = message;
  $('save-status').classList.toggle('error', error);
}
function snapshot(): Drawing { return { version: 1, strokes, view }; }
function scheduleSave() {
  if (!ready) return;
  dirty = true;
  revision++;
  status('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 350);
}
async function persist() {
  if (!dirty || !ready) return;
  clearTimeout(saveTimer);
  const current = revision;
  try {
    await save(snapshot());
    if (current === revision) { dirty = false; status('Saved on this device'); }
  } catch {
    status('Not saved — export a file', true);
    toast('Local save unavailable. Use “Save file” to keep your drawing.');
  }
}
function historyState() {
  $<HTMLButtonElement>('undo').disabled = !undo.length;
  $<HTMLButtonElement>('redo').disabled = !redo.length;
}
function remember(before: Stroke[]) {
  undo.push(before);
  if (undo.length > 100) undo.shift();
  redo = [];
  historyState();
  scheduleSave();
}
function historyMove(direction: 'undo' | 'redo') {
  finishInteraction();
  const from = direction === 'undo' ? undo : redo;
  const to = direction === 'undo' ? redo : undo;
  const previous = from.pop();
  if (!previous) return;
  to.push(strokes);
  strokes = previous;
  historyState(); scheduleSave(); invalidate();
}
$('undo').onclick = () => historyMove('undo');
$('redo').onclick = () => historyMove('redo');

function invalidate() { if (!frame) frame = requestAnimationFrame(render); }
function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke) {
  const points = stroke.points;
  context.strokeStyle = context.fillStyle = stroke.color;
  context.lineCap = context.lineJoin = 'round';
  const radius = (p: Point) => stroke.width * (0.25 + 0.75 * p.p) / 2;
  context.beginPath();
  context.arc(points[0].x, points[0].y, radius(points[0]), 0, Math.PI * 2);
  context.fill();
  for (let i = 1; i < points.length; i++) {
    context.lineWidth = radius(points[i - 1]) + radius(points[i]);
    context.beginPath();
    context.moveTo(points[i - 1].x, points[i - 1].y);
    context.lineTo(points[i].x, points[i].y);
    context.stroke();
  }
}
function paint(context: CanvasRenderingContext2D, grid: boolean) {
  context.fillStyle = PAPER;
  context.fillRect(0, 0, width, height);
  if (grid) {
    const step = 28 * 2 ** Math.ceil(Math.log2(0.6 / view.zoom));
    const spacing = step * view.zoom;
    const ox = ((view.x % spacing) + spacing) % spacing;
    const oy = ((view.y % spacing) + spacing) % spacing;
    context.fillStyle = '#d9d9d0';
    context.beginPath();
    for (let x = ox; x < width; x += spacing) for (let y = oy; y < height; y += spacing) {
      context.moveTo(x + .7, y); context.arc(x, y, .7, 0, Math.PI * 2);
    }
    context.fill();
  }
  const start = worldPoint(0, 0, view), end = worldPoint(width, height, view);
  const visible = { minX: start.x, minY: start.y, maxX: end.x, maxY: end.y };
  context.save();
  context.translate(view.x, view.y); context.scale(view.zoom, view.zoom);
  for (const stroke of strokes) if (intersects(stroke.bounds, visible)) drawStroke(context, stroke);
  if (active) drawStroke(context, active);
  context.restore();
}
function render() {
  frame = 0;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paint(ctx, true);
  $('zoom-label').textContent = `${Math.round(view.zoom * 100)}%`;
  $('welcome').classList.toggle('hidden', strokes.length > 0 || Boolean(active));
}
function resize() {
  const nextWidth = innerWidth, nextHeight = innerHeight;
  view = { ...view, x: view.x + (nextWidth - width) / 2, y: view.y + (nextHeight - height) / 2 };
  width = nextWidth; height = nextHeight;
  dpr = Math.min(devicePixelRatio || 1, 3);
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  invalidate();
}
addEventListener('resize', resize);
resize();
function changeZoom(factor: number, x = width / 2, y = height / 2) {
  view = zoomAt(view, x, y, factor); scheduleSave(); invalidate();
}
$('zoom-in').onclick = () => { finishInteraction(); changeZoom(1.25); };
$('zoom-out').onclick = () => { finishInteraction(); changeZoom(0.8); };
$('reset-view').onclick = () => {
  finishInteraction(); view = { x: width / 2, y: height / 2, zoom: 1 }; scheduleSave(); invalidate();
};
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (drawPointer !== undefined) return;
  const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1);
  changeZoom(Math.exp(-Math.max(-100, Math.min(100, delta)) * .005), e.clientX, e.clientY);
}, { passive: false });
canvas.oncontextmenu = (e) => e.preventDefault();
function point(e: PointerEvent): Point {
  return { ...worldPoint(e.clientX, e.clientY, view), p: e.pointerType === 'pen' ? Math.max(.05, e.pressure) : .7 };
}
function erase(e: PointerEvent) {
  const p = worldPoint(e.clientX, e.clientY, view);
  const next = strokes.filter(s => !hitStroke(s, p, 12 / view.zoom));
  if (next.length !== strokes.length) { strokes = next; invalidate(); }
}
function touchGeometry() {
  const values = [...touches.values()];
  if (values.length === 1) return { ...values[0], distance: 0 };
  return { x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2, distance: Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y) };
}
canvas.addEventListener('pointerdown', (e) => {
  if (!ready || (e.button !== 0 && e.button !== 1 && !(e.pointerType === 'pen' && e.button === 5))) return;
  e.preventDefault();
  canvas.focus({ preventScroll: true });
  canvas.setPointerCapture(e.pointerId);
  if (e.pointerType === 'touch') {
    if (drawPointer !== undefined || panPointer !== undefined) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    return;
  }
  if (drawPointer !== undefined || panPointer !== undefined) return;
  touches.clear();
  if (space || tool === 'hand' || e.button === 1) {
    panPointer = e.pointerId; lastPan = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = 'grabbing'; return;
  }
  drawPointer = e.pointerId;
  if (tool === 'eraser' || e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32))) {
    eraseBefore = strokes; erase(e);
  } else {
    const p = point(e);
    active = { id: crypto.randomUUID(), color, width: size, points: [p], bounds: boundsOf([p], size) };
    invalidate();
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (touches.has(e.pointerId)) {
    const before = touchGeometry();
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const after = touchGeometry();
    const anchor = worldPoint(before.x, before.y, view);
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * (before.distance > 5 ? after.distance / before.distance : 1)));
    view = { x: after.x - anchor.x * zoom, y: after.y - anchor.y * zoom, zoom };
    scheduleSave(); invalidate(); return;
  }
  if (panPointer === e.pointerId) {
    view = { ...view, x: view.x + e.clientX - lastPan.x, y: view.y + e.clientY - lastPan.y };
    lastPan = { x: e.clientX, y: e.clientY }; scheduleSave(); invalidate(); return;
  }
  if (drawPointer !== e.pointerId) return;
  if (eraseBefore) { erase(e); return; }
  if (!active) return;
  const events = e.getCoalescedEvents?.();
  for (const event of events?.length ? events : [e]) {
    const p = point(event), last = active.points.at(-1)!;
    if (Math.hypot(p.x - last.x, p.y - last.y) * view.zoom < .4) continue;
    active.points.push(p); expandBounds(active.bounds, p, active.width);
  }
  invalidate();
});
function finishInteraction() {
  if (active) {
    const before = strokes;
    strokes = [...strokes, active]; active = undefined;
    remember(before);
  }
  if (eraseBefore && eraseBefore !== strokes) remember(eraseBefore);
  eraseBefore = undefined;
  drawPointer = panPointer = undefined;
  updateCursor(); invalidate();
}
function endPointer(e: PointerEvent) {
  touches.delete(e.pointerId);
  if (drawPointer === e.pointerId || panPointer === e.pointerId) finishInteraction();
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('lostpointercapture', endPointer);
addEventListener('blur', () => { space = false; touches.clear(); finishInteraction(); });
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).matches('input, textarea, select') || !ready) return;
  const key = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && (key === 'z' || key === 'y')) {
    e.preventDefault(); historyMove(key === 'y' || e.shiftKey ? 'redo' : 'undo'); return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space') { e.preventDefault(); space = true; updateCursor(); }
  if (key === 'p') selectTool('pen');
  if (key === 'e') selectTool('eraser');
  if (key === 'h') selectTool('hand');
});
addEventListener('keyup', (e) => { if (e.code === 'Space') { space = false; updateCursor(); } });
$('clear').onclick = () => {
  if (!ready) return;
  finishInteraction();
  if (!strokes.length || !confirm('Clear this canvas? You can undo this action. Download a file first to keep a backup.')) return;
  const before = strokes; strokes = []; remember(before); invalidate();
};
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
function filename(extension: string) { return `pen-${new Date().toISOString().slice(0, 10)}.${extension}`; }
$('export').onclick = () => {
  if (!ready) return;
  finishInteraction();
  download(new Blob([JSON.stringify(snapshot())], { type: 'application/json' }), filename('pen.json'));
  toast('Drawing downloaded. Keep it as a backup or open it on another device.');
};
$('png').onclick = () => {
  if (!ready) return;
  finishInteraction();
  const output = document.createElement('canvas');
  output.width = canvas.width; output.height = canvas.height;
  const context = output.getContext('2d')!;
  context.scale(dpr, dpr); paint(context, false);
  output.toBlob(blob => { if (blob) download(blob, filename('png')); else toast('Image export failed. Try a smaller browser window.'); });
};
$('open').onclick = () => { if (ready) $<HTMLInputElement>('file').click(); };
$<HTMLInputElement>('file').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0]; input.value = '';
  if (!file) return;
  try {
    if (file.size > 50_000_000) throw new Error('File is too large (maximum 50 MB).');
    const drawing = parseDrawing(JSON.parse(await file.text()));
    finishInteraction();
    if (strokes.length && !confirm('Replace the current canvas with this drawing? You can undo this action.')) return;
    const before = strokes;
    strokes = drawing.strokes; view = drawing.view;
    remember(before); invalidate(); toast('Drawing opened.');
  } catch (error) { toast(error instanceof Error ? error.message : 'Could not open this drawing.'); }
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { touches.clear(); finishInteraction(); void persist(); }
});
addEventListener('pagehide', () => { finishInteraction(); void persist(); });
addEventListener('beforeunload', (e) => {
  if (dirty || active) { void persist(); e.preventDefault(); e.returnValue = ''; }
});

async function start() {
  try {
    const stored = await load();
    if (stored) { const drawing = parseDrawing(stored); strokes = drawing.strokes; view = drawing.view; }
    status('Saved on this device');
  } catch {
    status('Storage unavailable — use files', true);
    toast('Could not restore local drawing. Use Open for a backup, or Save file to keep new work.');
  }
  ready = true; invalidate();
}
void start();
