import { on, emit } from './events.js';
import { escapeHtml } from './escape-html.js';
import { state } from './state.js';
import { detectPromptFormat } from './prompt-convert.js';
import { restoreMeta } from './gallery-meta.js';

export function initGallery() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    // Sync layout class with the initially active tab
    const activeTab = document.querySelector('.tab-btn.active');
    if (activeTab) {
        const tab = activeTab.dataset.tab;
        const mc = document.querySelector('.main-content');
        mc.classList.toggle('gallery-active', tab === 'gallery');
        mc.classList.toggle('vision-active', tab === 'vision');
        mc.classList.toggle('prompt-active', tab === 'prompt');
        mc.classList.toggle('json2caption-active', tab === 'json2caption');
        mc.classList.toggle('collections-active', tab === 'collections');
    }
    renderGallery();

    const btnOpen = document.getElementById('btn-open-output');
    if (btnOpen) {
        btnOpen.addEventListener('click', () => {
            fetch('/api/open-output');
        });
    }

    let lastSaveTime = 0;
    let lastSaveDataUrl = '';

    // ponytail: disk is the source of truth — just save the image+prompt there, gallery lists the folder
    on('image:ready', ({ dataUrl, importJson, loras, skipSave, meta }) => {
        if (skipSave || !dataUrl) return;
        const now = Date.now();
        if (dataUrl === lastSaveDataUrl && now - lastSaveTime < 3000) return;
        lastSaveTime = now;
        lastSaveDataUrl = dataUrl;
        saveToDisk(dataUrl, importJson ?? document.getElementById('json-output').value, loras, meta);
    });
}

// Tabs reached through a grouped top-level button (Assist → its sub-tabs)
const ASSIST_TABS = ['prompt', 'vision', 'json2caption'];

function switchTab(tab) {
    // The Assist top button remembers the last sub-tab, so it reopens there and
    // stays highlighted while any of its sub-tabs is active.
    const group = document.querySelector('.tab-btn[data-tab-group="assist"]');
    if (group && ASSIST_TABS.includes(tab)) group.dataset.tab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => {
        const isActive = b.dataset.tab === tab;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-selected', isActive);
    });
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tab}`));
    const mc = document.querySelector('.main-content');
    mc.classList.toggle('gallery-active', tab === 'gallery');
    mc.classList.toggle('vision-active', tab === 'vision');
    mc.classList.toggle('prompt-active', tab === 'prompt');
    mc.classList.toggle('json2caption-active', tab === 'json2caption');
    mc.classList.toggle('collections-active', tab === 'collections');
    if (tab === 'gallery') renderGallery();
}

async function renderGallery() {
    const grid = document.getElementById('gallery-grid');
    const empty = document.getElementById('gallery-empty');
    grid.innerHTML = '';

    let items = [];
    try {
        const res = await fetch('/api/list-output');
        items = await res.json();
    } catch {}

    if (items.length === 0) {
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    const frag = document.createDocumentFragment();
    items.forEach(item => {
        const date = new Date(item.mtime * 1000);
        const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

        let desc = '';
        let isVision = false;
        try {
            const j = JSON.parse(item.prompt_json);
            isVision = j._source === 'vision';
            desc = j.high_level_description || item.prompt_json.slice(0, 80);
        } catch {
            desc = item.prompt_json?.slice(0, 80) || 'No prompt';
        }

        const card = document.createElement('div');
        card.className = 'gallery-card' + (isVision ? ' vision-sourced' : '');

        card.innerHTML = `
            <img src="/output/${item.img}" alt="" loading="lazy" decoding="async">
            <div class="gallery-card-info">
                <div class="gallery-card-actions">
                    <button class="gallery-card-btn add-collection" title="Add prompt to collection" aria-label="Add prompt to collection"><span aria-hidden="true">+</span></button>
                    <button class="gallery-card-btn download" title="Download image" aria-label="Download image"><span aria-hidden="true">&darr;</span></button>
                    <button class="gallery-card-btn delete" title="Delete" aria-label="Delete"><span aria-hidden="true">&times;</span></button>
                </div>
                <div class="gallery-card-date">${dateStr}</div>
                <span class="gallery-card-model">${item.meta?.model === 'moss' ? 'MOSS' : 'Ideogram'}</span>
                <div class="gallery-card-prompt">${escapeHtml(desc)}</div>
            </div>
        `;

        card.querySelector('.gallery-card-btn.download').addEventListener('click', (e) => {
            e.stopPropagation();
            downloadImage(item);
        });

        card.querySelector('.gallery-card-btn.add-collection').addEventListener('click', (e) => {
            e.stopPropagation();
            emit('collection:add', { importJson: item.prompt_json || '', imageUrl: `/output/${item.img}`, model: item.meta?.model || 'ideogram' });
        });

        card.querySelector('.gallery-card-btn.delete').addEventListener('click', async (e) => {
            e.stopPropagation();
            await deleteItem(item.id);
        });

        card.addEventListener('click', () => loadItem(item));

        frag.appendChild(card);
    });
    grid.appendChild(frag);
}

async function deleteItem(id) {
    try {
        await fetch('/api/delete-output', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: id }),
        });
    } catch {}
    renderGallery();
}

function loadItem(item) {
    emit('image:ready', { imageUrl: `/output/${item.img}`, skipSave: true });

    if (item.prompt_json) {
        document.getElementById('json-output').value = item.prompt_json;
        const format = detectPromptFormat(item.prompt_json);
        if (format === 'moss' || format === 'moss-draft') {
            // MOSS layout — same path as pasting it (model switch + parsed boxes)
            emit('prompt:apply', { raw: item.prompt_json });
        } else {
            try {
                const json = JSON.parse(item.prompt_json);
                emit('state:loaded', { json });
            } catch {}
        }
    }

    if (item.meta && Object.keys(item.meta).length > 0) {
        restoreMeta(item.meta);
    }

    switchTab('editor');
    emit('canvas:relayout');
}

function downloadImage(item) {
    const a = document.createElement('a');
    a.href = `/output/${item.img}`;
    a.download = item.img;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

async function saveToDisk(dataUrl, promptJson, loras, meta) {
    const loraList = loras ?? state.loras;
    const loraSuffix = loraList.map(l => l.filename.replace(/\.safetensors$/, '')).join('+') || undefined;
    try {
        await fetch('/api/save-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl, promptJson: promptJson || '', loraSuffix, meta: meta || undefined }),
        });
    } catch {}
}
