import { beforeEach, describe, expect, it, vi } from 'vitest';

const response = data => ({ ok: true, status: 200, json: async () => data });

function dom() {
  document.body.innerHTML = `
    <div id="modal-account-wrap" hidden>
      <select id="modal-account"></select>
      <span id="modal-usage"></span>
    </div>
    <div id="toast-container"></div>`;
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  dom();
});

describe('Modal account picker', () => {
  it('lists accounts, shows usage, and posts the switch', async () => {
    localStorage.setItem('ideogram_backend', 'modal');
    const fetchMock = vi.fn(async (url, opts) => {
      if (url === '/api/config') {
        return response({ modal: { active: 'yofarcorp', accounts: ['yofarcorp', 'yofardev'] } });
      }
      if (url.startsWith('/api/modal/usage')) {
        return response({ remaining: 17.5, metered_cost: 12.5, monthly_credits: 30, billed_cost: 0 });
      }
      if (url === '/api/modal/active') {
        return response({ active: 'yofardev', accounts: ['yofarcorp', 'yofardev'] });
      }
      return response({});
    });
    vi.stubGlobal('fetch', fetchMock);
    const { initModalAccounts } = await import('../modal-accounts.js');
    const { on } = await import('../events.js');
    const changed = vi.fn();
    on('config:changed', changed);
    initModalAccounts();

    const select = document.getElementById('modal-account');
    await vi.waitFor(() => {
      expect(select.options.length).toBe(2);
      expect(document.getElementById('modal-account-wrap').hidden).toBe(false);
      expect(document.getElementById('modal-usage').textContent).toBe('$17.50 left');
    });

    select.value = 'yofardev';
    select.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());

    const post = fetchMock.mock.calls.find(([url]) => url === '/api/modal/active');
    expect(JSON.parse(post[1].body)).toEqual({ name: 'yofardev' });
    expect(select.value).toBe('yofardev');
    vi.unstubAllGlobals();
  });

  it('stays hidden on the RunPod backend', async () => {
    localStorage.setItem('ideogram_backend', 'runpod');
    vi.stubGlobal('fetch', vi.fn(async url => url === '/api/config'
      ? response({ modal: { active: 'yofarcorp', accounts: ['yofarcorp'] } }) : response({})));
    const { initModalAccounts } = await import('../modal-accounts.js');
    initModalAccounts();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(document.getElementById('modal-account-wrap').hidden).toBe(true);
    vi.unstubAllGlobals();
  });
});
