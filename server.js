'use strict';
// 증강 아레나 - 온라인 중계 서버 (Node 내장 모듈만 사용)
// - index.html 제공 (항상 최신: no-cache)
// - /ws : 방(room)별 프레즌스 중계. 게임 판정은 방장 브라우저가 하고, 서버는 전달만 한다.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const TEST_LAT = Number(process.env.TEST_LAT) || 0;      // 테스트용 인위적 지연(ms). 평소엔 0
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const MAX_PRES = 4096, MAX_ROOMS_PER_CONN = 4, MAX_PEERS_PER_ROOM = 8, MAX_CONNS = 400;

function frame(op, payload) {
  const len = payload.length;
  let h;
  if (len < 126) h = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(len, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([h, payload]);
}
const textFrame = obj => frame(1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)));

const rooms = new Map();            // name -> Map(conn -> presence)
const conns = new Set();
let seq = 0;

class Conn {
  constructor(socket) {
    this.id = 'p' + (++seq).toString(36) + Math.random().toString(36).slice(2, 6);
    this.socket = socket; this.buf = Buffer.alloc(0); this.frag = []; this.alive = true;
    this.lastSeen = Date.now(); this.joined = new Set();
    socket.setNoDelay(true);
    socket.on('data', d => this.onData(d));
    socket.on('close', () => this.close());
    socket.on('error', () => this.close());
  }
  raw(buf) {
    if (!this.alive || !this.socket.writable) return;
    if (this.socket.writableLength > 1 << 20) { this.destroy(); return; }
    this.socket.write(buf);
  }
  send(obj) { this.raw(textFrame(obj)); }
  onData(d) {
    this.lastSeen = Date.now();
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
          if (msg && typeof msg === 'object') { try { onMessage(this, msg); } catch (e) { console.error(e); } }
        }
      }
    }
  }
  destroy() { try { this.socket.destroy(); } catch (e) { /* 무시 */ } this.close(); }
  close() {
    if (!this.alive) return;
    this.alive = false; conns.delete(this);
    for (const r of [...this.joined]) leaveRoom(this, r);
  }
}

function broadcast(room, except, obj) {
  const m = rooms.get(room); if (!m) return;
  const f = textFrame(obj);
  for (const c of m.keys()) if (c !== except) { if (TEST_LAT) setTimeout(() => c.raw(f), TEST_LAT); else c.raw(f); }
}
function joinRoom(c, name) {
  if (!NAME_RE.test(name) && name !== '') return;
  if (c.joined.has(name)) return;
  if (c.joined.size >= MAX_ROOMS_PER_CONN) return;
  let m = rooms.get(name); if (!m) { m = new Map(); rooms.set(name, m); }
  if (m.size >= MAX_PEERS_PER_ROOM && name !== '') { c.send({ t: 'err', room: name, code: 'room_full' }); return; }
  const peers = []; for (const [o, p] of m) peers.push([o.id, p]);
  m.set(c, {}); c.joined.add(name);
  c.send({ t: 'init', room: name, me: c.id, peers });
}
function leaveRoom(c, name) {
  const m = rooms.get(name); if (!m || !m.has(c)) return;
  m.delete(c); c.joined.delete(name);
  if (m.size === 0) rooms.delete(name); else broadcast(name, c, { t: 'l', room: name, id: c.id });
}
function onMessage(c, msg) {
  const room = typeof msg.room === 'string' ? msg.room : '';
  if (msg.t === 'join') joinRoom(c, room);
  else if (msg.t === 'leave') leaveRoom(c, room);
  else if (msg.t === 'pres') {
    const m = rooms.get(room); if (!m || !m.has(c)) return;
    const p = msg.p; if (!p || typeof p !== 'object') return;
    if (JSON.stringify(p).length > MAX_PRES) return;
    m.set(c, p); broadcast(room, c, { t: 'u', room, id: c.id, p });
  }
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
  if (url === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok ' + conns.size); return; }
  if (url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  res.writeHead(404); res.end('Not found');
});
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (req.url.split('?')[0] !== '/ws' || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket' || conns.size >= MAX_CONNS) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const c = new Conn(socket); conns.add(c);
});
setInterval(() => {
  const t = Date.now();
  for (const c of [...conns]) { if (t - c.lastSeen > 45000) c.destroy(); else c.raw(frame(9, Buffer.alloc(0))); }
}, 15000);

server.listen(PORT, () => console.log('증강 아레나 서버 시작: 포트 ' + PORT));
