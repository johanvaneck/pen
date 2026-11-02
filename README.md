# Pen

A little room for big ideas. A static, infinite drawing canvas at **https://pen.v3ck.com**.

## Use

- **Draw:** Apple Pencil, a pressure-sensitive stylus, or left mouse button. Touch is reserved for navigation to avoid palm marks.
- **Move:** one-finger drag, two-finger pan/pinch, the hand tool, Space + drag, or middle mouse drag.
- **Zoom:** mouse wheel, pinch, or the zoom buttons. Click the percentage to reset to the origin at 100%.
- **Tools:** P = pen, E = whole-stroke eraser, H = hand. The physical eraser end of compatible pens is also supported.
- **History:** ⌘/Ctrl Z to undo; ⌘/Ctrl Shift Z or Ctrl Y to redo. Clear canvas can be undone.
- **Backups:** Save file downloads an editable `.pen.json` drawing. Open restores one. PNG exports the visible canvas without the dot grid or interface.

Drawings autosave in **IndexedDB on the current browser/device and origin**. There is no account, backend, sync, analytics, or transmission of drawing data. Fonts are self-hosted. Browser storage can be cleared or evicted; download files for durable backups and moving between devices. Use one tab at a time (multiple tabs do not merge their changes). A different domain/protocol uses separate local storage.

Apple Pencil pressure, palm rejection, and pinch behavior use standard Pointer Events and should be checked on a real iPad/Safari. Browsers/OSes may reserve stylus gestures such as double-tap; those are not mapped here.

## Development

Requires Node.js 22.12+ (CI uses Node 24).

```sh
npm ci
npm run dev
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

TypeScript + Vite, Canvas 2D, Pointer Events, and IndexedDB. Strokes are stored as pressure-bearing world-coordinate points; pan/zoom transforms the view, bounds cull offscreen strokes, and coalesced pointer events improve stylus sampling. Zoom is bounded to 5%–1600%, not the canvas coordinates. Undo keeps the last 100 edits in memory; it does not survive reload. Rendering and storage are bounded by browser/device resources, not an artificial page size. JSON imports are validated, capped at 50 MB and one million points.

## Deployment

Repository: https://github.com/johanvaneck/pen

Pushes to `main` run unit tests, type checking, a production build, and Chromium interaction tests. Only a successful build deploys the `dist/` artifact to GitHub Pages. Pull requests run the same checks without deployment.

- GitHub Pages: Actions source, custom domain `pen.v3ck.com`. After deployment, a separate Actions job waits up to an hour for GitHub's TLS certificate and enforces HTTPS automatically. It fails visibly if certificate issuance does not finish in that time.
- Cloudflare: DNS-only CNAME `pen` → `johanvaneck.github.io`. DNS-only lets GitHub issue and renew its TLS certificate directly; traffic is served by GitHub Pages, not Netcup.
- `public/CNAME` preserves the domain in the output. All app URLs use the domain root.
- No server, Docker, Dokploy, or secret credentials are needed in the repository or CI.

A prior commit can be redeployed by reverting it on `main`. Do not remove the DNS record until the Pages domain is detached if retiring the site.
