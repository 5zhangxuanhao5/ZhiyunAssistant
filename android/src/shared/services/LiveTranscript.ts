import { webSocket } from '../../desktop/compat';
import { util } from '../../desktop/compat';
import { BusinessError } from '../../desktop/compat';
import { captionSeconds } from '../model/CaptionTime';
import { Transcript, glueMessage, plain } from '../model/Timeline';

export function captionSocketUrl(address: string): string {
  const value = address.startsWith('//') ? 'https:' + address : address;
  if (value.includes('@')) return '';
  const match = /^(https?|wss?):\/\/([^/?#@\s]+)([^#\s]*)$/i.exec(value);
  if (!match) return '';
  const protocol = /^(https|wss)$/i.test(match[1]) ? 'wss:' : 'ws:';
  const parts = (match[3] || '').split('?'), path = parts[0];
  return protocol + '//' + match[2] + (/\/glue\/ws$/.test(path) ? path : path.replace(/\/$/, '') + '/glue/ws') + (parts.length > 1 ? '?' + parts.slice(1).join('?') : '');
}
interface LiveRaw { sourcetext?: string; end_time?: string | number; BeginSec?: number | string; EndSec?: number | string; time?: string | number; text_begin_time?: number | string; text_end_time?: number | string }
interface InitRaw { socketID?: string }
export class LiveTranscript {
  private socket: webSocket.WebSocket | undefined = undefined;
  private heartbeat: any = -1;
  private reconnect: any = -1;
  private speechWatch: any = -1;
  private lastSpeechAt: number = 0;
  private stopped: boolean = true;
  private address: string = '';
  private attempts: number = 0;
  private sequence: number = 0;
  private sentenceId: string = '';
  private sentenceStart: number = 0;
  private start: number = 0;
  private onLine: (line: Transcript) => void = () => {};
  private onStatus: (message: string) => void = () => {};
  connect(address: string, start: number, onLine: (line: Transcript) => void, onStatus: (message: string) => void): void {
    if (!this.stopped && this.address === address) return;
    this.close();
    // The URL comes exclusively from the authorized official course metadata.
    // Socket hosts may be campus IPs, unlike PPT image hosts. Never forward login credentials.
    const valid = captionSocketUrl(address);
    if (!valid) { onStatus('实时转写地址不可用，继续同步平台历史转写'); return; }
    this.address = valid;
    this.start = start; this.onLine = onLine; this.onStatus = onStatus; this.stopped = false; this.attempts = 0; this.open();
  }
  close(): void {
    this.stopped = true; clearTimeout(this.heartbeat); clearTimeout(this.reconnect); clearTimeout(this.speechWatch);
    this.heartbeat = -1; this.reconnect = -1; this.sentenceId = '';
    const socket = this.socket; this.socket = undefined;
    if (socket) { socket.off('open'); socket.off('message'); socket.off('error'); socket.off('close'); socket.close().catch(() => {}); }
  }
  private send(value: string): void { this.socket?.send(value).catch(() => this.retry()); }
  private resetHeartbeat(): void {
    clearTimeout(this.heartbeat);
    this.heartbeat = setTimeout(() => {
      this.send('pi');
      this.heartbeat = setTimeout(() => this.retry(), 5000);
    }, 35000);
  }
  private open(): void {
    if (this.stopped) return;
    const socket = webSocket.createWebSocket(); this.socket = socket; this.lastSpeechAt = Date.now();
    clearTimeout(this.speechWatch); this.watchSpeech(socket);
    socket.on('open', () => { if (this.socket === socket) this.send('in{"version":"1.9.1"}'); });
    socket.on('message', (err: BusinessError, value: string | ArrayBuffer) => {
      if (err || this.socket !== socket) return;
      if (typeof value !== 'string') { try { value = util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(value)); } catch (_) { return; } }
      this.resetHeartbeat();
      if (value.startsWith('pi')) { this.send('po'); return; }
      if (value.startsWith('in')) {
        try {
          const init = JSON.parse(value.slice(2)) as InitRaw;
          if (init.socketID) { this.attempts = 0; this.onStatus('实时转写已连接'); }
        } catch (_) { this.onStatus('实时转写协议发生变化，继续同步历史转写'); }
        return;
      }
      if (value.startsWith('dr')) { this.retry(); return; }
      const message = glueMessage(value);
      if (!message) return;
      try {
        const raw = JSON.parse(message) as LiveRaw;
        const text = plain(raw.sourcetext || '');
        if (!text) { if (String(raw.end_time) === '1') this.sentenceId = ''; return; }
        this.lastSpeechAt = Date.now();
        if (!this.sentenceId) { this.sentenceId = `live:${Date.now()}:${this.sequence++}`; const emitted = captionSeconds(raw.time, this.start); this.sentenceStart = Number.isFinite(emitted) && emitted >= 0 ? emitted : Math.max(0, Date.now() / 1000 - this.start); }
        const begin = captionSeconds(raw.BeginSec ?? raw.text_begin_time, this.start);
        const sourceEnd = captionSeconds(raw.EndSec ?? raw.text_end_time ?? raw.time, this.start);
        // The emission timestamp changes on every partial update. Only a sentence-start
        // timestamp can be used as its stable identity; otherwise keep the current sentence.
        const t = Number.isFinite(begin) && begin >= 0 ? begin : this.sentenceStart;
        const end = Number.isFinite(sourceEnd) ? Math.max(t, sourceEnd) : Math.max(t, Date.now() / 1000 - this.start);
        const exact = Number.isFinite(begin) && begin >= 0;
        this.onLine({ id: exact ? `asr:${t}` : this.sentenceId, t, end, text, timing: exact ? 'source' : 'received' });
        if (String(raw.end_time) === '1') this.sentenceId = '';
      } catch (_) { /* Keep other valid messages flowing. */ }
    });
    socket.on('error', () => this.retry()); socket.on('close', () => this.retry());
    this.heartbeat = setTimeout(() => this.retry(), 12000);
    socket.connect(this.address).catch(() => this.retry());
  }
  private watchSpeech(socket: webSocket.WebSocket): void {
    this.speechWatch = setTimeout(() => { if (this.stopped || this.socket !== socket) return; if (Date.now() - this.lastSpeechAt >= 120000) this.retry(); else this.watchSpeech(socket); }, 30000);
  }
  private retry(): void {
    if (this.stopped || this.reconnect >= 0) return;
    clearTimeout(this.heartbeat); clearTimeout(this.speechWatch);
    const socket = this.socket; this.socket = undefined;
    if (socket) { socket.off('open'); socket.off('message'); socket.off('error'); socket.off('close'); socket.close().catch(() => {}); }
    this.onStatus('实时连接中断，正在重连；历史转写继续同步');
    this.reconnect = setTimeout(() => { this.reconnect = -1; this.sentenceId = ''; this.open(); }, Math.min(15000, 2000 * Math.pow(2, this.attempts++)));
  }
}
