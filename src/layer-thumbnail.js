// Cache one thumbnail per live row; unrelated prompt edits reuse it.
export function updateThumbnail(row, box) {
  const overlay = document.getElementById('canvas-overlay');
  const ready = overlay?.classList.contains('visible') && overlay.complete && overlay.naturalWidth > 0;
  const color = box.color || box.colors?.[0] || 'var(--accent)';
  const key = JSON.stringify([box.x, box.y, box.w, box.h, color, ready && overlay.src, ready && overlay.naturalWidth, ready && overlay.naturalHeight]);
  if (row.dataset.thumbnailKey === key) return;
  row.dataset.thumbnailKey = key;
  const thumbnail = row.querySelector('.layer-thumb');
  thumbnail.replaceChildren();
  thumbnail.style.backgroundImage = '';
  if (ready) {
    try {
      const width = box.w / 1000 * overlay.naturalWidth;
      const height = box.h / 1000 * overlay.naturalHeight;
      if (width >= 2 && height >= 2) {
        const canvas = document.createElement('canvas');
        canvas.width = 72;
        canvas.height = 56;
        // Match object-fit: cover in the 36×28 preview, with bounded output.
        const ratio = Math.min(width / 72, height / 56);
        const sw = 72 * ratio, sh = 56 * ratio;
        const sx = box.x / 1000 * overlay.naturalWidth + (width - sw) / 2;
        const sy = box.y / 1000 * overlay.naturalHeight + (height - sh) / 2;
        canvas.getContext('2d').drawImage(overlay, sx, sy, sw, sh, 0, 0, 72, 56);
        thumbnail.style.backgroundImage = `url(${canvas.toDataURL()})`;
        thumbnail.style.backgroundSize = 'cover';
        return;
      }
    } catch { /* A cross-origin image can still use the position indicator. */ }
  }
  const indicator = document.createElement('span');
  indicator.className = 'layer-thumb-inner';
  Object.assign(indicator.style, {
    left: `${box.x / 10}%`, top: `${box.y / 10}%`,
    width: `${Math.max(4, box.w / 10)}%`, height: `${Math.max(4, box.h / 10)}%`,
    borderColor: color, background: `color-mix(in srgb, ${color} 12%, transparent)`,
  });
  thumbnail.appendChild(indicator);
}
