// png-import.js — PNG drag-drop metadata extraction

import { state, validCanvasSize } from './state.js';
import { emit } from './events.js';
import { showToast } from './toast.js';
import { detectPromptFormat } from './prompt-convert.js';

export function initImport() {
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length > 0) {
      importImage(e.dataTransfer.files[0]);
    }
  });
}

let importSequence = 0;

function readImageData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Image could not be read. Try another file.'));
    reader.onabort = () => reject(new Error('Image import was interrupted. Try again.'));
    reader.readAsDataURL(file);
  });
}

export async function importImage(file) {
  if (!file.type.startsWith('image')) {
    showToast('Only image files can be imported.', 'error');
    return;
  }
  const sequence = ++importSequence;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    const decoded = new Promise((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Image could not be opened. Try a PNG, JPEG, or WebP file.'));
      image.src = url;
    });
    const metadata = file.type === 'image/png'
      ? file.arrayBuffer().then(extractComfyUIMetadata).catch(() => null) : Promise.resolve(null);
    const [loaded, dataUrl, found] = await Promise.all([decoded, readImageData(file), metadata]);
    if (sequence !== importSequence) return;
    if (!validCanvasSize(loaded.naturalWidth || loaded.width, loaded.naturalHeight || loaded.height)) {
      showToast('That image is too small to use as a canvas — it loaded as a reference only.');
    } else {
      state.canvas.width = loaded.naturalWidth || loaded.width;
      state.canvas.height = loaded.naturalHeight || loaded.height;
    }
    document.getElementById('dim-display').textContent = `${state.canvas.width} × ${state.canvas.height}`;
    const aspect = document.getElementById('aspect-ratio');
    const value = `${state.canvas.width}x${state.canvas.height}`;
    if ([...aspect.options].some(option => option.value === value)) aspect.value = value;
    emit('canvas:rebuild');
    if (found) {
      const raw = found.ideogram ? JSON.stringify(found.ideogram, null, 2) : found.moss;
      document.getElementById('json-output').value = raw;
      emit('prompt:apply', { raw, quiet: true });
      showToast('PNG metadata extracted.', 'success');
    }
    emit('image:ready', { imageUrl: dataUrl, dataUrl, importJson: found ? document.getElementById('json-output').value : '' });
  } catch (error) {
    if (sequence === importSequence) showToast(error.message, 'error');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function extractComfyUIMetadata(arrayBuffer) {
  const view = new DataView(arrayBuffer);

  if (view.byteLength < 8 || view.getUint32(0) !== 0x89504E47 || view.getUint32(4) !== 0x0D0A1A0A) {
    throw new Error('Not a valid PNG file.');
  }

  let offset = 8;
  const result = {};

  while (offset < view.byteLength) {
    if (offset + 8 > view.byteLength) break;

    const length = view.getUint32(offset);
    const chunkType = String.fromCharCode(
      view.getUint8(offset + 4), view.getUint8(offset + 5),
      view.getUint8(offset + 6), view.getUint8(offset + 7),
    );
    offset += 8;

    if (chunkType === 'tEXt') {
      if (offset + length > view.byteLength) break;

      const chunkData = new Uint8Array(arrayBuffer, offset, length);
      const nullByteIndex = chunkData.indexOf(0);

      if (nullByteIndex !== -1) {
        const keyword = new TextDecoder('ascii').decode(chunkData.subarray(0, nullByteIndex));

        if (keyword === 'prompt' || keyword === 'workflow') {
          const rawText = new TextDecoder('utf-8').decode(chunkData.subarray(nullByteIndex + 1));
          try {
            result[keyword] = JSON.parse(rawText);
          } catch (e) {
            result[keyword] = rawText;
          }
        }
      }
    }

    offset += length + 4;
  }

  // Scan every node's inputs.text — Ideogram JSON wins, else the first MOSS
  // layout (the MOSS workflow puts it in node "7", but any node counts).
  let mossRaw = null;
  for (const node of Object.values(result.prompt || {})) {
    const text = node?.inputs?.text;
    if (typeof text !== 'string' || !text.trim()) continue;
    const format = detectPromptFormat(text);
    if (format === 'ideogram') return { ideogram: JSON.parse(text) };
    if (!mossRaw && (format === 'moss' || format === 'moss-draft')) mossRaw = text;
  }
  return mossRaw ? { moss: mossRaw } : null;
}

export { extractComfyUIMetadata };
