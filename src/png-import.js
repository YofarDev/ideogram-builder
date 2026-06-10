// png-import.js — PNG metadata extraction, JSON load, drag-drop handling

import { state } from './state.js';
import { emit } from './events.js';

export function initImport() {
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
      importImage(e.dataTransfer.files[0]);
    }
  });
}

export function loadFromPastedJSON() {
  try {
    const json = JSON.parse(document.getElementById('json-output').value);
    emit('state:loaded', { json });
  } catch (e) {
    alert('Invalid JSON');
  }
}

async function importImage(file) {
  if (!file.type.startsWith('image')) {
    alert('Images only');
    return;
  }

  const img = new Image();
  img.onload = function () {
    // Update sliders + state dimensions
    const wSlider = document.getElementById('canvas-width');
    const hSlider = document.getElementById('canvas-height');
    wSlider.value = this.width.toString();
    wSlider.dispatchEvent(new Event('input'));
    hSlider.value = this.height.toString();
    hSlider.dispatchEvent(new Event('input'));

    // Rebuild canvas with new dimensions
    emit('canvas:rebuild');

    // Show image on canvas
    emit('image:ready', { imageUrl: img.src });

    // Try PNG metadata extraction
    if (file.type === 'image/png') {
      file.arrayBuffer().then((buff) => {
        const json = extractComfyUIMetadata(buff);
        if (json) {
          document.getElementById('json-output').value = JSON.stringify(json, null, 2);
          emit('state:loaded', { json });
        }
      });
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

  for (const key of Object.keys(result.prompt || {})) {
    try {
      const json = JSON.parse(result.prompt[key].inputs.text);
      if (json.hasOwnProperty('high_level_description')) return json;
    } catch (e) { /* skip */ }
  }
  return null;
}
