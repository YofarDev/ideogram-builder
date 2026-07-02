import { state } from './state.js';
import { on, emit } from './events.js';
import { showToast } from './toast.js';
import { fetchConfig, populateModelSelect, populateLLMVisionModels } from './vision-config.js';

let isProcessing = false;
let processed = false;
let internalImageLoad = false;
const MAX_DIM = 512;

function downscaleImage(dataUrl, maxDim) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // Always re-encode to JPEG at <= maxDim: a small-pixel PNG can still be
      // multi-MB raw, which VLM endpoints reject/drop. scale is capped at 1 so
      // images already <= maxDim are never upscaled, only re-encoded.
      const scale = Math.min(1, maxDim / img.width, maxDim / img.height);
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = dataUrl;
  });
}

export function initVision() {
  const dropzone = document.getElementById('vision-dropzone');
  const fileInput = document.getElementById('vision-file-input');
  const preview = document.getElementById('vision-preview');
  const previewImg = document.getElementById('vision-preview-img');
  const changeBtn = document.getElementById('vision-change-btn');
  const processBtn = document.getElementById('btn-vision-process');
  const statusEl = document.getElementById('vision-status');

  let currentFile = null;

  document.getElementById('btn-vision-config')?.addEventListener('click', () => fetch('/api/open-config'));

  // Populate vision model dropdown from config (via vision-config.js)
  const visionModelSelect = document.getElementById('vision-model');
  const modelRow = document.getElementById('vision-model-row');
  const unavailableEl = document.getElementById('vision-model-unavailable');
  const pipelineSelect = document.getElementById('vision-pipeline');
  const pipelineLabel = document.getElementById('vision-pipeline-label');
  const noSamCheckbox = document.getElementById('vision-no-sam');
  const bboxFormatSelect = document.getElementById('vision-bbox-format');
  const savedPipeline = localStorage.getItem('vision_pipeline');
  if (savedPipeline && pipelineSelect) pipelineSelect.value = savedPipeline;
  const savedBboxFormat = localStorage.getItem('vision_bbox_format');
  if (savedBboxFormat && bboxFormatSelect) bboxFormatSelect.value = savedBboxFormat;
  bboxFormatSelect?.addEventListener('change', () => {
    localStorage.setItem('vision_bbox_format', bboxFormatSelect.value);
  });

  fetchConfig().then(config => {
    if (!config) return;
    populateModelSelect(visionModelSelect, config, 'vision', 'api_key');
    populateLLMVisionModels(visionModelSelect, config);
    if (!visionModelSelect.options.length) {
      modelRow.style.display = 'none';
      unavailableEl.style.display = 'flex';
    }
    visionModelSelect.dispatchEvent(new Event('change'));
  });

  // Show/hide local options when model selection changes
  const visionOptions = document.getElementById('vision-options');
  const visionStyleLabel = document.getElementById('vision-style-label');
  const visionStyleSelect = document.getElementById('vision-style-preset');
  function updatePipelineVisibility() {
    const isLocal = visionModelSelect.value === 'local';
    const isSplit = pipelineSelect?.value === 'split';
    if (pipelineLabel) pipelineLabel.style.display = isLocal ? '' : 'none';
    if (pipelineSelect) pipelineSelect.style.display = isLocal ? '' : 'none';
    if (visionOptions) visionOptions.style.display = isLocal ? 'flex' : 'none';
    const styleVisible = isLocal && isSplit;
    if (visionStyleLabel) visionStyleLabel.style.display = styleVisible ? '' : 'none';
    if (visionStyleSelect) visionStyleSelect.style.display = styleVisible ? '' : 'none';
    const noSamRow = noSamCheckbox?.closest('.vision-option');
    if (noSamRow) noSamRow.style.display = (isLocal && !isSplit) ? '' : 'none';
  }
  visionModelSelect.addEventListener('change', updatePipelineVisibility);
  pipelineSelect?.addEventListener('change', () => {
    localStorage.setItem('vision_pipeline', pipelineSelect.value);
    updatePipelineVisibility();
  });
  updatePipelineVisibility();

  // Populate vision style preset select
  (function populateStylePresets() {
    const sel = document.getElementById('vision-style-preset');
    if (!sel) return;
    try {
      const presets = JSON.parse(localStorage.getItem('ideogram_style_presets')) || [];
      presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        sel.appendChild(opt);
      });
    } catch {}
  })();

  dropzone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleFile(fileInput.files[0]);
      fileInput.value = '';
    }
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-over');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
  });

  // Allow drop on entire upload area (dropzone is hidden after image load)
  const uploadArea = document.querySelector('.vision-upload');
  uploadArea.addEventListener('dragover', (e) => e.preventDefault());
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
  });

  changeBtn.addEventListener('click', () => fileInput.click());

  processBtn.addEventListener('click', () => {
    if (isProcessing) {
      fetch('/api/img-to-json/cancel', { method: 'POST' });
      return;
    }
    if (processed) {
      document.getElementById('tab-btn-editor').click();
    } else {
      processImage();
    }
  });

  on('image:ready', ({ imageUrl, source }) => {
    if (source === 'generation') return; // ponytail: don't clobber vision reference with generated results
    if (internalImageLoad) {
      internalImageLoad = false;
      return;
    }
    previewImg.src = imageUrl;
    preview.classList.add('visible');
    dropzone.classList.add('has-image');
  });

  function handleFile(file) {
    if (!file.type.startsWith('image/')) {
      showToast('Please select an image file.', 'error');
      return;
    }
    currentFile = file;
    processed = false;

    const reader = new FileReader();
    reader.onload = (e) => {
      previewImg.src = e.target.result;
      preview.classList.add('visible');
      dropzone.classList.add('has-image');
      processBtn.textContent = 'Process Image';
      processBtn.className = 'btn btn-primary';
      processBtn.disabled = false;
      statusEl.textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB`;
    };
    reader.readAsDataURL(file);
  }

  async function processImage() {
    if (!currentFile || isProcessing) return;

    isProcessing = true;
    processBtn.textContent = 'Cancel';
    processBtn.className = 'btn btn-danger';
    processBtn.disabled = false;
    visionModelSelect.disabled = true;
    statusEl.textContent = 'Processing\u2026';

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      const selectedModel = document.getElementById('vision-model').value || 'local';
      const downscaled = await downscaleImage(dataUrl, MAX_DIM);

      const body = { image: downscaled, model: selectedModel };
      body.bbox_format = bboxFormatSelect?.value || 'xyxy';
      if (selectedModel === 'local') {
        body.local_model = visionModelSelect.options[visionModelSelect.selectedIndex].textContent;
        const pipeline = pipelineSelect?.value || 'current';
        body.pipeline = pipeline;
        body.no_sam = document.getElementById('vision-no-sam')?.checked || false;
        body.low_memory = document.getElementById('vision-low-memory')?.checked || false;
        body.debug = document.getElementById('vision-debug')?.checked || false;
        const styleId = document.getElementById('vision-style-preset')?.value;
        if (styleId && pipeline === 'split') {
          try {
            const presets = JSON.parse(localStorage.getItem('ideogram_style_presets')) || [];
            const preset = presets.find(p => p.id === styleId);
            if (preset) body.style_override = {
              mode: preset.mode,
              aesthetics: preset.aesthetics,
              lighting: preset.lighting,
              medium: preset.medium,
              photo_art: preset.photo_art,
            };
          } catch {}
        }
      }

      try {
        const resp = await fetch('/api/img-to-json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          const errData = await resp.json().catch(() => null);
          const detail = errData?.detail ? ` — ${String(errData.detail).slice(0, 160)}` : '';
          throw new Error((errData?.error || `Server error (${resp.status})`) + detail);
        }

        const data = await resp.json();
        const jsonStr = JSON.stringify(data.json, null, 2);

        if (data.warnings?.length > 0) {
          data.warnings.forEach(w => showToast(w, 'warning'));
        }

        if (data.debug_dir) {
          const debugUrl = data.debug_dir.replace(/.*img-to-json/, '/img-to-json');
          statusEl.innerHTML = `<a href="${debugUrl}" target="_blank" style="color:var(--accent);">View debug artifacts</a>`;
        }

        const img = new Image();
        img.onload = () => {
          const presets = [
            { w: 1024, h: 1024 },
            { w: 1152, h: 864 },
            { w: 864, h: 1152 },
            { w: 1280, h: 720 },
            { w: 720, h: 1280 },
            { w: 1152, h: 768 },
            { w: 768, h: 1152 },
          ];

          const srcRatio = img.width / img.height;
          let best = presets[0];
          let bestDiff = Infinity;
          for (const p of presets) {
            const ratio = p.w / p.h;
            const diff = Math.abs(ratio - srcRatio);
            if (diff < bestDiff) {
              bestDiff = diff;
              best = p;
            }
          }

          state.canvas.width = best.w;
          state.canvas.height = best.h;
          document.getElementById('dim-display').textContent = `${best.w} \u00d7 ${best.h}`;
          const arSelect = document.getElementById('aspect-ratio');
          arSelect.value = `${best.w}x${best.h}`;

          internalImageLoad = true;
          emit('canvas:rebuild');
          document.getElementById('json-output').value = jsonStr;
          emit('image:ready', { imageUrl: downscaled, dataUrl: downscaled, source: 'vision', model: selectedModel });
          emit('state:loaded', { json: data.json });

          processed = true;
          processBtn.textContent = 'Load in Editor';
          processBtn.className = 'btn done';
          processBtn.disabled = false;
          statusEl.textContent = '';
          showToast('Image processed successfully.', 'success');
          currentFile = null;
        };
        img.src = dataUrl;

      } catch (err) {
        const cancelled = err.message === 'Cancelled';
        statusEl.textContent = cancelled ? '' : 'Failed';
        if (!cancelled) showToast(err.message, 'error');
        processBtn.textContent = 'Process Image';
        processBtn.className = 'btn btn-primary';
        processBtn.disabled = false;
      } finally {
        isProcessing = false;
        visionModelSelect.disabled = false;
      }
    };
    reader.readAsDataURL(currentFile);
  }
}
