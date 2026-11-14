// 증강 아레나 - 서버 공용 로직 (Node 서버와 Cloudflare Durable Object가 함께 사용)
// 방 중계(프레즌스) + 서버 판정 게임 세션. 전송 방식(WebSocket 구현)은 어댑터가 맡는다.
import * as eng from './engine.mjs';

const NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const MAX_PRES = 4096, MAX_ROOMS_PER_CONN = 4, MAX_PEERS_PER_ROOM = 8, STEP = 1 / 60;
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const W = eng.W;
const cid = ch => eng.CHAR_ORDER.find(k => eng.CHARS[k] === ch);
export const SERVER_BUILD = eng.BUILD;

// 상대 자리(1번) 기준 좌표계로 만든 상태를, 0번 자리 사람 기준(좌우 반전·자리 교체)으로 바꿈
const pickMap = () => eng.MAP_ORDER[Math.floor(Math.random() * eng.MAP_ORDER.length)];
export const mirrorSnap = s => {
  const mp = d => { const o = d.slice(); o[0] = r1(W - d[0]); o[2] = r1(-d[2]); o[4] = r2(Math.PI - d[4]); if (d[16]) o[16] = [r2(-d[16][0]), d[16][1]]; return o; };
  const flip = i => (i == null || i < 0 ? i : 1 - i);
  return Object.assign({}, s, {
    mm: 1, sc: [s.sc[1], s.sc[0]], rs: flip(s.rs), mw: flip(s.mw), ch: [s.ch[1], s.ch[0]], p: [mp(s.p[1]), mp(s.p[0])],
    b: s.b.map(b => [b[0], r1(W - b[1]), b[2], r1(-b[3]), b[4], b[5], 1 - b[6], b[7], b[8]]),
    f: s.f.map(f => { const o = Object.assign({}, f, { x: r1(W - f.x) }); if (f.a != null) o.a = r2(Math.PI - f.a); if (f.f != null) o.f = flip(f.f); return o; }),
    e: s.e.map(e => (e[1] === 'h' ? [e[0], 'h', r1(W - e[2]), e[3], e[4], 1 - e[5]] : [e[0], 't', r1(W - e[2]), e[3], e[4], e[5]])),
  });
};

class Session {
  constructor(hub, room, ca, cb, charA, charB) {
    this.hub = hub; this.room = room; this.c = [ca, cb]; this.game = new eng.Game(charA, charB, 'normal', pickMap()); this.game.remote = true;
    this.inp = [{ mx: 0, my: 0, h: 0 }, { mx: 0, my: 0, h: 0 }]; this.lastQ = [0, 0]; this.ackQ = [0, 0]; this.rx = [Date.now(), Date.now()]; this.rm = [0, 0]; this.rmc = [null, null];
    this.gaps = []; this.bid = 0; this.fid = 0; this.eid = 0; this.evBuf = []; this.n = 0; this.acc = 0; this.last = performance.now(); this.sent = 0;
    ca.sess = { s: this, k: 0 }; cb.sess = { s: this, k: 1 }; ca.ackN = cb.ackN = 0;
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
  stat() {      // 진단: 최근 3초 상태 전송 간격 (평균/최대, ms)
    const g = this.gaps; if (g.length < 5) return null;
    let sum = 0, mx = 0; for (const x of g) { sum += x[1]; if (x[1] > mx) mx = x[1]; }
    return [Math.round(sum / g.length), Math.round(mx)];
  }
  wantRematch(k, ch) {      // 다시하기: 각자 같은 캐릭터 또는 새로 뽑은(랜덤) 캐릭터를 골라서 보냄
    this.rm[k] = 1; if (eng.CHAR_ORDER.includes(ch)) this.rmc[k] = ch;
    if (this.rm[0] && this.rm[1] && this.game.ph === 'over') {
      const P = this.game.players, a = this.rmc[0] || cid(P[0].ch), b = this.rmc[1] || cid(P[1].ch);
      if (a !== cid(P[0].ch) || b !== cid(P[1].ch)) { this.game = new eng.Game(a, b, 'normal', pickMap()); this.game.remote = true; } else { this.game.setMap(pickMap()); this.game.startMatch(); }
      this.rm = [0, 0]; this.rmc = [null, null]; this.evBuf = [];
    }
  }
  tick() {
    const now = performance.now(), g = this.game;
    let dt = (now - this.last) / 1000; if (!(dt > 0)) dt = 0.008;      // 시계가 멈춰 있어도(일부 서버 환경) 진행되도록 기본 간격 사용
    this.acc = Math.min(0.25, this.acc + Math.min(0.1, dt)); this.last = now;
    while (this.acc >= STEP) {
      for (let k = 0; k < 2; k++) { const stale = Date.now() - this.rx[k] > 1500, p = g.players[k]; p.inp = stale ? { mx: 0, my: 0 } : { mx: this.inp[k].mx, my: this.inp[k].my }; p.atkHold = stale ? false : !!this.inp[k].h; }
      g.update(STEP); this.acc -= STEP; this.ackQ = this.lastQ.slice();      // 입력은 계산에 반영된 다음 틱부터 "받았다"고 알림
      for (const e of g.ev) if (e.k === 'hit') this.evBuf.push({ t: now, a: [++this.eid, 'h', r1(e.x), r1(e.y), e.d, e.to] }); else if (e.k === 'text') this.evBuf.push({ t: now, a: [++this.eid, 't', r1(e.x), r1(e.y), e.txt, e.col] });
      g.ev = [];
    }
    this.evBuf = this.evBuf.filter(x => now - x.t < 1200);
    if (now - this.sent >= 16 || now < this.sent) {
      if (this.sent) { this.gaps.push([now, now - this.sent]); while (this.gaps.length && now - this.gaps[0][0] > 3000) this.gaps.shift(); }
      this.sent = now; this.send();
    }
  }
  send() {
    const g = this.game, P = g.players;
    const pl = P.map(p => [r1(p.x), r1(p.y), r1(p.vx), r1(p.vy), r2(p.aim), r1(p.hp), p.maxHp, p.alive ? 1 : 0, r2(p.stun), r2(p.slowT), r1(p.shield), p.shieldMax, r2(p.shieldT), r2(p.drT), r2(p.haste), r2(p.dashT),
      p.charge ? [r2(p.charge.dx), r2(p.charge.dy)] : 0, r2(p.atkCd), r2(p.dashCd), r2(p.skCd[0]), r2(p.skCd[1]), r2(p.skCd[2]), r2(p.slowMul), p.dashN | 0, r2(Math.max(0, p.stl)), p.emp ? 1 : 0, p.cnt ? r2(p.cnt.t) : 0, p.rage ? 1 : 0]);      // 23~26: 대시 충전, 은신 남은 시간, 기본공격 강화, 반격 남은 시간
    const bl = g.bullets.slice(0, 18).map(b => [b._i || (b._i = ++this.bid), r1(b.x), r1(b.y), r1(b.vx), r1(b.vy), b.r, b.owner, b.col || 0, b.pierce ? 1 : 0]);
    const fl = g.fx.slice(0, 10).map(f => { if (!f._i) f._i = ++this.fid; const o = { i: f._i, k: f.k, x: r1(f.x), y: r1(f.y), l: r2(f.life), m: r2(f.max), c: f.col }; if (f.a != null) o.a = r2(f.a); if (f.r != null) o.r = r1(f.r); if (f.len != null) { o.len = r1(f.len); o.w = r1(f.w); } if (f.arc != null) o.arc = r2(f.arc); if (f.follow != null) o.f = f.follow; if (f.fist) o.fi = 1; return o; });
    const s = { n: ++this.n, ph: g.ph, tm: r2(g.timer), ft: r2(g.fightT), rd: g.round, sc: g.score, rs: g.res ? g.res.w : null, mw: g.matchWinner, ch: [cid(P[0].ch), cid(P[1].ch)], mp: g.mapId, es: g.ess ? [g.ess.up ? 1 : 0, r2(g.ess.t)] : 0, a: 0, p: pl, b: bl, f: fl, e: this.evBuf.slice(-10).map(x => x.a) };
    const sB = Object.assign({}, s, { a: this.ackQ[1] }), sA = mirrorSnap(Object.assign({}, s, { a: this.ackQ[0] }));
    const go = () => {      // 흐름 제어: 상대가 받았다고 알려온 번호보다 너무 앞서 있으면(회선이 느려 쌓이는 중) 드물게만 보내 지연이 수 초로 불어나는 걸 막음
      const S = [sA, sB];
      for (let k = 0; k < 2; k++) { const c = this.c[k], lag = this.n - (c.ackN || 0); if (lag > 48 && this.n % (lag > 150 ? 30 : 8) !== 0) { this.skipped = (this.skipped || 0) + 1; continue; } c.send({ t: 'snap', s: S[k] }); }
    };
    if (this.hub.lat) setTimeout(go, this.hub.lat); else go();
  }
  end(except) { clearInterval(this.timer); this.hub.sessions.delete(this.room); for (const c of this.c) { c.sess = null; if (c !== except && c.alive) c.send({ t: 'left' }); } }
}

export class Hub {
  // opts.lat: 테스트용 인위적 지연(ms), opts.debug: 테스트 전용 명령 허용
  constructor(opts = {}) { this.lat = opts.lat || 0; this.debug = !!opts.debug; this.rooms = new Map(); this.sessions = new Map(); this.conns = new Set(); this.seq = 0; this.sweepTimer = null; }
  // 새 접속을 등록. sendStr(문자열)로 보내고, kill()로 연결을 끊는다.
  addConn(sendStr, kill) {
    const hub = this;
    const c = {
      id: 'p' + (++this.seq).toString(36) + Math.random().toString(36).slice(2, 6), alive: true, joined: new Set(), sess: null, lastSeen: Date.now(), verrAt: 0,
      sendStr(str) { if (c.alive) { try { sendStr(str); } catch (e) { /* 끊긴 연결 */ } } },
      send(obj) { c.sendStr(JSON.stringify(obj)); },
      kill() { try { kill(); } catch (e) { /* 무시 */ } hub.drop(c); },
    };
    this.conns.add(c);
    if (!this.sweepTimer) this.sweepTimer = setInterval(() => this.sweep(), 15000);
    return c;
  }
  drop(c) {
    if (!c.alive) return; c.alive = false; this.conns.delete(c);
    for (const r of [...c.joined]) this.leaveRoom(c, r);
    if (this.conns.size === 0 && this.sweepTimer) { clearInterval(this.sweepTimer); this.sweepTimer = null; }
  }
  sweep() { const t = Date.now(); for (const c of [...this.conns]) if (t - c.lastSeen > 45000) c.kill(); }
  broadcast(room, except, obj) {
    const m = this.rooms.get(room); if (!m) return;
    const f = JSON.stringify(obj);
    for (const c of m.keys()) if (c !== except) { if (this.lat) setTimeout(() => c.sendStr(f), this.lat); else c.sendStr(f); }
  }
  joinRoom(c, name) {
    if (!NAME_RE.test(name) && name !== '') return;
    if (c.joined.has(name) || c.joined.size >= MAX_ROOMS_PER_CONN) return;
    let m = this.rooms.get(name); if (!m) { m = new Map(); this.rooms.set(name, m); }
    if (m.size >= MAX_PEERS_PER_ROOM && name !== '') { c.send({ t: 'err', room: name, code: 'room_full' }); return; }
    const peers = []; for (const [o, p] of m) peers.push([o.id, p]);
    m.set(c, {}); c.joined.add(name);
    c.send({ t: 'init', room: name, me: c.id, peers });
  }
  leaveRoom(c, name) {
    const m = this.rooms.get(name); if (!m || !m.has(c)) return;
    m.delete(c); c.joined.delete(name);
    if (this.sessions.has(name)) this.sessions.get(name).end(c);
    if (m.size === 0) this.rooms.delete(name); else this.broadcast(name, c, { t: 'l', room: name, id: c.id });
  }
  checkSession(room) {
    if (this.sessions.has(room) || room.slice(0, 2) !== 'g-') return;
    const m = this.rooms.get(room); if (!m) return;
    let hh = null, gg = null;
    for (const [c, p] of m) { if (p && p.r === 'h') hh = [c, p]; else if (p && p.r === 'g') gg = [c, p]; }
    if (!hh || !gg) return;
    let bad = false;
    for (const [c, p] of [hh, gg]) if (p.v !== SERVER_BUILD) { bad = true; if (!c.verrAt || Date.now() - c.verrAt > 3000) { c.verrAt = Date.now(); c.send({ t: 'verr', v: SERVER_BUILD }); } }
    if (bad || !eng.CHAR_ORDER.includes(hh[1].c) || !eng.CHAR_ORDER.includes(gg[1].c)) return;
    this.sessions.set(room, new Session(this, room, hh[0], gg[0], hh[1].c, gg[1].c));
  }
  onMessage(c, msg) {
    c.lastSeen = Date.now();
    const room = typeof msg.room === 'string' ? msg.room : '';
    if (msg.t === 'join') this.joinRoom(c, room);
    else if (msg.t === 'leave') this.leaveRoom(c, room);
    else if (msg.t === 'pres') {
      const m = this.rooms.get(room); if (!m || !m.has(c)) return;
      const p = msg.p; if (!p || typeof p !== 'object') return;
      if (JSON.stringify(p).length > MAX_PRES) return;
      m.set(c, p); this.broadcast(room, c, { t: 'u', room, id: c.id, p }); this.checkSession(room);
    } else if (msg.t === 'in') {
      if (c.sess && msg.i && typeof msg.i === 'object') { const s = c.sess.s, k = c.sess.k, i = msg.i; if (typeof i.sn === 'number' && i.sn > (c.ackN || 0)) c.ackN = i.sn; if (this.lat) setTimeout(() => { if (c.sess) s.input(k, i); }, this.lat); else s.input(k, i); }
    } else if (msg.t === 'dbg') {
      if (this.debug && c.sess) { const g = c.sess.s.game; if (msg.fin && g.ph === 'fight') { g.players[1].hp = 1; g.players[0].x = g.players[1].x - 40; g.players[0].y = g.players[1].y; } }      // 테스트 전용
    } else if (msg.t === 'ping') c.send({ t: 'pong', id: msg.id, sv: c.sess ? c.sess.s.stat() : null });
    else if (msg.t === 'rm') { if (c.sess) c.sess.s.wantRematch(c.sess.k, msg.c); }
  }
}
