/* Service worker: fala com o webhook de transcrição (fora das regras de CORS da página). */
const TIMEOUT_MS = 120000;

function b64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

function pickText(data) {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return pickText(data[0]);
  if (typeof data === 'object') {
    for (const k of ['text', 'transcription', 'transcricao', 'transcrição', 'output', 'result']) {
      if (typeof data[k] === 'string') return data[k];
    }
    if (data.json) return pickText(data.json);
    if (data.data) return pickText(data.data);
  }
  return '';
}

async function transcribe(p) {
  const { webhookUrl = '', webhookToken = '' } = await chrome.storage.sync.get(['webhookUrl', 'webhookToken']);
  if (!webhookUrl) throw new Error('URL do webhook não configurada');

  const form = new FormData();
  for (const k of ['dialogId', 'chatId', 'messageId', 'fileId', 'fileName', 'mimeType', 'publicUrl', 'bitrixHost']) {
    form.append(k, p[k] || '');
  }
  form.append('audio', b64ToBlob(p.audioBase64, p.mimeType || 'audio/ogg'), p.fileName || 'audio.oga');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(webhookUrl, {
      method: 'POST',
      body: form,
      headers: webhookToken ? { Authorization: 'Bearer ' + webhookToken } : undefined,
      signal: ctrl.signal
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Webhook demorou mais de 2 minutos' : 'Webhook inacessível: ' + e.message);
  } finally {
    clearTimeout(timer);
  }
  const raw = await resp.text();
  if (!resp.ok) throw new Error('Webhook respondeu HTTP ' + resp.status + (raw ? ': ' + raw.slice(0, 200) : ''));
  let text = raw;
  try { text = pickText(JSON.parse(raw)); } catch (e) { /* resposta em texto puro */ }
  return { ok: true, text: String(text || '').trim() };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'wabx:transcribe') return false;
  transcribe(msg.payload).then(sendResponse, (e) => sendResponse({ ok: false, error: e.message || String(e) }));
  return true;
});
