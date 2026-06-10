import { on } from './events.js';
import { emit } from './events.js';

const STORAGE_KEY = 'ideogram_history';
const MAX_ITEMS = 30;

export function initGallery() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    renderGallery();

    const btnOpen = document.getElementById('btn-open-output');
    if (btnOpen) {
        btnOpen.addEventListener('click', () => {
            fetch('/api/open-output');
        });
    }

    on('image:ready', ({ imageUrl, dataUrl, skipSave }) => {
        if (skipSave) return;
        saveToGallery(imageUrl, dataUrl);
        if (dataUrl) saveToDisk(dataUrl, document.getElementById('json-output').value);
    });
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tab}`));
    if (tab === 'gallery') renderGallery();
}

function getHistory() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
        return [];
    }
}

function saveHistory(items) {
    const trimmed = items.slice(0, MAX_ITEMS);
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
        for (let i = trimmed.length - 1; i >= 1; i--) {
            delete trimmed[i].full_image;
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
                return;
            } catch {}
        }
        delete trimmed[0].full_image;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
        } catch {
            localStorage.removeItem(STORAGE_KEY);
        }
    }
}

function saveToGallery(imageUrl, dataUrl) {
    const promptJson = document.getElementById('json-output').value;
    const aspectRatio = document.getElementById('aspect-ratio').value;
    const selected = document.getElementById('ai-model').value;
    const [provider, model] = (selected || '').split('::');

    createThumbnail(imageUrl, (thumbnail) => {
        const items = getHistory();
        items.unshift({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            timestamp: Date.now(),
            thumbnail,
            full_image: dataUrl || '',
            prompt_json: promptJson,
            aspect_ratio: aspectRatio,
            provider: provider || '',
            model: model || '',
        });
        saveHistory(items);
    });
}

function createThumbnail(imageUrl, callback) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        const maxW = 200;
        const scale = maxW / img.width;
        const canvas = document.createElement('canvas');
        canvas.width = maxW;
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        callback(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => callback('');
    img.src = imageUrl;
}

function renderGallery() {
    const grid = document.getElementById('gallery-grid');
    const empty = document.getElementById('gallery-empty');
    const items = getHistory();

    grid.innerHTML = '';

    if (items.length === 0) {
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'gallery-card';

        const date = new Date(item.timestamp);
        const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

        let desc = '';
        try {
            const j = JSON.parse(item.prompt_json);
            desc = j.high_level_description || item.prompt_json.slice(0, 80);
        } catch {
            desc = item.prompt_json?.slice(0, 80) || 'No prompt';
        }

        card.innerHTML = `
            ${item.thumbnail ? `<img src="${item.thumbnail}" alt="Generation">` : ''}
            <div class="gallery-card-info">
                <button class="gallery-card-delete" data-id="${item.id}" title="Delete">&times;</button>
                <div class="gallery-card-date">${dateStr}</div>
                <div class="gallery-card-prompt">${escapeHtml(desc)}</div>
            </div>
        `;

        card.querySelector('.gallery-card-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteItem(item.id);
        });

        card.addEventListener('click', () => loadItem(item));

        grid.appendChild(card);
    });
}

function deleteItem(id) {
    const items = getHistory().filter(i => i.id !== id);
    saveHistory(items);
    renderGallery();
}

function loadItem(item) {
    if (item.aspect_ratio) {
        const sel = document.getElementById('aspect-ratio');
        if (sel.querySelector(`option[value="${item.aspect_ratio}"]`)) {
            sel.value = item.aspect_ratio;
            sel.dispatchEvent(new Event('change'));
        }
    }

    if (item.full_image) {
        emit('image:ready', { imageUrl: item.full_image, dataUrl: item.full_image, skipSave: true });
    }

    if (item.prompt_json) {
        document.getElementById('json-output').value = item.prompt_json;
        try {
            const json = JSON.parse(item.prompt_json);
            emit('state:loaded', { json });
        } catch {}
    }

    switchTab('editor');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function saveToDisk(dataUrl, promptJson) {
    try {
        fetch('/api/save-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl, promptJson: promptJson || '' }),
        });
    } catch {}
}
