import { toPhoto, type PhotoGeometry } from './avatars';
import { faceBox } from './front';
import type { DropReason, FacePoints } from './faces';

/**
 * Boxes round the faces the tracker found, on the live preview only, for
 * working out at the venue why someone is or is not in the cut-out. A debug
 * switch of its own (Settings > Background > Show face boxes); never drawn
 * into a photo, because only the preview's scene carries them.
 *
 * Green: in the group, so cut out and given avatars. Amber: found, but beyond
 * the distance line. Red, dashed: found, then set aside by the tracker itself,
 * labelled with why. Someone with no box at all was never found.
 */

export type OverlayState = 'group' | 'beyond' | 'dropped';

export interface OverlayFace { face: FacePoints; state: OverlayState; label: string }

const COLOUR: Record<OverlayState, string> = {
  group: '#16a34a',
  beyond: '#d97706',
  dropped: '#e1262f',
};

export const DROP_LABEL: Record<DropReason, string> = {
  edge: 'set aside: on a tile edge',
  big: 'set aside: too big for a tile',
  ghost: 'set aside: taken for someone who moved',
  duplicate: 'set aside: same as another face',
};

/** Draw each face's box and label, through the photo's crop, mirror and rotation. */
export function drawTrackingOverlay(
  ctx: CanvasRenderingContext2D, faces: OverlayFace[], g: PhotoGeometry,
) {
  if (!faces.length || typeof ctx.setLineDash !== 'function') return;
  const lw = Math.max(2, g.dw / 450);
  const fontPx = Math.max(11, Math.round(g.dw / 75));
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.dx, g.dy, g.dw, g.dh);
  ctx.clip();
  ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
  ctx.textBaseline = 'bottom';

  for (const { face, state, label } of faces) {
    const b = faceBox(face);
    const corners = [
      { x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 },
    ].map(p => toPhoto(p, g));

    ctx.beginPath();
    corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.setLineDash(state === 'dropped' ? [lw * 3, lw * 2] : []);
    ctx.lineWidth = lw;
    ctx.strokeStyle = COLOUR[state];
    ctx.stroke();

    // The label on a tab above the box, white on the box's colour.
    const left = Math.min(...corners.map(p => p.x));
    const top = Math.min(...corners.map(p => p.y));
    const pad = Math.round(fontPx * 0.3);
    const textW = ctx.measureText(label).width;
    ctx.setLineDash([]);
    ctx.fillStyle = COLOUR[state];
    ctx.fillRect(left - lw / 2, top - fontPx - pad * 2, textW + pad * 2, fontPx + pad * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, left - lw / 2 + pad, top - pad);
  }
  ctx.restore();
}
