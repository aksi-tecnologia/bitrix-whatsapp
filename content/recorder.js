/* Gravador de voz. Preferência: WebCodecs (Opus) + muxer Ogg próprio => .ogg igual ao do WhatsApp.
   Fallback: MediaRecorder (ogg se o navegador suportar, senão webm). */
(function (root) {
  'use strict';

  const OGG = root.WABX_OGG;

  function canUseWebCodecs() {
    return typeof root.AudioEncoder === 'function' && typeof root.MediaStreamTrackProcessor === 'function' && !!OGG;
  }

  class VoiceRecorder {
    constructor() {
      this.stream = null;
      this.mode = null;
      this.startedAt = 0;
      this.analyser = null;
      this.audioCtx = null;
      this._packets = [];
      this._head = null;
      this._channels = 1;
      this._rate = 48000;
      this._stopReading = false;
      this._readLoop = null;
      this._chunks = [];
      this._mr = null;
      this._error = null;
    }

    get elapsedMs() { return this.startedAt ? Date.now() - this.startedAt : 0; }

    async start() {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      try {
        this.audioCtx = new AudioContext();
        const src = this.audioCtx.createMediaStreamSource(this.stream);
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 256;
        src.connect(this.analyser);
      } catch (e) { this.analyser = null; }

      let ok = false;
      if (canUseWebCodecs()) {
        try { ok = await this._startWebCodecs(); } catch (e) { ok = false; }
      }
      if (!ok) this._startMediaRecorder();
      this.startedAt = Date.now();
    }

    async _startWebCodecs() {
      const track = this.stream.getAudioTracks()[0];
      const st = track.getSettings ? track.getSettings() : {};
      const config = {
        codec: 'opus',
        sampleRate: st.sampleRate || 48000,
        numberOfChannels: st.channelCount || 1,
        bitrate: 32000
      };
      const sup = await AudioEncoder.isConfigSupported(config);
      if (!sup || !sup.supported) return false;
      this._channels = config.numberOfChannels;
      this._rate = config.sampleRate;

      this._encoder = new AudioEncoder({
        output: (chunk, meta) => {
          if (meta && meta.decoderConfig && meta.decoderConfig.description && !this._head) {
            const d = meta.decoderConfig.description;
            this._head = new Uint8Array(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
          }
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          const durUs = chunk.duration || 20000;
          this._packets.push({ data, samples: Math.round(durUs * 48 / 1000) });
        },
        error: (e) => { this._error = e; }
      });
      this._encoder.configure(config);

      const processor = new MediaStreamTrackProcessor({ track });
      const reader = processor.readable.getReader();
      this._reader = reader;
      let reconfigured = false;
      this._readLoop = (async () => {
        for (;;) {
          const { value, done } = await reader.read();
          if (done || !value) break;
          if (this._stopReading || this._error) { value.close(); break; }
          try {
            if (!reconfigured && (value.sampleRate !== this._rate || value.numberOfChannels !== this._channels)) {
              // o que o microfone entrega de fato não bate com getSettings(): reconfigura antes do 1º quadro
              reconfigured = true;
              this._rate = value.sampleRate;
              this._channels = value.numberOfChannels;
              this._encoder.configure({ codec: 'opus', sampleRate: this._rate, numberOfChannels: this._channels, bitrate: 32000 });
            }
            reconfigured = true;
            this._encoder.encode(value);
          } catch (e) { this._error = e; }
          value.close();
        }
      })();
      this.mode = 'webcodecs';
      return true;
    }

    _startMediaRecorder() {
      const types = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
      this._mr = new MediaRecorder(this.stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
      this._mr.ondataavailable = (e) => { if (e.data && e.data.size) this._chunks.push(e.data); };
      this._mr.start(250);
      this.mode = 'mediarecorder';
    }

    /** Para e devolve um File pronto para ser solto no chat. */
    async stop() {
      const durationMs = this.elapsedMs;
      let blob;
      let ext;
      if (this.mode === 'webcodecs') {
        this._stopReading = true;
        try { await this._reader.cancel(); } catch (e) { /* já encerrado */ }
        try { await this._readLoop; } catch (e) { /* idem */ }
        if (this._encoder.state === 'configured') {
          try { await this._encoder.flush(); } catch (e) { this._error = this._error || e; }
          this._encoder.close();
        }
        this._cleanup();
        if (!this._packets.length) throw this._error || new Error('Nenhum áudio capturado');
        const bytes = OGG.muxOggOpus(this._packets, { channels: this._channels, inputSampleRate: this._rate, head: this._head });
        blob = new Blob([bytes], { type: 'audio/ogg' });
        ext = 'ogg';
      } else {
        const mr = this._mr;
        await new Promise((resolve) => { mr.onstop = resolve; mr.stop(); });
        this._cleanup();
        const type = (mr.mimeType || 'audio/webm').split(';')[0];
        blob = new Blob(this._chunks, { type });
        ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
        if (!blob.size) throw new Error('Nenhum áudio capturado');
      }
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      const name = `audio-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
      return { file: new File([blob], name, { type: blob.type, lastModified: Date.now() }), durationMs };
    }

    cancel() {
      this._stopReading = true;
      try { if (this._reader) this._reader.cancel(); } catch (e) { /* ignora */ }
      try { if (this._encoder && this._encoder.state !== 'closed') this._encoder.close(); } catch (e) { /* ignora */ }
      try { if (this._mr && this._mr.state !== 'inactive') this._mr.stop(); } catch (e) { /* ignora */ }
      this._cleanup();
    }

    _cleanup() {
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      if (this.audioCtx) this.audioCtx.close().catch(() => {});
      this.stream = null;
      this.audioCtx = null;
      this.analyser = null;
    }
  }

  root.WABX_VoiceRecorder = VoiceRecorder;
})(globalThis);
