// 증강 아레나 - 서버 공용 로직 (Node 서버와 Cloudflare Durable Object가 함께 사용)
// 방 중계(프레즌스) + 서버 판정 게임 세션. 전송 방식(WebSocket 구현)은 어댑터가 맡는다.
import * as eng from './engine.mjs';

const NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const MAX_PRES = 4096, MAX_ROOMS_PER_CONN = 4, MAX_PEERS_PER_ROOM = 8, STEP = 1 / 60;
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const W = eng.W;
const cleanNick = v => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 8) : ''),
  nickOf = p => cleanNick(p && p.nk);
const cid = ch => eng.CHAR_ORDER.find(k => eng.CHARS[k] === ch);
export const SERVER_BUILD = eng.BUILD;

// 상대 자리(1번) 기준 좌표계로 만든 상태를, 0번 자리 사람 기준(좌우 반전·자리 교체)으로 바꿈
const pickMap = () => eng.MAP_ORDER[Math.floor(Math.random() * eng.MAP_ORDER.length)];
export const mirrorSnap = s => {
  const mp = d => { const o = d.slice(); o[0] = r1(W - d[0]); o[2] = r1(-d[2]); o[4] = r2(Math.PI - d[4]); if (d[16]) o[16] = [r2(-d[16][0]), d[16][1]]; return o; };
  const flip = i => (i == null || i < 0 ? i : 1 - i);
  return Object.assign({}, s, {
    mm: 1, mn: (s.mn || []).map(m => { const o = m.slice(); o[1] = r1(W - m[1]); o[3] = r1(-m[3]); o[7] = 1 - m[7]; o[8] = r2(Math.PI - m[8]); return o; }), pw: (s.pw || []).map(w => [r1(W - w[0]), w[1], Math.round((Math.PI - w[2]) * 1000) / 1000, w[3], w[4], 1 - w[5], w[6], w[7]]), sc: [s.sc[1], s.sc[0]], rs: flip(s.rs), mw: flip(s.mw), ch: [s.ch[1], s.ch[0]], nk: [(s.nk || [])[1] || '', (s.nk || [])[0] || ''], p: [mp(s.p[1]), mp(s.p[0])],
    b: s.b.map(b => [b[0], r1(W - b[1]), b[2], r1(-b[3]), b[4], b[5], 1 - b[6], b[7], b[8]]),
    f: s.f.map(f => { const o = Object.assign({}, f, { x: r1(W - f.x) }); if (f.a != null) o.a = r2(Math.PI - f.a); if (f.f != null) o.f = flip(f.f); return o; }),
    e: s.e.map(e => (e[1] === 'w' ? [e[0], 'w', 1 - e[2]] : e[1] === 'h' ? [e[0], 'h', r1(W - e[2]), e[3], e[4], 1 - e[5]] : [e[0], 't', r1(W - e[2]), e[3], e[4], e[5]])),
  });
};

class Session {
  constructor(hub, room, ca, cb, charA, charB, nickA, nickB) {
    this.hub = hub; this.room = room; this.c = [ca, cb]; this.nk = [nickA || '', nickB || '']; this.game = new eng.Game(charA, charB, 'normal', pickMap()); this.game.remote = true;
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
      if (q[1] === 'd') g.pressDashP(k, typeof q[2] === 'number' ? (k === 0 ? -q[2] : q[2]) : 0, +q[3] || 0); else if (q[1] === 'a') g.pressAttackP(k, typeof q[2] === 'number' ? (k === 0 ? Math.PI - q[2] : q[2]) : undefined);
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
      for (const e of g.ev) if (e.k === 'hit') this.evBuf.push({ t: now, a: [++this.eid, 'h', r1(e.x), r1(e.y), e.d, e.to] }); else if (e.k === 'text') this.evBuf.push({ t: now, a: [++this.eid, 't', r1(e.x), r1(e.y), e.txt, e.col] }); else if (e.k === 'swap') this.evBuf.push({ t: now, a: [++this.eid, 'w', e.p] });
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
      p.charge ? [r2(p.charge.dx), r2(p.charge.dy)] : 0, r2(p.atkCd), r2(p.dashCd), r2(p.skCd[0]), r2(p.skCd[1]), r2(p.skCd[2]), r2(p.slowMul), p.dashN | 0, r2(Math.max(0, p.stl)), p.emp ? 1 : 0, p.cnt ? r2(p.cnt.t) : 0, p.rage ? 1 : 0, p.hits | 0, p.adv ? 1 : 0]);      // 23~26: 대시 충전, 은신 남은 시간, 기본공격 강화, 반격 남은 시간
    const bl = g.bullets.slice(0, 18).map(b => [b._i || (b._i = ++this.bid), r1(b.x), r1(b.y), r1(b.vx), r1(b.vy), b.r, b.owner, b.col || 0, b.pierce ? 1 : 0]);
    const fl = g.fx.slice(0, 10).map(f => { if (!f._i) f._i = ++this.fid; const o = { i: f._i, k: f.k, x: r1(f.x), y: r1(f.y), l: r2(f.life), m: r2(f.max), c: f.col }; if (f.a != null) o.a = r2(f.a); if (f.r != null) o.r = r1(f.r); if (f.len != null) { o.len = r1(f.len); o.w = r1(f.w); } if (f.arc != null) o.arc = r2(f.arc); if (f.follow != null) o.f = f.follow; if (f.fist) o.fi = 1; return o; });
    const mn = g.minions.slice(0, 10).map(m => [m.id, r1(m.x), r1(m.y), r1(m.vx), r1(m.vy), r1(m.hp), m.kind === 'orb' ? 1 : 0, m.owner, r2(m.aim), m.fire ? 1 : 0, m.maxHp, m.r, m.guard > 0 ? 1 : 0]);
    const pw = g.pw.map(w => [r1(w.cx), r1(w.cy), Math.round(w.a * 1000) / 1000, w.fw, w.fh, w.own, r2(w.t), w.max]);
    const s = { n: ++this.n, mn, pw, ph: g.ph, tm: r2(g.timer), ft: r2(g.fightT), rd: g.round, sc: g.score, rs: g.res ? g.res.w : null, mw: g.matchWinner, ch: [cid(P[0].ch), cid(P[1].ch)], nk: this.nk, mp: g.mapId, es: g.ess ? [g.ess.up ? 1 : 0, r2(g.ess.t)] : 0, a: 0, p: pl, b: bl, f: fl, e: this.evBuf.slice(-10).map(x => x.a) };
    const sB = Object.assign({}, s, { a: this.ackQ[1] }), sA = mirrorSnap(Object.assign({}, s, { a: this.ackQ[0] }));
    const go = () => {      // 흐름 제어: 상대가 받았다고 알려온 번호보다 너무 앞서 있으면(회선이 느려 쌓이는 중) 드물게만 보내 지연이 수 초로 불어나는 걸 막음
      const S = [sA, sB];
      for (let k = 0; k < 2; k++) { const c = this.c[k], lag = this.n - (c.ackN || 0); if (lag > 48 && this.n % (lag > 150 ? 30 : 8) !== 0) { this.skipped = (this.skipped || 0) + 1; continue; } c.send({ t: 'snap', s: S[k] }); }
    };
    if (this.hub.lat) setTimeout(go, this.hub.lat); else go();
  }
  end(except) { clearInterval(this.timer); this.hub.sessions.delete(this.room); for (const c of this.c) { c.sess = null; if (c !== except && c.alive) c.send({ t: 'left' }); } }
}

// ───────────── 2대2 (4명) 세션: 0·1번이 한 팀(왼쪽), 2·3번이 한 팀(오른쪽) ─────────────
// 각 사람에게 보내는 상태는 1대1과 같은 규칙입니다: 화면 쪽에서 좌우를 한 번 뒤집어 그리므로,
// 상태는 "내 시점의 좌우 반전"으로 만들어 보내고, 선수 순서는 [상대2, 상대1, 아군, 나]로 보냅니다(화면에서는 내 쪽이 0번).
class QuadSession {
  constructor(hub, room, conns, chars, nicks) {
    this.hub = hub; this.room = room; this.c = conns; this.N = 4; this.nk = nicks || ['', '', '', ''];
    this.game = new eng.Game(null, null, 'normal', pickMap(), chars); this.game.remote = true;
    const z = () => [0, 0, 0, 0]; this.inp = [0, 1, 2, 3].map(() => ({ mx: 0, my: 0, h: 0 })); this.lastQ = z(); this.ackQ = z(); this.rx = [1, 2, 3, 4].map(() => Date.now()); this.rm = z(); this.rmc = [null, null, null, null];
    this.gaps = []; this.bid = 0; this.fid = 0; this.eid = 0; this.evBuf = []; this.n = 0; this.acc = 0; this.last = performance.now(); this.sent = 0;
    conns.forEach((c, k) => { c.sess = { s: this, k }; c.ackN = 0; });
    this.timer = setInterval(() => this.tick(), 8);
  }
  input(k, i) {
    const g = this.game; this.rx[k] = Date.now();
    const mx = Math.max(-1, Math.min(1, +i.mx || 0)), my = Math.max(-1, Math.min(1, +i.my || 0)), A = k < 2;      // 왼쪽 팀 사람의 화면은 반전돼 있으므로 좌우를 되돌림
    this.inp[k] = { mx: A ? -mx : mx, my, h: i.h ? 1 : 0 };
    for (const q of Array.isArray(i.q) ? i.q.slice(-8) : []) {
      if (!Array.isArray(q) || !(q[0] > this.lastQ[k])) continue; this.lastQ[k] = q[0];
      if (q[1] === 'd') g.pressDashP(k, typeof q[2] === 'number' ? (A ? -q[2] : q[2]) : 0, +q[3] || 0); else if (q[1] === 'a') g.pressAttackP(k, typeof q[2] === 'number' ? (A ? Math.PI - q[2] : q[2]) : undefined);
      else if (q[1] === 's') g.pressSkillP(k, q[2] | 0, typeof q[3] === 'number' ? (A ? Math.PI - q[3] : q[3]) : undefined);
    }
  }
  stat() { const g = this.gaps; if (g.length < 5) return null; let sum = 0, mx = 0; for (const x of g) { sum += x[1]; if (x[1] > mx) mx = x[1]; } return [Math.round(sum / g.length), Math.round(mx)]; }
  wantRematch(k, ch) {
    this.rm[k] = 1; if (eng.CHAR_ORDER.includes(ch)) this.rmc[k] = ch;
    if (this.rm.every(x => x) && this.game.ph === 'over') {
      const P = this.game.players, chars = P.map((p, i) => this.rmc[i] || cid(p.ch));
      if (chars.some((x, i) => x !== cid(P[i].ch))) { this.game = new eng.Game(null, null, 'normal', pickMap(), chars); this.game.remote = true; } else { this.game.setMap(pickMap()); this.game.startMatch(); }
      this.rm = [0, 0, 0, 0]; this.rmc = [null, null, null, null]; this.evBuf = [];
    }
  }
  tick() {
    const now = performance.now(), g = this.game;
    let dt = (now - this.last) / 1000; if (!(dt > 0)) dt = 0.008;
    this.acc = Math.min(0.25, this.acc + Math.min(0.1, dt)); this.last = now;
    while (this.acc >= STEP) {
      for (let k = 0; k < 4; k++) { const stale = Date.now() - this.rx[k] > 1500, p = g.players[k]; p.inp = stale ? { mx: 0, my: 0 } : { mx: this.inp[k].mx, my: this.inp[k].my }; p.atkHold = stale ? false : !!this.inp[k].h; }
      g.update(STEP); this.acc -= STEP; this.ackQ = this.lastQ.slice();
      for (const e of g.ev) if (e.k === 'hit') this.evBuf.push({ t: now, a: [++this.eid, 'h', r1(e.x), r1(e.y), e.d, e.to] }); else if (e.k === 'text') this.evBuf.push({ t: now, a: [++this.eid, 't', r1(e.x), r1(e.y), e.txt, e.col] }); else if (e.k === 'swap') this.evBuf.push({ t: now, a: [++this.eid, 'w', e.p] });
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
      p.charge ? [r2(p.charge.dx), r2(p.charge.dy)] : 0, r2(p.atkCd), r2(p.dashCd), r2(p.skCd[0]), r2(p.skCd[1]), r2(p.skCd[2]), r2(p.slowMul), p.dashN | 0, r2(Math.max(0, p.stl)), p.emp ? 1 : 0, p.cnt ? r2(p.cnt.t) : 0, p.rage ? 1 : 0, p.hits | 0, p.adv ? 1 : 0]);
    const bl = g.bullets.slice(0, 30).map(b => [b._i || (b._i = ++this.bid), r1(b.x), r1(b.y), r1(b.vx), r1(b.vy), b.r, b.owner, b.col || 0, b.pierce ? 1 : 0]);
    const fl = g.fx.slice(0, 14).map(f => { if (!f._i) f._i = ++this.fid; const o = { i: f._i, k: f.k, x: r1(f.x), y: r1(f.y), l: r2(f.life), m: r2(f.max), c: f.col }; if (f.a != null) o.a = r2(f.a); if (f.r != null) o.r = r1(f.r); if (f.len != null) { o.len = r1(f.len); o.w = r1(f.w); } if (f.arc != null) o.arc = r2(f.arc); if (f.follow != null) o.f = f.follow; if (f.fist) o.fi = 1; return o; });
    const mn = g.minions.slice(0, 14).map(m => [m.id, r1(m.x), r1(m.y), r1(m.vx), r1(m.vy), r1(m.hp), m.kind === 'orb' ? 1 : 0, m.owner, r2(m.aim), m.fire ? 1 : 0, m.maxHp, m.r, m.guard > 0 ? 1 : 0]);
    const pw = g.pw.map(w => [r1(w.cx), r1(w.cy), Math.round(w.a * 1000) / 1000, w.fw, w.fh, w.own, r2(w.t), w.max]);
    const base = { n: ++this.n, ph: g.ph, tm: r2(g.timer), ft: r2(g.fightT), rd: g.round, mp: g.mapId, es: g.ess ? [g.ess.up ? 1 : 0, r2(g.ess.t)] : 0, q: 1 };
    const ev = this.evBuf.slice(-14).map(x => x.a), res = g.res ? g.res.w : null;
    const S = [0, 1, 2, 3].map(v => {
      const T = P[v].team, ally = P.findIndex((p, i) => i !== v && p.team === T), foes = P.map((p, i) => i).filter(i => P[i].team !== T);
      const order = [foes[1], foes[0], ally, v], pos = []; order.forEach((slot, j) => { pos[slot] = j; });      // 서버 번호 → 이 사람에게 보내는 번호
      const fx = T === 0, X = x => (fx ? r1(W - x) : x);      // 왼쪽 팀 사람에게는 좌우를 한 번 뒤집어 보냄(화면이 다시 뒤집어 그림)
      const mp = d => { const o = d.slice(); if (fx) { o[0] = r1(W - d[0]); o[2] = r1(-d[2]); o[4] = r2(Math.PI - d[4]); if (d[16]) o[16] = [r2(-d[16][0]), d[16][1]]; } return o; };
      const mine = t => (t < 0 ? t : (t === T ? 1 : 0));
      return Object.assign({}, base, {
        mm: fx ? 1 : 0, a: this.ackQ[v], sc: [g.score[1 - T], g.score[T]], rs: res == null ? null : mine(res), mw: mine(g.matchWinner), ch: order.map(i => cid(P[i].ch)), nk: order.map(i => this.nk[i]),
        p: order.map(i => mp(pl[i])),
        b: bl.map(b => [b[0], X(b[1]), b[2], fx ? r1(-b[3]) : b[3], b[4], b[5], pos[b[6]], b[7], b[8]]),
        f: fl.map(f => { const o = Object.assign({}, f, { x: X(f.x) }); if (fx && f.a != null) o.a = r2(Math.PI - f.a); if (f.f != null && f.f >= 0) o.f = pos[f.f]; return o; }),
        e: ev.map(e => (e[1] === 'w' ? [e[0], 'w', pos[e[2]]] : e[1] === 'h' ? [e[0], 'h', X(e[2]), e[3], e[4], pos[e[5]]] : [e[0], 't', X(e[2]), e[3], e[4], e[5]])),
        mn: mn.map(m => { const o = m.slice(); o[1] = X(m[1]); if (fx) { o[3] = r1(-m[3]); o[8] = r2(Math.PI - m[8]); } o[7] = pos[m[7]]; return o; }),
        pw: pw.map(w => [X(w[0]), w[1], fx ? Math.round((Math.PI - w[2]) * 1000) / 1000 : w[2], w[3], w[4], pos[w[5]], w[6], w[7]]),
      });
    });
    const go = () => {
      for (let k = 0; k < 4; k++) { const c = this.c[k], lag = this.n - (c.ackN || 0); if (lag > 48 && this.n % (lag > 150 ? 30 : 8) !== 0) continue; c.send({ t: 'snap', s: S[k] }); }
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
    if ((m.size >= MAX_PEERS_PER_ROOM || (name.slice(0, 2) === 'q-' && m.size >= 4)) && name !== '') { c.send({ t: 'err', room: name, code: 'room_full' }); return; }
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
  checkQuad(room) {      // 2대2 방: 4명이 모두 같은 버전·캐릭터를 고르면 시작 (들어온 순서대로 0·1번 왼쪽 팀, 2·3번 오른쪽 팀)
    const m = this.rooms.get(room); if (!m || m.size !== 4) return;
    const L = [...m.entries()]; if (!L.every(([c, p]) => p && p.r === 'q' && eng.CHAR_ORDER.includes(p.c))) return;
    let bad = false;
    for (const [c, p] of L) if (p.v !== SERVER_BUILD) { bad = true; if (!c.verrAt || Date.now() - c.verrAt > 3000) { c.verrAt = Date.now(); c.send({ t: 'verr', v: SERVER_BUILD }); } }
    if (bad) return;
    this.sessions.set(room, new QuadSession(this, room, L.map(x => x[0]), L.map(x => x[1].c), L.map(x => nickOf(x[1]))));
  }
  checkSession(room) {
    if (room.slice(0, 2) === 'q-') { if (!this.sessions.has(room)) this.checkQuad(room); return; }
    if (this.sessions.has(room) || room.slice(0, 2) !== 'g-') return;
    const m = this.rooms.get(room); if (!m) return;
    let hh = null, gg = null;
    for (const [c, p] of m) { if (p && p.r === 'h') hh = [c, p]; else if (p && p.r === 'g') gg = [c, p]; }
    if (!hh || !gg) return;
    let bad = false;
    for (const [c, p] of [hh, gg]) if (p.v !== SERVER_BUILD) { bad = true; if (!c.verrAt || Date.now() - c.verrAt > 3000) { c.verrAt = Date.now(); c.send({ t: 'verr', v: SERVER_BUILD }); } }
    if (bad || !eng.CHAR_ORDER.includes(hh[1].c) || !eng.CHAR_ORDER.includes(gg[1].c)) return;
    this.sessions.set(room, new Session(this, room, hh[0], gg[0], hh[1].c, gg[1].c, nickOf(hh[1]), nickOf(gg[1])));
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
