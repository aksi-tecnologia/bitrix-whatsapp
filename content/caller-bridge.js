/* Ponte entre a extensão (opções/ícone) e o caller-main.js, que roda no contexto da página. */
(function () {
  'use strict';
  const SRC_MAIN = 'wabx-caller-main';
  const SRC_BRIDGE = 'wabx-caller-bridge';
  const pending = new Map();

  function alive() { try { return !!chrome.runtime.id; } catch (e) { return false; } }

  function sendConfig() {
    if (!alive()) return;
    chrome.storage.sync.get({ callLines: null }, (cfg) => {
      window.postMessage({ source: SRC_BRIDGE, type: 'config', lines: cfg.callLines }, '*');
    });
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.source !== SRC_MAIN) return;
    if (d.type === 'getConfig') { sendConfig(); return; }
    if (d.type === 'reply' && pending.has(d.reqId)) {
      const respond = pending.get(d.reqId);
      pending.delete(d.reqId);
      respond(d);
    }
  });

  if (alive()) {
    chrome.storage.onChanged.addListener((ch, area) => { if (area === 'sync' && ch.callLines) sendConfig(); });
    sendConfig();

    // só a janela principal responde ao ícone da extensão
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (window.top !== window) return false;
      if (!msg || (msg.type !== 'wabx:call:lines' && msg.type !== 'wabx:call:dial')) return false;
      const reqId = Math.random().toString(36).slice(2);
      pending.set(reqId, sendResponse);
      window.postMessage({ source: SRC_BRIDGE, type: msg.type, reqId, number: msg.number, lineId: msg.lineId }, '*');
      setTimeout(() => {
        if (pending.has(reqId)) { pending.delete(reqId); sendResponse({ ok: false, error: 'A página do Bitrix não respondeu' }); }
      }, 10000);
      return true;
    });
  }
})();
