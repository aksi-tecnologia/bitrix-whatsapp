const DEFAULTS = {
  theme: true, recorder: true, recPreview: true, player: true,
  webhookUrl: '', webhookToken: '', postReply: true, autoTranscribe: false,
  callLines: null
};
const BOOLS = ['theme', 'recorder', 'recPreview', 'player', 'postReply', 'autoTranscribe'];
const TEXTS = ['webhookUrl', 'webhookToken'];
const el = (id) => document.getElementById(id);

let lineState = null; // [{id, name, visible}] na ordem do menu
let bitrixTabId = null;

chrome.storage.sync.get(DEFAULTS, (cfg) => {
  BOOLS.forEach((k) => { el(k).checked = !!cfg[k]; });
  TEXTS.forEach((k) => { el(k).value = cfg[k] || ''; });
  loadLines(cfg.callLines);
});

function status(msg, err) {
  const s = el('status');
  s.textContent = msg;
  s.className = err ? 'err' : '';
  if (!err) setTimeout(() => { s.textContent = ''; }, 2500);
}

function dialStatus(msg, err) {
  const s = el('dialStatus');
  s.textContent = msg;
  s.className = err ? 'err' : '';
}

// ---------- conversa com a aba do Bitrix24 ----------
function ask(tabId, msg) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }, (resp) => {
        if (chrome.runtime.lastError) resolve(null); else resolve(resp || null);
      });
    } catch (e) { resolve(null); }
  });
}

async function findBitrixTab() {
  const active = await chrome.tabs.query({ active: true, currentWindow: true });
  const all = await chrome.tabs.query({});
  const ids = active.map((t) => t.id).concat(all.map((t) => t.id).filter((id) => !active.some((t) => t.id === id)));
  for (const id of ids) {
    const resp = await ask(id, { type: 'wabx:call:lines' });
    if (resp && resp.ok) return { tabId: id, resp };
  }
  return null;
}

async function loadLines(saved) {
  const found = await findBitrixTab();
  const sel = el('dialLine');
  if (!found) {
    sel.innerHTML = '<option value="">Abra o Bitrix24 numa aba</option>';
    return;
  }
  bitrixTabId = found.tabId;
  const pageLines = found.resp.lines || [];
  const byId = Object.fromEntries(pageLines.map((l) => [l.id, l]));

  const state = [];
  (Array.isArray(saved) ? saved : []).forEach((s) => {
    if (byId[s.id]) state.push({ id: s.id, name: byId[s.id].name, visible: s.visible !== false });
  });
  pageLines.forEach((l) => { if (!state.some((s) => s.id === l.id)) state.push({ id: l.id, name: l.name, visible: true }); });
  lineState = state;
  renderLines();

  sel.innerHTML = '';
  state.forEach((l) => sel.appendChild(new Option(l.name, l.id)));
}

function renderLines() {
  const ul = el('lines');
  ul.innerHTML = '';
  lineState.forEach((l, i) => {
    const li = document.createElement('li');
    if (!l.visible) li.className = 'off';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = l.visible;
    cb.addEventListener('change', () => { l.visible = cb.checked; renderLines(); });
    const name = document.createElement('span');
    name.textContent = l.name;
    const up = document.createElement('button');
    up.textContent = '↑';
    up.disabled = i === 0;
    up.addEventListener('click', () => { lineState.splice(i - 1, 0, lineState.splice(i, 1)[0]); renderLines(); });
    const down = document.createElement('button');
    down.textContent = '↓';
    down.disabled = i === lineState.length - 1;
    down.addEventListener('click', () => { lineState.splice(i + 1, 0, lineState.splice(i, 1)[0]); renderLines(); });
    li.append(cb, name, up, down);
    ul.appendChild(li);
  });
}

el('dialBtn').addEventListener('click', async () => {
  const number = el('dialNumber').value.trim();
  const lineId = el('dialLine').value;
  if (number.replace(/\D/g, '').length < 8) { dialStatus('Digite um número válido', true); return; }
  if (!bitrixTabId) { dialStatus('Abra o Bitrix24 numa aba', true); return; }
  dialStatus('Ligando…');
  const resp = await ask(bitrixTabId, { type: 'wabx:call:dial', number, lineId });
  if (resp && resp.ok) {
    dialStatus('Chamada iniciada na aba do Bitrix24 ✓');
    chrome.tabs.update(bitrixTabId, { active: true }).catch(() => {});
  } else {
    dialStatus('Não consegui ligar: ' + ((resp && resp.error) || 'a aba do Bitrix24 não respondeu'), true);
  }
});
el('dialNumber').addEventListener('keydown', (e) => { if (e.key === 'Enter') el('dialBtn').click(); });

el('save').addEventListener('click', async () => {
  const cfg = {};
  BOOLS.forEach((k) => { cfg[k] = el(k).checked; });
  TEXTS.forEach((k) => { cfg[k] = el(k).value.trim(); });
  if (lineState) cfg.callLines = lineState.map((l) => ({ id: l.id, visible: l.visible }));

  if (cfg.webhookUrl) {
    let origin;
    try { origin = new URL(cfg.webhookUrl).origin; } catch (e) { status('URL do webhook inválida', true); return; }
    // precisa acontecer dentro do clique: libera o service worker para chamar esse host sem CORS
    const granted = await chrome.permissions.request({ origins: [origin + '/*'] }).catch(() => false);
    if (!granted) { status('Permissão para o host do webhook negada', true); return; }
  }
  chrome.storage.sync.set(cfg, () => status('Salvo ✓'));
});

// ---------- procurar atualização (Releases do GitHub) ----------
const REPO = 'aksi-tecnologia/bitrix-whatsapp';
const RELEASES_URL = 'https://github.com/' + REPO + '/releases';

function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/i, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function updStatus(msg, err) {
  const s = el('updStatus');
  s.textContent = msg;
  s.className = err ? 'err' : '';
}

function link(href, text) {
  const a = document.createElement('a');
  a.href = href; a.textContent = text; a.target = '_blank'; a.rel = 'noopener';
  return a;
}

const current = chrome.runtime.getManifest().version;
el('curVersion').textContent = current;

el('updBtn').addEventListener('click', async () => {
  const btn = el('updBtn');
  btn.disabled = true;
  el('updBox').hidden = true;
  updStatus('Procurando…');
  try {
    const resp = await fetch('https://api.github.com/repos/' + REPO + '/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store'
    });
    if (resp.status === 404) {
      updStatus('Nenhuma versão publicada encontrada. Se o repositório for privado, confira direto no GitHub.', true);
      el('updLinks').replaceChildren(link(RELEASES_URL, 'Abrir Releases no GitHub'));
      el('updTitle').textContent = '';
      el('updNotes').textContent = '';
      el('updBox').hidden = false;
      return;
    }
    if (resp.status === 403 || resp.status === 429) throw new Error('o GitHub limitou as consultas, tente de novo em alguns minutos');
    if (!resp.ok) throw new Error('GitHub respondeu HTTP ' + resp.status);
    const rel = await resp.json();
    const latest = String(rel.tag_name || rel.name || '').replace(/^v/i, '');
    if (!latest) throw new Error('Release sem número de versão');

    if (cmpVersion(latest, current) <= 0) {
      updStatus('Você já está na versão mais recente (' + current + ').');
      return;
    }
    updStatus('');
    const zip = (rel.assets || []).find((a) => /\.zip$/i.test(a.name));
    el('updTitle').textContent = 'Nova versão disponível: ' + latest;
    el('updNotes').textContent = String(rel.body || '').split(/\n---\n/)[0].trim() || 'Sem notas para esta versão.';
    const links = [];
    if (zip) links.push(link(zip.browser_download_url, 'Baixar ' + zip.name));
    links.push(link(rel.html_url || RELEASES_URL, 'Ver no GitHub'));
    el('updLinks').replaceChildren(...links);
    el('updBox').hidden = false;
  } catch (e) {
    updStatus('Não foi possível procurar: ' + (e.message || e), true);
  } finally {
    btn.disabled = false;
  }
});
