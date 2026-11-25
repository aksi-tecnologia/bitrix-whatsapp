/* Muxer Ogg/Opus mínimo: recebe pacotes Opus crus e devolve um .ogg válido (RFC 7845). */
(function (root) {
  'use strict';

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let r = i << 24;
      for (let j = 0; j < 8; j++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
      t[i] = r >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let crc = 0;
    for (let i = 0; i < bytes.length; i++) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ bytes[i]) & 0xff]) >>> 0;
    return crc;
  }

  function opusHead(channels, inputSampleRate, preSkip) {
    const b = new Uint8Array(19);
    const v = new DataView(b.buffer);
    b.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]); // "OpusHead"
    b[8] = 1;
    b[9] = channels;
    v.setUint16(10, preSkip, true);
    v.setUint32(12, inputSampleRate, true);
    v.setInt16(16, 0, true);
    b[18] = 0;
    return b;
  }

  function opusTags(vendor) {
    const enc = new TextEncoder().encode(vendor);
    const b = new Uint8Array(8 + 4 + enc.length + 4);
    const v = new DataView(b.buffer);
    b.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73]); // "OpusTags"
    v.setUint32(8, enc.length, true);
    b.set(enc, 12);
    v.setUint32(12 + enc.length, 0, true);
    return b;
  }

  function page(serial, seq, granule, flags, packets) {
    const segs = [];
    let dataLen = 0;
    for (const p of packets) {
      let n = p.length;
      while (n >= 255) { segs.push(255); n -= 255; }
      segs.push(n);
      dataLen += p.length;
    }
    const out = new Uint8Array(27 + segs.length + dataLen);
    const v = new DataView(out.buffer);
    out.set([0x4f, 0x67, 0x67, 0x53]); // "OggS"
    out[4] = 0;
    out[5] = flags;
    v.setUint32(6, Number(granule & 0xffffffffn), true);
    v.setUint32(10, Number((granule >> 32n) & 0xffffffffn), true);
    v.setUint32(14, serial, true);
    v.setUint32(18, seq, true);
    v.setUint32(22, 0, true);
    out[26] = segs.length;
    out.set(segs, 27);
    let off = 27 + segs.length;
    for (const p of packets) { out.set(p, off); off += p.length; }
    v.setUint32(22, crc32(out), true);
    return out;
  }

  function segCount(len) { return Math.floor(len / 255) + 1; }

  /**
   * @param {{data: Uint8Array, samples: number}[]} packets  pacotes Opus; samples = duração em amostras a 48 kHz
   * @param {{channels?: number, inputSampleRate?: number, preSkip?: number, head?: Uint8Array}} opts
   * @returns {Uint8Array}
   */
  function muxOggOpus(packets, opts) {
    opts = opts || {};
    const channels = opts.channels || 1;
    let head = opts.head;
    let preSkip = opts.preSkip == null ? 312 : opts.preSkip;
    if (head && head.length >= 19 && String.fromCharCode.apply(null, head.subarray(0, 8)) === 'OpusHead') {
      preSkip = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint16(10, true);
    } else {
      head = opusHead(channels, opts.inputSampleRate || 48000, preSkip);
    }
    const serial = (Math.random() * 0xffffffff) >>> 0;
    const pages = [];
    let seq = 0;
    pages.push(page(serial, seq++, 0n, 0x02, [head]));
    pages.push(page(serial, seq++, 0n, 0x00, [opusTags('bitrix-whatsapp-skin')]));

    let granule = BigInt(preSkip);
    let batch = [];
    let batchSegs = 0;
    let batchSamples = 0;
    const flush = (last) => {
      if (!batch.length && !last) return;
      pages.push(page(serial, seq++, granule, last ? 0x04 : 0x00, batch));
      batch = [];
      batchSegs = 0;
      batchSamples = 0;
    };
    for (let i = 0; i < packets.length; i++) {
      const p = packets[i];
      const s = segCount(p.data.length);
      if (s > 255) continue; // pacote absurdo, ignora
      if (batchSegs + s > 255 || batchSamples >= 48000) flush(false);
      batch.push(p.data);
      batchSegs += s;
      batchSamples += p.samples;
      granule += BigInt(p.samples);
    }
    flush(true);

    let total = 0;
    for (const p of pages) total += p.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of pages) { out.set(p, off); off += p.length; }
    return out;
  }

  const api = { muxOggOpus, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WABX_OGG = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
