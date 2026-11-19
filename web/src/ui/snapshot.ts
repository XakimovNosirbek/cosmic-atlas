/**
 * Photo Mode & Clean Snapshot export:
 *   - `toggleCleanView()` hides/restores all UI chrome (also bound to the `H` key) so the user can
 *     admire or screen-record the pure 3D sky.
 *   - `captureSnapshot()` grabs the freshly rendered WebGPU/WebGL2 canvas, composites an
 *     unobtrusive bottom-left scientific caption (title · scale · Cosmic Atlas), and triggers a
 *     PNG download.
 */

import { t } from '../i18n';

export interface SnapshotCaption {
  title: string;
  subtitle: string;
  credit?: string;
}

export function toggleCleanView(force?: boolean): boolean {
  const on = force !== undefined ? force : !document.body.classList.contains('clean-view');
  document.body.classList.toggle('clean-view', on);
  return on;
}

/**
 * Capture the live canvas synchronously right after a render pass (WebGPU drawing buffers are
 * cleared between frames, so the caller should render once right before calling this).
 */
export function captureSnapshot(canvas: HTMLCanvasElement, cap: SnapshotCaption): boolean {
  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) return false;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) return false;
  try {
    ctx.drawImage(canvas, 0, 0, w, h);
  } catch {
    return false;
  }
  const s = Math.max(1, w / 1400);
  const pad = Math.round(28 * s);
  const grad = ctx.createLinearGradient(0, h - Math.round(130 * s), 0, h);
  grad.addColorStop(0, 'rgba(4, 6, 11, 0)');
  grad.addColorStop(1, 'rgba(4, 6, 11, 0.72)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, h - Math.round(130 * s), w, Math.round(130 * s));

  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(226, 196, 142, 0.95)';
  ctx.font = `italic 500 ${Math.round(22 * s)}px Georgia, serif`;
  ctx.fillText('Cosmic Atlas', w - pad - ctx.measureText('Cosmic Atlas').width, h - pad - Math.round(18 * s));

  ctx.fillStyle = 'rgba(154, 163, 178, 0.85)';
  ctx.font = `400 ${Math.round(12.5 * s)}px system-ui, -apple-system, sans-serif`;
  const credit = cap.credit || t('photo.credit');
  ctx.fillText(credit, w - pad - ctx.measureText(credit).width, h - pad);

  ctx.fillStyle = 'rgba(236, 240, 247, 0.96)';
  ctx.font = `500 ${Math.round(24 * s)}px Georgia, serif`;
  ctx.fillText(cap.title, pad, h - pad - Math.round(20 * s));

  ctx.fillStyle = 'rgba(182, 192, 208, 0.9)';
  ctx.font = `400 ${Math.round(14 * s)}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(cap.subtitle, pad, h - pad);

  const slug = cap.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'view';
  const a = document.createElement('a');
  a.download = `cosmic-atlas-${slug}.png`;
  a.href = out.toDataURL('image/png');
  a.click();
  return true;
}
