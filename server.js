// 증강 아레나 - Node 서버 (Render 등). 게임 로직은 core.mjs, 이 파일은 HTTP/WebSocket 연결만 담당
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Hub } from './core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const hub = new Hub({ lat: Number(process.env.TEST_LAT) || 0, debug: !!process.env.TEST_DEBUG });
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_CONNS = 400;
const live = new Set();

function frame(op, payload) {
  const len = payload.length;
  let h;
  if (len < 126) h = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(len, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([h, payload]);
}
const textFrame = obj => frame(1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)));

class Conn {
  constructor(socket) {
    this.socket = socket; this.buf = Buffer.alloc(0); this.frag = [];
    this.c = hub.addConn(str => this.raw(textFrame(str)), () => { try { socket.destroy(); } catch (e) { /* 무시 */ } });
    live.add(this);
    socket.setNoDelay(true);
    socket.on('data', d => this.onData(d));
    socket.on('close', () => this.close());
    socket.on('error', () => this.close());
  }
  raw(buf) {
    if (!this.c.alive || !this.socket.writable) return;
    if (this.socket.writableLength > 1 << 20) { this.destroy(); return; }
    this.socket.write(buf);
  }
  onData(d) {
    this.c.lastSeen = Date.now();
    this.buf = Buffer.concat([this.buf, d]);
    if (this.buf.length > 1 << 17) { this.destroy(); return; }
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = !!(b[0] & 0x80), op = b[0] & 0x0f, masked = !!(b[1] & 0x80);
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (!masked || len > 65536) { this.destroy(); return; }
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      if (op === 8) { this.raw(frame(8, Buffer.alloc(0))); this.destroy(); return; }
      if (op === 9) { this.raw(frame(10, payload)); continue; }
      if (op === 10) continue;
      if (op === 1 || op === 0) {
        if (op === 1) this.frag = [];
        this.frag.push(payload);
        if (this.frag.length > 8) { this.destroy(); return; }
        if (fin) {
          let msg = null;
          try { msg = JSON.parse(Buffer.concat(this.frag).toString('utf8')); } catch (e) { /* 무시 */ }
          this.frag = [];
          if (msg && typeof msg === 'object') { try { hub.onMessage(this.c, msg); } catch (e) { console.error(e); } }
        }
      }
    }
  }
  destroy() { this.c.kill(); }
  close() { live.delete(this); hub.drop(this.c); }
}

const INDEX = path.join(__dirname, 'index.html');
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    fs.readFile(INDEX, (e, d) => {
      if (e) { res.writeHead(500); res.end('index.html missing'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(d);
    });
    return;
  }
  if (url === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok ' + hub.conns.size); return; }
  if (url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  res.writeHead(404); res.end('Not found');
});
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (req.url.split('?')[0] !== '/ws' || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket' || hub.conns.size >= MAX_CONNS) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  new Conn(socket);
});
setInterval(() => { for (const k of live) k.raw(frame(9, Buffer.alloc(0))); }, 15000);      // 연결 유지용 ping (브라우저가 자동으로 pong 응답)

server.listen(PORT, () => console.log('증강 아레나 서버 시작: 포트 ' + PORT));
