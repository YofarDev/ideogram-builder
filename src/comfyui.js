// comfyui.js — ComfyUI API integration: send prompt, poll results

import { state } from './state.js';
import { emit } from './events.js';
import { COMFYUI_WORKFLOW } from './comfyui-template.js';

export async function generateImage() {
  const api = document.getElementById('api-location').value;
  const jsonText = document.getElementById('json-output').value;
  const seed = document.getElementById('r-seed').value;

  const workflow = JSON.parse(JSON.stringify(COMFYUI_WORKFLOW));
  workflow['98:24']['inputs']['text'] = jsonText;
  workflow['98:27']['inputs']['value'] = state.canvas.width;
  workflow['98:28']['inputs']['value'] = state.canvas.height;
  workflow['98:18']['inputs']['noise_seed'] = parseInt(seed);

  let response = await fetch(api + '/api/prompt', {
    headers: { 'accept': '*/*', 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
    method: 'POST',
  });

  response = await response.json();
  const results = await waitForComfyUIResult(response.prompt_id, api, 3000, 300000, true);
  emit('image:ready', { imageUrl: results[0].imageUrl });
}

async function waitForComfyUIResult(promptId, serverUrl, pollInterval = 1000, timeout = 300000, fetchImages = true) {
  const startTime = Date.now();

  while (true) {
    if (Date.now() - startTime > timeout) {
      throw new Error(`Timed out waiting for prompt ${promptId}`);
    }

    const response = await fetch(`${serverUrl}/history/${encodeURIComponent(promptId)}`);
    if (!response.ok) throw new Error(`Failed to fetch history: ${response.status}`);

    const history = await response.json();
    if (history[promptId]) {
      const outputs = history[promptId].outputs || {};
      const results = [];

      for (const nodeId of Object.keys(outputs)) {
        const nodeOutput = outputs[nodeId];
        if (!nodeOutput.images) continue;

        for (const image of nodeOutput.images) {
          const imageUrl = `${serverUrl}/view?` + new URLSearchParams({
            filename: image.filename,
            subfolder: image.subfolder || '',
            type: image.type || 'output',
          });

          const result = { nodeId, imageUrl, filename: image.filename, subfolder: image.subfolder, type: image.type };

          if (fetchImages) {
            const imgResp = await fetch(imageUrl);
            result.blob = await imgResp.blob();
          }

          results.push(result);
        }
      }
      return results;
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
}
