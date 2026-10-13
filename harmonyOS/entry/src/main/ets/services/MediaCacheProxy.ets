import { BusinessError } from '@kit.BasicServicesKit';
import { socket } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { VideoNetwork } from './VideoNetwork';
// Loopback transport lets the system media engine handle HTTP Range normally.
// It only serves the selected source; the random route is never an arbitrary URL proxy.
export class MediaCacheProxy {
  private network: VideoNetwork;
  private server: socket.TCPSocketServer | undefined = undefined;
  private clients: Set<socket.TCPSocketConnection> = new Set();
  private epoch: number = 0;
  constructor(network: VideoNetwork) { this.network = network; }
  stop(): void { this.epoch++; this.clients.forEach((client: socket.TCPSocketConnection) => client.close().catch(() => {})); this.clients.clear(); const server = this.server; this.server = undefined; if (server) server.close().catch(() => {}); }
  async start(address: string): Promise<string> {
    this.stop(); const gen = this.epoch;
    const random = cryptoFramework.createRandom(), bytes = random.generateRandomSync(24).data;
    const route = '/' + Array.from(bytes).map((n: number) => n.toString(16).padStart(2, '0')).join('') + '/video.mp4';
    const server = socket.constructTCPSocketServerInstance(); this.server = server;
    try { await server.listen({ address: '127.0.0.1', port: 0, family: 1 }); } catch (err) { server.close().catch(() => {}); if (this.server === server) this.server = undefined; throw new Error((err as Error).message || '本机播放服务未能启动'); }
    if (gen !== this.epoch) { server.close().catch(() => {}); throw new Error('播放已取消'); }
    server.on('connect', (client: socket.TCPSocketConnection) => {
      if (gen !== this.epoch || this.clients.size >= 6) { client.close().catch(() => {}); return; }
      console.info('[ZhiyunVideo] loopback connect'); this.clients.add(client); let head = '', handled = false;
      const timer = setTimeout(() => client.close().catch(() => {}), 60000);
      client.on('close', () => { clearTimeout(timer); this.clients.delete(client); });
      client.on('error', () => { clearTimeout(timer); this.clients.delete(client); client.close().catch(() => {}); });
      client.on('message', (message: socket.SocketMessageInfo) => {
        if (handled) return;
        head += util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(message.message));
        if (head.length > 8192) { handled = true; client.close().catch(() => {}); return; }
        if (!head.includes('\r\n\r\n')) return; handled = true;
        this.respond(client, head, route, address, gen).finally(() => { clearTimeout(timer); this.clients.delete(client); client.close().catch(() => {}); });
      });
    });
    const local = await server.getLocalAddress(); console.info('[ZhiyunVideo] loopback ready port=' + local.port); return 'http://127.0.0.1:' + local.port + route;
  }
  private async respond(client: socket.TCPSocketConnection, head: string, route: string, address: string, gen: number): Promise<void> {
    try {
      const first = /^(GET|HEAD) ([^ ]+) HTTP\/1\.[01]\r\n/.exec(head);
      if (!first || first[2] !== route || gen !== this.epoch) { await client.send({ data: 'HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n' }); return; }
      const range = /\r\nRange:\s*bytes=(\d+)-(\d*)\s*\r\n/i.exec(head), start = range ? Number(range[1]) : 0;
      const end = range && range[2] ? Math.min(Number(range[2]) + 1, start + 4 * 1024 * 1024) : start + 4 * 1024 * 1024;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) throw new Error('无效范围');
      console.info('[ZhiyunVideo] loopback range=' + start + '-' + end); const reply = await this.network.read('mp4-cache', address, start, end, true); console.info('[ZhiyunVideo] loopback reply=' + reply.status + ' bytes=' + reply.size);
      if (gen !== this.epoch) return;
      const status = reply.status === 206 ? 206 : reply.status === 200 ? 200 : 503;
      const data = status === 503 ? new Uint8Array(0) : reply.data ? new Uint8Array(reply.data) : new util.Base64Helper().decodeSync(reply.base64);
      const headers = 'HTTP/1.1 ' + status + (status === 206 ? ' Partial Content' : status === 200 ? ' OK' : ' Service Unavailable') + '\r\nContent-Type: video/mp4\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: ' + data.byteLength + '\r\n' + (/^bytes \d+-\d+\/(?:\d+|\*)$/.test(reply.contentRange) ? 'Content-Range: ' + reply.contentRange + '\r\n' : '') + 'Connection: close\r\n\r\n';
      await client.send({ data: headers });
      if (first[1] === 'GET') for (let offset = 0; offset < data.byteLength && gen === this.epoch; offset += 128 * 1024) await client.send({ data: data.slice(offset, Math.min(data.byteLength, offset + 128 * 1024)).buffer as ArrayBuffer });
    } catch (err) { console.info('[ZhiyunVideo] loopback failure code=' + Number((err as BusinessError).code || 0)); try { await client.send({ data: 'HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n' }); } catch (_) {} }
  }
}
