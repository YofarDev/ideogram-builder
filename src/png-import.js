// png-import.js — PNG drag-drop metadata extraction

import { state } from './state.js';
import { emit } from './events.js';
import { showToast } from './toast.js';
import { detectPromptFormat } from './prompt-convert.js';

export function initImport() {
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
      importImage(e.dataTransfer.files[0]);
    }
  });
}

async function importImage(file) {
  if (!file.type.startsWith('image')) {
    showToast('Only image files can be imported.', 'error');
    return;
  }

  const img = new Image();
  img.onload = function () {
    state.canvas.width = this.width;
    state.canvas.height = this.height;
    document.getElementById('dim-display').textContent = `${this.width} × ${this.height}`;
    const arSelect = document.getElementById('aspect-ratio');
    const val = `${this.width}x${this.height}`;
    if (Array.from(arSelect.options).some(o => o.value === val)) {
      arSelect.value = val;
    }

    emit('canvas:rebuild');

    const reader = new FileReader();
    reader.onload = () => {
      emit('image:ready', { imageUrl: img.src, dataUrl: reader.result });
    };
    reader.readAsDataURL(file);

    if (file.type === 'image/png') {
      file.arrayBuffer().then((buff) => {
        const found = extractComfyUIMetadata(buff);
        if (!found) return;
        if (found.ideogram) {
          document.getElementById('json-output').value = JSON.stringify(found.ideogram, null, 2);
          emit('state:loaded', { json: found.ideogram });
        } else {
          // MOSS layout (any node's inputs.text) — shared apply path switches
          // the model and rebuilds boxes from the parsed layout
          emit('prompt:apply', { raw: found.moss });
        }
        showToast('PNG metadata extracted.', 'success');
      }).catch(() => { /* non-critical */ });
    }
  };
  img.src = URL.createObjectURL(file);
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
