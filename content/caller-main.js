/* Bitrix24 WhatsApp Skin — botão "Ligar por…".
   Roda no contexto da página (world MAIN) para acessar o BX do Bitrix.
   Inicia a chamada com PhoneManager.startCall(numero, { LINE_ID, ENTITY_TYPE, ENTITY_ID }),
   o mesmo caminho do teclado de Telefonia quando você escolhe a linha. */
(function () {
  'use strict';
  if (window.__wabxCaller) return;
  window.__wabxCaller = true;

  const SRC_MAIN = 'wabx-caller-main';
  const SRC_BRIDGE = 'wabx-caller-bridge';
  const TYPE_BY_ID = { 1: 'LEAD', 2: 'DEAL', 3: 'CONTACT', 4: 'COMPANY' };
  const PHONE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2Z"/></svg>';

  let cfgLines = null;      // [{id, visible}] salvo nas opções; null = todas as linhas
  let linesPromise = null;  // linhas do portal (mesma fonte do teclado)
  const ctxCache = new Map();
  let menuEl = null;

  const topWin = (() => { try { return window.top && window.top.BX ? window.top : window; } catch (e) { return window; } })();
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const h = (tag, attrs, kids) => {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k === 'html') el.innerHTML = attrs[k];
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach((c) => c && el.appendChild(c));
    return el;
  };

  // ---------- Bitrix ----------
  function appendParams(form, obj, prefix) {
    for (const k in obj) {
      const v = obj[k];
      const key = prefix ? prefix + '[' + k + ']' : k;
      if (v && typeof v === 'object') appendParams(form, v, key);
      else if (v !== undefined && v !== null) form.append(key, String(v));
    }
  }

  // REST com a sessão do próprio usuário (o mesmo que BX.rest.callMethod faz)
  async function rest(method, params) {
    const BX = window.BX;
    const form = new URLSearchParams();
    appendParams(form, params || {});
    form.set('sessid', BX && BX.bitrix_sessid ? BX.bitrix_sessid() : '');
    const r = await fetch('/rest/' + method + '.json', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });
    const j = await r.json().catch(() => null);
    if (!j || j.error) throw new Error((j && (j.error_description || j.error)) || ('HTTP ' + r.status));
    return j.result;
  }

  function loadLines() {
    if (!linesPromise) {
      const BX = window.BX;
      if (!BX || !BX.ajax || !BX.ajax.runAction) return Promise.reject(new Error('BX não carregado'));
      linesPromise = BX.ajax.runAction('voximplant.callView.getLines')
        .then((r) => r.data || {})
        .catch((e) => { linesPromise = null; throw new Error(errText(e)); });
    }
    return linesPromise;
  }

  async function orderedLines() {
    const all = await loadLines();
    const ids = Object.keys(all);
    let list;
    if (Array.isArray(cfgLines) && cfgLines.length) {
      const known = new Set(cfgLines.map((l) => l.id));
      list = cfgLines.filter((l) => l.visible !== false && all[l.id]).map((l) => l.id)
        .concat(ids.filter((id) => !known.has(id)));
    } else {
      list = ids;
    }
    return list.map((id) => ({ id, name: all[id].SHORT_NAME || all[id].FULL_NAME || id, type: all[id].TYPE }));
  }

  function errText(e) {
    if (!e) return 'erro desconhecido';
    if (e.errors && e.errors[0]) return e.errors[0].message || e.errors[0].code;
    return e.message || String(e);
  }

  async function startCall(number, lineId, owner) {
    const params = {};
    if (lineId) params.LINE_ID = lineId;
    if (owner) { params.ENTITY_TYPE = 'CRM_' + owner.type; params.ENTITY_ID = owner.id; }
    const W = topWin;
    const BX = W.BX;
    const getPM = () => BX && BX.Messenger && BX.Messenger.v2 && BX.Messenger.v2.Lib && BX.Messenger.v2.Lib.PhoneManager;
    let PM = getPM();
    if (!PM && BX && BX.Runtime && BX.Runtime.loadExtension) {
      try { await BX.Runtime.loadExtension('im.v2.lib.phone'); } catch (e) { /* segue para o plano B */ }
      PM = getPM();
    }
    if (PM && PM.getInstance) { await PM.getInstance().startCall(number, params); return; }
    if (W.BXIM && typeof W.BXIM.phoneTo === 'function') { W.BXIM.phoneTo(number, params); return; }
    throw new Error('A telefonia do Bitrix não está disponível nesta página');
  }

  // ---------- telefones ----------
  function phoneKey(v) {
    let d = String(v || '').replace(/\D/g, '');
    if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    return d;
  }
  function dialable(v) { return String(v || '').trim().replace(/[^\d+]/g, ''); }

  async function phonesOf(type, id) {
    const method = { CONTACT: 'crm.contact.get', LEAD: 'crm.lead.get', COMPANY: 'crm.company.get' }[type];
    if (!method || !id) return [];
    const item = await rest(method, { id });
    return (item && item.PHONE || []).map((p) => ({ value: p.VALUE, owner: { type, id: +id } }));
  }

  async function phonesForEntity(type, id) {
    if (type !== 'DEAL') return phonesOf(type, id);
    const deal = await rest('crm.deal.get', { id });
    let list = [];
    if (+deal.CONTACT_ID) list = await phonesOf('CONTACT', +deal.CONTACT_ID);
    if (!list.length && +deal.COMPANY_ID) list = await phonesOf('COMPANY', +deal.COMPANY_ID);
    return list;
  }

  function dedupe(list) {
    const seen = new Set();
    return list.filter((p) => {
      const k = phoneKey(p.value);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // Bate-papo de Canal Aberto: entity_data_2 = "LEAD|1209|COMPANY|0|CONTACT|0|DEAL|0"
  async function phonesForChat(dialogId) {
    const d = await rest('imopenlines.dialog.get', { DIALOG_ID: dialogId });
    if (!d || String(d.entity_type).toUpperCase() !== 'LINES') return null; // não é Canal Aberto
    const parts = String(d.entity_data_2 || '').split('|');
    const ids = {};
    for (let i = 0; i + 1 < parts.length; i += 2) ids[parts[i]] = +parts[i + 1] || 0;
    for (const t of ['CONTACT', 'LEAD', 'COMPANY']) {
      if (ids[t]) { const l = await phonesOf(t, ids[t]); if (l.length) return l; }
    }
    if (ids.DEAL) return phonesForEntity('DEAL', ids.DEAL);
    return [];
  }

  // ---------- contexto da tela ----------
  function crmContext() {
    let m = location.pathname.match(/\/crm\/(contact|lead|company|deal)\/details\/(\d+)\//i);
    if (m && +m[2] > 0) return { type: m[1].toUpperCase(), id: +m[2] };
    m = location.pathname.match(/\/crm\/type\/(\d+)\/details\/(\d+)\//i);
    if (m && TYPE_BY_ID[m[1]] && +m[2] > 0) return { type: TYPE_BY_ID[m[1]], id: +m[2] };
    return null;
  }

  function chatDialogId() {
    const sel = $('.bx-imol-list-recent__item.--selected[data-testid^="imol-recent-item-"]');
    if (sel) return sel.getAttribute('data-testid').replace('imol-recent-item-', '');
    const q = new URLSearchParams(location.search);
    const v = q.get('IM_DIALOG') || q.get('IM_LINES');
    if (v && /^chat\d+$/.test(v)) return v;
    const any = $('.bx-im-content-chat__container [data-im-chat-id]');
    if (any) return 'chat' + any.getAttribute('data-im-chat-id');
    return null;
  }

  function cached(key, fn) {
    if (!ctxCache.has(key)) ctxCache.set(key, fn().catch((e) => { ctxCache.delete(key); throw e; }));
    return ctxCache.get(key);
  }

  // ---------- botão ----------
  function makeButton(getPhones) {
    const btn = h('button', { type: 'button', class: 'wabx-call-btn', title: 'Ligar escolhendo a linha' });
    btn.innerHTML = PHONE_SVG + '<span>Ligar por…</span>';
    btn._getPhones = getPhones;
    btn.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); toggleMenu(btn); });
    getPhones().then((list) => {
      if (list && !list.length) { btn.classList.add('wabx-call-nophone'); btn.title = 'Sem telefone no cadastro: dá para digitar um número'; }
    }).catch(() => {});
    return btn;
  }

  function placeCrmButton(ctx) {
    const key = ctx.type + ':' + ctx.id;
    const host = $('.ui-toolbar-right-buttons') || $('#uiToolbarContainer') || $('.pagetitle-container.pagetitle-align-right-container');
    const existing = $('.wabx-call-btn[data-wabx-key]');
    if (existing && existing.getAttribute('data-wabx-key') === key && document.contains(existing)) return;
    if (existing) existing.remove();
    const btn = makeButton(() => cached(key, async () => dedupe(await phonesForEntity(ctx.type, ctx.id))));
    btn.setAttribute('data-wabx-key', key);
    if (host) host.insertBefore(btn, host.firstChild);
    else { btn.classList.add('wabx-call-float'); document.body.appendChild(btn); }
  }

  function visibleChatHeader() {
    const list = $$('.bx-im-chat-header__right').filter((el) => el.offsetParent !== null);
    return list[list.length - 1] || null;
  }

  function placeChatButton(dialogId) {
    const host = visibleChatHeader();
    const old = $('.wabx-call-btn[data-wabx-chat]');
    if (old && (old.getAttribute('data-wabx-chat') !== dialogId || !host || !host.contains(old))) old.remove();
    if (!host || (old && document.contains(old) && old.getAttribute('data-wabx-chat') === dialogId)) return;
    const key = 'chat:' + dialogId;
    const getPhones = () => cached(key, async () => { const l = await phonesForChat(dialogId); return l === null ? null : dedupe(l); });
    getPhones().then((list) => {
      if (list === null) return; // chat interno, não é Canal Aberto
      if ($('.wabx-call-btn[data-wabx-chat="' + dialogId + '"]')) return;
      const btn = makeButton(getPhones);
      btn.setAttribute('data-wabx-chat', dialogId);
      const h2 = visibleChatHeader();
      if (h2) h2.insertBefore(btn, h2.firstChild);
    }).catch(() => {});
  }

  // ---------- menu ----------
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }

  async function toggleMenu(btn) {
    if (menuEl && menuEl._btn === btn) { closeMenu(); return; }
    closeMenu();
    const box = h('div', { class: 'wabx-call-menu' });
    box._btn = btn;
    menuEl = box;
    box.appendChild(h('div', { class: 'wabx-call-loading', text: 'Carregando…' }));
    document.body.appendChild(box);
    position(box, btn);

    let phones = [];
    let lines = [];
    try {
      [phones, lines] = await Promise.all([
        btn._getPhones ? btn._getPhones().catch(() => []) : Promise.resolve([]),
        orderedLines()
      ]);
    } catch (e) {
      box.innerHTML = '';
      box.appendChild(h('div', { class: 'wabx-call-err', text: 'Não consegui carregar as linhas: ' + errText(e) }));
      return;
    }
    if (menuEl !== box) return;
    phones = phones || [];
    box.innerHTML = '';

    box.appendChild(h('div', { class: 'wabx-call-title', text: 'Número' }));
    const name = 'wabx-num-' + Date.now();
    phones.forEach((p, i) => {
      const r = h('input', { type: 'radio', name, value: String(i) });
      if (i === 0) r.checked = true;
      box.appendChild(h('label', { class: 'wabx-call-opt' }, [r, h('span', { text: p.value })]));
    });
    if (!phones.length) box.appendChild(h('div', { class: 'wabx-call-hint', text: 'Sem telefone no cadastro.' }));
    const otherRadio = h('input', { type: 'radio', name, value: 'other' });
    if (!phones.length) otherRadio.checked = true;
    const otherInput = h('input', { type: 'tel', class: 'wabx-call-input', placeholder: 'Outro número' });
    otherInput.addEventListener('focus', () => { otherRadio.checked = true; });
    box.appendChild(h('label', { class: 'wabx-call-opt' }, [otherRadio, otherInput]));

    box.appendChild(h('div', { class: 'wabx-call-title', text: 'Ligar pela linha' }));
    if (!lines.length) box.appendChild(h('div', { class: 'wabx-call-hint', text: 'Nenhuma linha visível. Ajuste nas opções da extensão.' }));
    const status = h('div', { class: 'wabx-call-err' });
    lines.forEach((l) => {
      box.appendChild(h('button', {
        type: 'button', class: 'wabx-call-line', text: l.name,
        onclick: async () => {
          const chosen = $('input[name="' + name + '"]:checked', box);
          let number = '';
          let owner = null;
          if (chosen && chosen.value !== 'other') { number = phones[+chosen.value].value; owner = phones[+chosen.value].owner; }
          else number = otherInput.value;
          number = dialable(number);
          if (number.replace(/\D/g, '').length < 8) { status.textContent = 'Digite um número válido.'; otherInput.focus(); return; }
          try { closeMenu(); await startCall(number, l.id, owner); }
          catch (e) { alertToast('Não consegui ligar: ' + errText(e)); }
        }
      }));
    });
    box.appendChild(status);
    otherInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const first = $('.wabx-call-line', box); if (first) first.click(); }
    });
    position(box, btn);
  }

  function position(box, btn) {
    const r = btn.getBoundingClientRect();
    const w = box.offsetWidth || 260;
    let left = Math.min(r.left, window.innerWidth - w - 8);
    box.style.left = Math.max(8, left) + 'px';
    box.style.top = (r.bottom + 6) + 'px';
  }

  function alertToast(msg) {
    const t = h('div', { class: 'wabx-call-toast', text: msg });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 6000);
  }

  document.addEventListener('mousedown', (e) => {
    if (menuEl && !menuEl.contains(e.target) && !(menuEl._btn && menuEl._btn.contains(e.target))) closeMenu();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  // ---------- varredura ----------
  let timer = 0;
  function scan() {
    timer = 0;
    if (!document.body || !window.BX) return;
    const ctx = crmContext();
    if (ctx) { placeCrmButton(ctx); return; }
    const dlg = chatDialogId();
    if (dlg) placeChatButton(dlg);
  }
  const schedule = () => { if (!timer) timer = setTimeout(scan, 400); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();

  // ---------- ponte com a extensão ----------
  const reply = (reqId, payload) => window.postMessage(Object.assign({ source: SRC_MAIN, type: 'reply', reqId }, payload), '*');
  window.addEventListener('message', async (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.source !== SRC_BRIDGE) return;
    if (d.type === 'config') { cfgLines = Array.isArray(d.lines) ? d.lines : null; return; }
    if (d.type === 'wabx:call:lines') {
      try {
        const all = await loadLines();
        reply(d.reqId, { ok: true, lines: Object.keys(all).map((id) => ({ id, name: all[id].SHORT_NAME || all[id].FULL_NAME || id, type: all[id].TYPE })), visible: (await orderedLines()).map((l) => l.id) });
      } catch (err) { reply(d.reqId, { ok: false, error: errText(err) }); }
      return;
    }
    if (d.type === 'wabx:call:dial') {
      try {
        const n = dialable(d.number);
        if (n.replace(/\D/g, '').length < 8) throw new Error('número inválido');
        await startCall(n, d.lineId, null);
        reply(d.reqId, { ok: true });
      } catch (err) { reply(d.reqId, { ok: false, error: errText(err) }); }
    }
  });
  window.postMessage({ source: SRC_MAIN, type: 'getConfig' }, '*');
})();
