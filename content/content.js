/* Bitrix24 WhatsApp Skin — content script.
   Só age quando existe a lista de Canal Aberto (TRIGGER) na página. */
(function () {
  'use strict';
  const TRIGGER = '.bx-imol-list-container-recent__container.bx-imol-messenger__scope';
  const AUDIO_EXT = /\.(oga|ogg|opus|mp3|m4a|aac|wav|weba|webm|amr)$/i;
  // aceita "…do áudio #123:" (extensão/AudioBxConversas) e "…do Audio (messageId: 123):" (fluxo da Luiza)
  const MARK_RE = /Transcri[çc][ãa]o do [áa]udio\s*(?:#|\(\s*messageId:\s*)(\d+)\s*\)?:?\s*([\s\S]*)/i;
  const DEFAULTS = {
    theme: true,
    recorder: true,
    player: true,
    webhookUrl: '',
    postReply: true,
    autoTranscribe: false
  };

  let cfg = Object.assign({}, DEFAULTS);
  let active = false;
  let scanTimer = 0;
  const transcripts = new Map(); // msgId -> texto
  const inFlight = new Set();
  let sessid = null;

  // ---------- utilidades ----------
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const h = (tag, attrs, children) => {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k === 'html') el.innerHTML = attrs[k];
      else el.setAttribute(k, attrs[k]);
    }
    if (children) for (const c of children) if (c) el.appendChild(c);
    return el;
  };
  const fmt = (sec) => {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };
  const ICON = {
    mic: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M9 3h6l1 1h4v2H4V4h4l1-1Zm-3 5h12l-1 13H7L6 8Zm4 2v9h1v-9h-1Zm3 0v9h1v-9h-1Z"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3 10l12 2-12 2 .4 6.4Z"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M8 5v14l11-7L8 5Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M6 5h4v14H6V5Zm8 0h4v14h-4V5Z"/></svg>',
    text: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M4 5h16v2H4V5Zm0 4h16v2H4V9Zm0 4h10v2H4v-2Zm0 4h7v2H4v-2Z"/></svg>',
    down: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M11 4h2v9l3.5-3.5 1.4 1.4L12 16.8l-5.9-5.9 1.4-1.4L11 13V4ZM5 18h14v2H5v-2Z"/></svg>'
  };

  let toastTimer = 0;
  function toast(msg, isError) {
    let t = $('#wabx-toast');
    if (!t) { t = h('div', { id: 'wabx-toast' }); document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'wabx-show' + (isError ? ' wabx-err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = ''; }, isError ? 6000 : 3200);
  }

  function alive() { try { return !!chrome.runtime.id; } catch (e) { return false; } }

  // ---------- Bitrix ----------
  function getSessid(force) {
    if (sessid && !force) return sessid;
    for (const s of document.scripts) {
      const t = s.textContent;
      if (!t || t.length > 200000 || t.indexOf('bitrix_sessid') === -1) continue;
      const m = t.match(/["']bitrix_sessid["']\s*:\s*["']([a-f0-9]{32})["']/);
      if (m) { sessid = m[1]; return sessid; }
    }
    return sessid;
  }

  function getDialogId(msgEl) {
    const f = msgEl && $('[data-im-chat-id]', msgEl);
    if (f) return 'chat' + f.getAttribute('data-im-chat-id');
    const sel = $('.bx-imol-list-recent__item.--selected[data-testid^="imol-recent-item-"]');
    if (sel) return sel.getAttribute('data-testid').replace('imol-recent-item-', '');
    const any = $('.bx-im-message-list__container [data-im-chat-id]');
    if (any) return 'chat' + any.getAttribute('data-im-chat-id');
    const q = new URLSearchParams(location.search);
    return q.get('IM_DIALOG') || q.get('IM_LINES') || null;
  }

  async function bxSendHiddenReply(dialogId, replyId, message) {
    const call = async (token) => {
      const body = new URLSearchParams();
      body.set('dialogId', dialogId);
      body.set('fields[replyId]', String(replyId));
      body.set('fields[message]', message);
      body.set('fields[system]', 'Y');
      const r = await fetch(location.origin + '/bitrix/services/main/ajax.php?action=im.v2.Chat.Message.send', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'bx-ajax': 'true',
          'content-type': 'application/x-www-form-urlencoded',
          'x-bitrix-csrf-token': token,
          'x-bitrix-site-id': 's1'
        },
        body: body.toString()
      });
      return r.json();
    };
    let token = getSessid();
    if (!token) throw new Error('bitrix_sessid não encontrado na página');
    let res = await call(token);
    const err = res && res.errors && res.errors[0];
    if (err && err.code === 'invalid_csrf') {
      const fresh = (err.customData && err.customData.csrf) || getSessid(true);
      if (fresh) { sessid = fresh; res = await call(fresh); }
    }
    if (!res || res.status !== 'success') {
      const e2 = res && res.errors && res.errors[0];
      throw new Error('Bitrix recusou a mensagem: ' + (e2 ? e2.message || e2.code : 'erro desconhecido'));
    }
    return res.data;
  }

  // ---------- soltar arquivo no chat ----------
  async function dropIntoChat(file) {
    const chat = $('.bx-im-content-chat__container');
    if (!chat) throw new Error('Nenhuma conversa aberta');
    const mkdt = () => { const d = new DataTransfer(); d.items.add(file); return d; };
    const fire = (el, type) => el.dispatchEvent(new DragEvent(type, {
      bubbles: true, cancelable: true, composed: true, dataTransfer: mkdt()
    }));
    const inner = $('.bx-im-dialog-chat__scroll-container', chat) || chat;

    fire(inner, 'dragenter');
    fire(inner, 'dragover');
    await new Promise((r) => setTimeout(r, 150));
    const overlay = $('[class*="drop-area"]', chat) || $('[class*="drop-area"]');
    const target = overlay || inner;
    fire(target, 'dragenter');
    fire(target, 'dragover');
    // dispatchEvent devolve false quando algum listener chamou preventDefault => o Bitrix tratou o drop
    if (!fire(target, 'drop')) return 'drop';
    fire(target, 'dragleave');
    fire(inner, 'dragleave');

    const ta = $('.bx-im-textarea__element', chat);
    if (ta) {
      ta.focus();
      const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: mkdt() });
      if (!ta.dispatchEvent(ev)) return 'paste';
    }
    return null;
  }

  function downloadFile(file) {
    const url = URL.createObjectURL(file);
    const a = h('a', { href: url, download: file.name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ---------- gravador ----------
  let rec = null;
  let recBar = null;
  let recRaf = 0;

  function mountRecorderButton() {
    if (!cfg.recorder) { $$('.wabx-mic').forEach((n) => n.remove()); return; }
    const bottom = $('.bx-im-textarea__bottom');
    if (!bottom || $('.wabx-mic', bottom)) return;
    const btn = h('button', { type: 'button', class: 'wabx-mic', title: 'Gravar áudio (WhatsApp Skin)', html: ICON.mic });
    btn.addEventListener('click', startRecording);
    const send = $('.bx-im-textarea-scheduled-send-button', bottom);
    if (send) bottom.insertBefore(btn, send); else bottom.appendChild(btn);
  }

  async function startRecording() {
    if (rec) return;
    const panel = $('.bx-im-send-panel__container');
    if (!panel) return;
    const r = new window.WABX_VoiceRecorder();
    rec = r;
    try {
      await r.start();
    } catch (e) {
      rec = null;
      toast(e && e.name === 'NotAllowedError' ? 'Permita o uso do microfone para este site.' : 'Não foi possível acessar o microfone: ' + (e.message || e), true);
      return;
    }
    const cancelBtn = h('button', { type: 'button', class: 'wabx-rec-btn wabx-rec-cancel', title: 'Descartar (Esc)', html: ICON.trash });
    const dot = h('span', { class: 'wabx-rec-dot' });
    const time = h('span', { class: 'wabx-rec-time', text: '0:00' });
    const canvas = h('canvas', { class: 'wabx-rec-wave', height: '32' });
    const sendBtn = h('button', { type: 'button', class: 'wabx-rec-btn wabx-rec-send', title: 'Parar e anexar ao chat', html: ICON.send });
    recBar = h('div', { class: 'wabx-rec-bar' }, [cancelBtn, dot, time, canvas, sendBtn]);
    panel.appendChild(recBar);
    cancelBtn.addEventListener('click', cancelRecording);
    sendBtn.addEventListener('click', finishRecording);
    document.addEventListener('keydown', onRecKey, true);

    const bars = [];
    const ctx = canvas.getContext('2d');
    const buf = r.analyser ? new Uint8Array(r.analyser.fftSize) : null;
    let last = 0;
    const draw = (ts) => {
      if (rec !== r) return;
      recRaf = requestAnimationFrame(draw);
      time.textContent = fmt(r.elapsedMs / 1000);
      if (!buf || ts - last < 60) return;
      last = ts;
      r.analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
      bars.push(Math.min(1, peak / 90));
      const w = canvas.clientWidth || 200;
      if (canvas.width !== w) canvas.width = w;
      const max = Math.floor(w / 4);
      while (bars.length > max) bars.shift();
      ctx.clearRect(0, 0, w, 32);
      ctx.fillStyle = '#8696a0';
      bars.forEach((v, i) => {
        const bh = Math.max(2, v * 28);
        ctx.fillRect(w - (bars.length - i) * 4, (32 - bh) / 2, 2.5, bh);
      });
    };
    recRaf = requestAnimationFrame(draw);
  }

  function onRecKey(e) {
    if (e.key === 'Escape' && rec) { e.stopPropagation(); cancelRecording(); }
  }

  function closeRecBar() {
    cancelAnimationFrame(recRaf);
    document.removeEventListener('keydown', onRecKey, true);
    if (recBar) recBar.remove();
    recBar = null;
  }

  function cancelRecording() {
    if (!rec) return;
    rec.cancel();
    rec = null;
    closeRecBar();
  }

  async function finishRecording() {
    if (!rec) return;
    const r = rec;
    rec = null;
    closeRecBar();
    let out;
    try {
      out = await r.stop();
    } catch (e) {
      toast('Falha ao finalizar a gravação: ' + (e.message || e), true);
      return;
    }
    if (out.durationMs < 600) { toast('Gravação muito curta, descartada.'); return; }
    try {
      const how = await dropIntoChat(out.file);
      if (!how) {
        downloadFile(out.file);
        toast('Não consegui soltar o áudio no chat — o arquivo foi baixado, arraste-o manualmente.', true);
      }
    } catch (e) {
      toast(e.message || String(e), true);
    }
  }

  // ---------- player + transcrição ----------
  function isAudioItem(viewer) {
    if (viewer.getAttribute('data-viewer-type') === 'audio') return true;
    return AUDIO_EXT.test(viewer.getAttribute('data-title') || '');
  }

  function publicUrlOf(msgEl) {
    const a = $$('.bx-im-message-text-content__container a[href]', msgEl).find((x) => AUDIO_EXT.test(x.href.split('?')[0]));
    return a ? a.href : '';
  }

  function enhanceAudio(viewer) {
    const item = viewer.closest('.bx-im-base-file-item__container');
    const msg = viewer.closest('.bx-im-message-base__wrap');
    if (!item || !msg || !isAudioItem(viewer)) return;
    const next = item.nextElementSibling;
    if (next && next.classList.contains('wabx-player')) return;
    const src = viewer.getAttribute('data-src');
    if (!src) return;
    const msgId = msg.getAttribute('data-id');

    const audio = new Audio();
    audio.preload = 'none';
    audio.src = src;
    const playBtn = h('button', { type: 'button', class: 'wabx-play', title: 'Reproduzir', html: ICON.play });
    const seek = h('input', { type: 'range', class: 'wabx-seek', min: '0', max: '1000', value: '0' });
    const time = h('span', { class: 'wabx-time', text: '0:00' });
    const speed = h('button', { type: 'button', class: 'wabx-speed', title: 'Velocidade', text: '1×' });
    const trBtn = h('button', { type: 'button', class: 'wabx-tr-btn', title: 'Transcrever áudio', html: ICON.text });
    const dl = h('a', { class: 'wabx-dl', href: src, title: 'Baixar', html: ICON.down });
    const row = h('div', { class: 'wabx-player-row' }, [playBtn, h('div', { class: 'wabx-track' }, [seek, time]), speed, trBtn, dl]);
    const trBox = h('div', { class: 'wabx-transcript' });
    trBox.hidden = true;
    const player = h('div', { class: 'wabx-player', 'data-wabx-msg': msgId || '' }, [row, trBox]);
    item.classList.add('wabx-audio-replaced');
    item.insertAdjacentElement('afterend', player);

    const dur = () => (isFinite(audio.duration) ? audio.duration : 0);
    playBtn.addEventListener('click', () => {
      if (audio.paused) {
        $$('.wabx-player').forEach((p) => { if (p !== player && p._wabxAudio) p._wabxAudio.pause(); });
        audio.play().catch((e) => toast('Não foi possível reproduzir: ' + e.message, true));
      } else audio.pause();
    });
    player._wabxAudio = audio;
    audio.addEventListener('play', () => { playBtn.innerHTML = ICON.pause; });
    audio.addEventListener('pause', () => { playBtn.innerHTML = ICON.play; });
    audio.addEventListener('ended', () => { seek.value = '0'; time.textContent = fmt(dur()); });
    audio.addEventListener('loadedmetadata', () => { time.textContent = fmt(dur()); });
    audio.addEventListener('timeupdate', () => {
      const d = dur();
      if (d) seek.value = String(Math.round((audio.currentTime / d) * 1000));
      seek.style.setProperty('--wabx-p', (d ? (audio.currentTime / d) * 100 : 0) + '%');
      time.textContent = fmt(audio.currentTime);
    });
    seek.addEventListener('input', () => {
      const d = dur();
      if (d) audio.currentTime = (Number(seek.value) / 1000) * d;
    });
    const rates = [1, 1.5, 2];
    speed.addEventListener('click', () => {
      const i = (rates.indexOf(audio.playbackRate) + 1) % rates.length;
      audio.playbackRate = rates[i];
      speed.textContent = rates[i] + '×';
    });
    trBtn.addEventListener('click', () => transcribe(msg, viewer, player, false));

    if (msgId && transcripts.has(msgId)) showTranscript(player, transcripts.get(msgId));
    else if (msgId) loadCached(msgId, player);
  }

  function showTranscript(player, text) {
    const box = $('.wabx-transcript', player);
    if (!box) return;
    box.textContent = text;
    box.hidden = false;
    player.classList.add('wabx-has-tr');
    player.classList.remove('wabx-busy');
  }

  const storeKey = (id) => `tr:${location.host}:${id}`;

  function loadCached(msgId, player) {
    if (!alive()) return;
    chrome.storage.local.get(storeKey(msgId), (o) => {
      const t = o && o[storeKey(msgId)];
      if (t) { transcripts.set(msgId, t); showTranscript(player, t); }
    });
  }

  function remember(msgId, text) {
    transcripts.set(msgId, text);
    if (alive()) chrome.storage.local.set({ [storeKey(msgId)]: text });
    const p = $(`.wabx-player[data-wabx-msg="${msgId}"]`);
    if (p) showTranscript(p, text);
  }

  // transcrições já postadas (por qualquer atendente) ficam marcadas com "#<id da mensagem>"
  function harvestTranscripts(root) {
    $$('.bx-imol-message-hidden-content__text:not([data-wabx-seen]), .bx-im-message-text-content__container:not([data-wabx-seen])', root).forEach((el) => {
      el.setAttribute('data-wabx-seen', '1');
      const txt = el.textContent || ''; // textContent não força reflow
      if (txt.indexOf('ranscri') === -1) return;
      const m = txt.match(MARK_RE);
      if (m && m[2].trim() && !transcripts.has(m[1])) remember(m[1], m[2].trim());
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  async function transcribe(msg, viewer, player, silent) {
    const msgId = msg.getAttribute('data-id');
    if (!msgId || inFlight.has(msgId)) return;
    if (transcripts.has(msgId)) { showTranscript(player, transcripts.get(msgId)); return; }
    if (!alive()) { toast('A extensão foi atualizada — recarregue a página.', true); return; }
    if (!cfg.webhookUrl) {
      if (!silent) toast('Configure a URL do webhook de transcrição nas opções da extensão.', true);
      return;
    }
    const dialogId = getDialogId(msg);
    inFlight.add(msgId);
    player.classList.add('wabx-busy');
    try {
      const resp = await fetch(viewer.getAttribute('data-src'), { credentials: 'include' });
      if (!resp.ok) throw new Error('Download do áudio falhou (HTTP ' + resp.status + ')');
      const blob = await resp.blob();
      if (blob.size > 20 * 1024 * 1024) throw new Error('Áudio grande demais para transcrever (>20 MB)');
      const fileName = viewer.getAttribute('data-title') || 'audio.oga';
      const res = await chrome.runtime.sendMessage({
        type: 'wabx:transcribe',
        payload: {
          dialogId: dialogId || '',
          chatId: (dialogId || '').replace(/^chat/, ''),
          messageId: msgId,
          fileId: viewer.getAttribute('data-object-id') || '',
          fileName,
          mimeType: blob.type && blob.type.startsWith('audio/') ? blob.type : 'audio/ogg',
          publicUrl: publicUrlOf(msg),
          bitrixHost: location.host,
          audioBase64: await blobToBase64(blob)
        }
      });
      if (!res || !res.ok) throw new Error((res && res.error) || 'Sem resposta do webhook');
      const text = (res.text || '').trim();
      if (!text) {
        // webhook não devolveu texto: assume que o n8n respondeu no chat por conta própria
        if (!silent) toast('Áudio enviado para transcrição.');
        return;
      }
      remember(msgId, text);
      if (cfg.postReply && dialogId) {
        await bxSendHiddenReply(dialogId, msgId, `🎙 Transcrição do áudio #${msgId}:\n${text}`);
      }
    } catch (e) {
      if (!silent) toast('Transcrição falhou: ' + (e.message || e), true);
    } finally {
      inFlight.delete(msgId);
      player.classList.remove('wabx-busy');
    }
  }

  // O Bitrix agrupa as mensagens por dia; o grupo de hoje tem o título "hoje".
  function isFromToday(el) {
    const group = el.closest('.bx-im-message-list-date-group__container');
    const title = group && $('.bx-im-message-list-date-group-title__text', group);
    if (!title) return false;
    const t = (title.textContent || '').trim().toLowerCase();
    if (t === 'hoje' || t === 'today') return true;
    // reserva: título por extenso, ex.: "quarta-feira, 18 de novembro"
    const now = new Date();
    const month = now.toLocaleDateString('pt-BR', { month: 'long' }).toLowerCase();
    return new RegExp('(^|\\D)' + now.getDate() + ' de ' + month).test(t);
  }

  function autoTranscribeVisible() {
    if (!cfg.autoTranscribe || !cfg.webhookUrl) return;
    const vh = window.innerHeight;
    $$('.bx-im-message-base__wrap.--opponent .wabx-player:not(.wabx-has-tr):not([data-wabx-auto])').forEach((player) => {
      const r = player.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) return;
      player.setAttribute('data-wabx-auto', '1');
      // automático só para áudios recebidos hoje; os mais antigos ficam no botão manual
      if (!isFromToday(player)) return;
      const msg = player.closest('.bx-im-message-base__wrap');
      const viewer = $('.bx-im-base-file-item__viewer-container', msg);
      // dá tempo de o cache/colheita de transcrições existentes preencher antes de gastar uma chamada
      if (msg && viewer) setTimeout(() => transcribe(msg, viewer, player, true), 800);
    });
  }

  // ---------- ciclo ----------
  function scan() {
    scanTimer = 0;
    const on = !!document.querySelector(TRIGGER);
    if (on !== active) {
      active = on;
      if (!on && rec) cancelRecording();
    }
    document.documentElement.classList.toggle('wabx-on', active);
    document.documentElement.classList.toggle('wabx-theme', active && cfg.theme);
    if (!active) return;
    mountRecorderButton();
    const list = $('.bx-im-message-list__container');
    if (!list) return;
    harvestTranscripts(list);
    if (cfg.player) {
      $$('.bx-im-base-file-item__viewer-container', list).forEach(enhanceAudio);
      autoTranscribeVisible();
    }
  }

  function schedule() {
    if (scanTimer) return;
    scanTimer = setTimeout(scan, 250);
  }

  function boot() {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('scroll', () => { if (active && cfg.autoTranscribe) schedule(); }, { capture: true, passive: true });
    schedule();
  }

  chrome.storage.sync.get(DEFAULTS, (stored) => {
    cfg = Object.assign({}, DEFAULTS, stored);
    boot();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const k in changes) if (k in DEFAULTS) cfg[k] = changes[k].newValue;
    if (!cfg.player) {
      $$('.wabx-player').forEach((p) => { if (p._wabxAudio) p._wabxAudio.pause(); p.remove(); });
      $$('.wabx-audio-replaced').forEach((n) => n.classList.remove('wabx-audio-replaced'));
    }
    schedule();
  });
})();
