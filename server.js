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

// ── 게임 엔진: index.html 안의 ENGINE 구간을 그대로 꺼내서 서버에서 돌린다 (규칙을 한 곳에서만 관리)
const SRC = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const SERVER_BUILD = Number((SRC.match(/const BUILD = (\d+);/) || [])[1]) || 0;
const eng = (() => {
  const a = SRC.indexOf('// ===== ENGINE START ====='), b = SRC.indexOf('// ===== ENGINE END =====');
  return new Function(SRC.slice(a, b) + '\nreturn { Game, CHARS, CHAR_ORDER, W, H };')();
})();
const W = eng.W;
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const cid = ch => eng.CHAR_ORDER.find(k => eng.CHARS[k] === ch);
const STEP = 1 / 60;
const sessions = new Map();      // 방 이름 -> Session

// 상대(방장 기준 1번 자리)를 기준으로 만든 화면 좌표계를, 0번 자리 사람 기준으로 좌우 반전·자리 교체
const mirrorSnap = s => {
  const mp = d => { const o = d.slice(); o[0] = r1(W - d[0]); o[2] = r1(-d[2]); o[4] = r2(Math.PI - d[4]); if (d[16]) o[16] = [r2(-d[16][0]), d[16][1]]; return o; };
  const flip = i => (i == null || i < 0 ? i : 1 - i);
  return Object.assign({}, s, {
    sc: [s.sc[1], s.sc[0]], rs: flip(s.rs), mw: flip(s.mw), ch: [s.ch[1], s.ch[0]], p: [mp(s.p[1]), mp(s.p[0])],
    b: s.b.map(b => [b[0], r1(W - b[1]), b[2], r1(-b[3]), b[4], b[5], 1 - b[6], b[7], b[8]]),
    f: s.f.map(f => { const o = Object.assign({}, f, { x: r1(W - f.x) }); if (f.a != null) o.a = r2(Math.PI - f.a); if (f.f != null) o.f = flip(f.f); return o; }),
    e: s.e.map(e => (e[1] === 'h' ? [e[0], 'h', r1(W - e[2]), e[3], e[4], 1 - e[5]] : [e[0], 't', r1(W - e[2]), e[3], e[4], e[5]])),
  });
};

class Session {
  constructor(room, ca, cb, charA, charB) {
    this.room = room; this.c = [ca, cb]; this.game = new eng.Game(charA, charB, 'normal'); this.game.remote = true;
    this.inp = [{ mx: 0, my: 0, h: 0 }, { mx: 0, my: 0, h: 0 }]; this.lastQ = [0, 0]; this.ackQ = [0, 0]; this.rx = [Date.now(), Date.now()]; this.rm = [0, 0];
    this.bid = 0; this.fid = 0; this.eid = 0; this.evBuf = []; this.n = 0; this.acc = 0; this.last = performance.now(); this.sent = 0;
    ca.sess = { s: this, k: 0 }; cb.sess = { s: this, k: 1 };
    this.timer = setInterval(() => this.tick(), 8);
  }
  input(k, i) {
    const g = this.game; this.rx[k] = Date.now();
    const mx = Math.max(-1, Math.min(1, +i.mx || 0)), my = Math.max(-1, Math.min(1, +i.my || 0));
    this.inp[k] = { mx: k === 0 ? -mx : mx, my, h: i.h ? 1 : 0 };      // 0번 자리 사람은 화면이 반전돼 있으므로 좌우를 되돌림
    for (const q of Array.isArray(i.q) ? i.q.slice(-8) : []) {
      if (!Array.isArray(q) || !(q[0] > this.lastQ[k])) continue; this.lastQ[k] = q[0];
      if (q[1] === 'd') g.pressDashP(k); else if (q[1] === 'a') g.pressAttackP(k);
      else if (q[1] === 's') g.pressSkillP(k, q[2] | 0, typeof q[3] === 'number' ? (k === 0 ? Math.PI - q[3] : q[3]) : undefined);
    }
  }
  wantRematch(k) { this.rm[k] = 1; if (this.rm[0] && this.rm[1] && this.game.ph === 'over') { this.game.startMatch(); this.rm = [0, 0]; this.evBuf = []; } }
  tick() {
    const now = performance.now(), g = this.game; this.acc = Math.min(0.25, this.acc + Math.min(0.1, (now - this.last) / 1000)); this.last = now;
    while (this.acc >= STEP) {
      for (let k = 0; k < 2; k++) { const stale = Date.now() - this.rx[k] > 1500, p = g.players[k]; p.inp = stale ? { mx: 0, my: 0 } : { mx: this.inp[k].mx, my: this.inp[k].my }; p.atkHold = stale ? false : !!this.inp[k].h; }
      g.update(STEP); this.acc -= STEP; this.ackQ = this.lastQ.slice();      // 입력은 계산에 반영된 다음 틱부터 "받았다"고 알림
      for (const e of g.ev) if (e.k === 'hit') this.evBuf.push({ t: now, a: [++this.eid, 'h', r1(e.x), r1(e.y), e.d, e.to] }); else if (e.k === 'text') this.evBuf.push({ t: now, a: [++this.eid, 't', r1(e.x), r1(e.y), e.txt, e.col] });
      g.ev = [];
    }
    this.evBuf = this.evBuf.filter(x => now - x.t < 1200);
    if (now - this.sent >= 16) { this.sent = now; this.send(); }
  }
  send() {
    const g = this.game, P = g.players;
    const pl = P.map(p => [r1(p.x), r1(p.y), r1(p.vx), r1(p.vy), r2(p.aim), r1(p.hp), p.maxHp, p.alive ? 1 : 0, r2(p.stun), r2(p.slowT), r1(p.shield), p.shieldMax, r2(p.shieldT), r2(p.drT), r2(p.haste), r2(p.dashT),
      p.charge ? [r2(p.charge.dx), r2(p.charge.dy)] : 0, r2(p.atkCd), r2(p.dashCd), r2(p.skCd[0]), r2(p.skCd[1]), r2(p.skCd[2]), r2(p.slowMul)]);
    const bl = g.bullets.slice(0, 18).map(b => [b._i || (b._i = ++this.bid), r1(b.x), r1(b.y), r1(b.vx), r1(b.vy), b.r, b.owner, b.col || 0, b.pierce ? 1 : 0]);
    const fl = g.fx.slice(0, 10).map(f => { if (!f._i) f._i = ++this.fid; const o = { i: f._i, k: f.k, x: r1(f.x), y: r1(f.y), l: r2(f.life), m: r2(f.max), c: f.col }; if (f.a != null) o.a = r2(f.a); if (f.r != null) o.r = r1(f.r); if (f.len != null) { o.len = r1(f.len); o.w = r1(f.w); } if (f.arc != null) o.arc = r2(f.arc); if (f.follow != null) o.f = f.follow; return o; });
    const s = { n: ++this.n, ph: g.ph, tm: r2(g.timer), ft: r2(g.fightT), rd: g.round, sc: g.score, rs: g.res ? g.res.w : null, mw: g.matchWinner, ch: [cid(P[0].ch), cid(P[1].ch)], a: 0, p: pl, b: bl, f: fl, e: this.evBuf.slice(-10).map(x => x.a) };
    const sB = Object.assign({}, s, { a: this.ackQ[1] }), sA = mirrorSnap(Object.assign({}, s, { a: this.ackQ[0] }));
    const go = () => { this.c[0].send({ t: 'snap', s: sA }); this.c[1].send({ t: 'snap', s: sB }); };
    if (TEST_LAT) setTimeout(go, TEST_LAT); else go();
  }
  end(except) { clearInterval(this.timer); sessions.delete(this.room); for (const c of this.c) { c.sess = null; if (c !== except && c.alive) c.send({ t: 'left' }); } }
}
function checkSession(room) {
  if (sessions.has(room) || room.slice(0, 2) !== 'g-') return;
  const m = rooms.get(room); if (!m) return;
  let hh = null, gg = null;
  for (const [c, p] of m) { if (p && p.r === 'h') hh = [c, p]; else if (p && p.r === 'g') gg = [c, p]; }
  if (!hh || !gg) return;
  let bad = false;
  for (const [c, p] of [hh, gg]) if (p.v !== SERVER_BUILD) { bad = true; if (!c.verrAt || Date.now() - c.verrAt > 3000) { c.verrAt = Date.now(); c.send({ t: 'verr', v: SERVER_BUILD }); } }
  if (bad || !eng.CHARS[hh[1].c] || !eng.CHARS[gg[1].c]) return;
  sessions.set(room, new Session(room, hh[0], gg[0], hh[1].c, gg[1].c));
}

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
  if (sessions.has(name)) sessions.get(name).end(c);
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
    m.set(c, p); broadcast(room, c, { t: 'u', room, id: c.id, p }); checkSession(room);
  } else if (msg.t === 'in') { if (c.sess && msg.i && typeof msg.i === 'object') { const s = c.sess.s, k = c.sess.k, i = msg.i; if (TEST_LAT) setTimeout(() => { if (c.sess) s.input(k, i); }, TEST_LAT); else s.input(k, i); } }
  else if (msg.t === 'dbg') { if (process.env.TEST_DEBUG && c.sess) { const g = c.sess.s.game; if (msg.fin && g.ph === 'fight') { g.players[1].hp = 1; g.players[0].x = g.players[1].x - 40; g.players[0].y = g.players[1].y; } } }      // 테스트 전용(환경변수가 있을 때만)
  else if (msg.t === 'ping') { c.send({ t: 'pong', id: msg.id }); }
  else if (msg.t === 'rm') { if (c.sess) c.sess.s.wantRematch(c.sess.k); }
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
