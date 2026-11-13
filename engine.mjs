// 자동 생성 파일입니다. 직접 고치지 말고 index.html을 고친 뒤 `node tools/build.mjs`를 실행하세요.
// ===== ENGINE START =====
const W = 960, H = 540, R = 20;
const WIN = 3, COUNT_TIME = 3, ROUNDEND_TIME = 2.8, OT_START = 40;   // 전투 40초가 지나면 서든데스: 모든 피해 2배
const OT_DMG_MUL = 2;
const DASH = { cd: 5, time: 0.28, speed: 640 };   // 대시: 사용 중 무적, 쿨타임 5초
const ATK_BUFFER = 0.3;                            // 공격 버튼을 톡 눌렀을 때, 쿨타임이 끝날 때까지 기다려 주는 시간
const WALLS = [
  { x: 450, y: 200, w: 60, h: 140 },
  { x: 250, y: 90, w: 50, h: 50 }, { x: 250, y: 400, w: 50, h: 50 },
  { x: 660, y: 90, w: 50, h: 50 }, { x: 660, y: 400, w: 50, h: 50 },
];
const SPAWN = [{ x: 90, y: 270 }, { x: 870, y: 270 }];

// ─────────────────────────────────────────────────────────────
// 캐릭터 정의. 체력/속도/기본공격/스킬은 이 표만 고치면 돼요. (전사는 확정값, 나머지는 임시값)
//  atk  : 기본공격. melee(근접) 또는 ranged(원거리). 공격 버튼을 누르면 나가고, 꾹 누르면 사거리 안에서 자동 반복
//  keep : AI가 유지하려는 거리
//  skills[].fx : 효과 목록. 종류 → proj(투사체) aoe(주변 범위) cone(부채꼴) line(직선 범위) shield(보호막) blink(순간이동) charge(돌진) buff(가속/체력)
//  skills[].ai : AI 사용 힌트. attack / defend / escape / block / gapclose
// ─────────────────────────────────────────────────────────────
const CHARS = {
  tank: { id: 'tank', name: '탱커', icon: '🛡️', atkIcon: '👊', color: '#5b8def', role: '근접 · 단단한 방어', hp: 140, speed: 190, keep: 64,
    atk: { type: 'melee', dmg: 8, cd: 0.8, range: 68, arc: 2.4 },
    skills: [
      { name: '방패', icon: '🛡️', desc: '3초간 내구도 30의 방패(체력 아래 파란 바)', cd: 8, ai: { use: 'defend' }, fx: [{ t: 'shield', amount: 30, dur: 3 }] },
      { name: '돌진', icon: '🐗', desc: '돌진 경로와 도착 지점 원형 범위의 적에게 12 피해(1회), 끝까지 돌진하면 원형 범위 기절 0.8초', cd: 9, ai: { use: 'attack', maxD: 300, minD: 90 }, fx: [{ t: 'charge', dist: 260, speed: 640, w: 64, dmg: 12, endR: 100, endStun: 0.8, col: '#5b8def' }] },
      { name: '대지 강타', icon: '💥', desc: '주변 20 피해 + 2초간 50% 둔화', cd: 6, ai: { use: 'attack', maxD: 120 }, fx: [{ t: 'aoe', radius: 132, dmg: 20, slowT: 2, slowMul: 0.5, col: '#ffb347' }] },
    ] },
  warrior: { id: 'warrior', name: '전사', icon: '⚔️', atkIcon: '⚔️', color: '#ff8a4a', role: '근접 · 높은 공격력', hp: 110, speed: 220, keep: 64,
    atk: { type: 'melee', dmg: 10, cd: 0.6, range: 72, arc: 2.2 },
    skills: [
      { name: '강타', icon: '🗡️', desc: '직선 범위가 보이고 0.2초 뒤 25 피해', cd: 5, ai: { use: 'attack', maxD: 195 }, fx: [{ t: 'line', len: 215, w: 68, dmg: 25, delay: 0.2, col: '#ff8a4a' }] },
      { name: '전사의 함성', icon: '📣', desc: '3초간 받는 피해 30% 감소, 최대 체력 +10(그 라운드 동안)', cd: 15, ai: { use: 'attack', maxD: 200 }, fx: [{ t: 'buff', dr: 0.3, dur: 3, maxHp: 10, col: '#ffd24a' }] },
      { name: '가로베기', icon: '🌙', desc: '0.6초간 120° 부채꼴로 투사체를 막고, 끝나면 범위 안의 적에게 15 피해', cd: 10, ai: { use: 'block', maxD: 125 }, fx: [{ t: 'cone', range: 128, arc: 2.094, dmg: 15, guard: 0.6, col: '#ff8a4a' }] },
    ] },
  archer: { id: 'archer', name: '궁수', icon: '🏹', atkIcon: '🏹', color: '#6be08a', role: '원거리 · 빠른 연사', hp: 90, speed: 235, keep: 300,
    atk: { type: 'ranged', dmg: 8, cd: 0.55, range: 560, speed: 620, r: 5 },
    skills: [
      { name: '삼연사', icon: '🎯', desc: '화살 3발 부채꼴 발사', cd: 6, proj: 1, ai: { use: 'attack', maxD: 450 }, fx: [{ t: 'proj', n: 3, spread: 0.22, dmg: 9, speed: 640, r: 5 }] },
      { name: '후퇴 사격', icon: '↩️', desc: '뒤로 물러나며 화살 발사, 맞으면 2초간 둔화', cd: 10, proj: 1, ai: { use: 'escape', minD: 150 }, fx: [{ t: 'blink', dist: 150, dir: 'away' }, { t: 'proj', dmg: 14, speed: 700, r: 10, slowT: 2, slowMul: 0.6 }] },
      { name: '관통 화살', icon: '➳', desc: '적과 벽을 꿰뚫는 강한 화살', cd: 8, proj: 1, ai: { use: 'attack', maxD: 520 }, fx: [{ t: 'proj', dmg: 30, speed: 950, r: 8, pierce: true, life: 1.0, col: '#4cff7a' }] },
    ] },
  mage: { id: 'mage', name: '마법사', icon: '🔮', atkIcon: '🔮', color: '#c36bff', role: '원거리 · 범위 마법', hp: 95, speed: 225, keep: 280,
    atk: { type: 'ranged', dmg: 11, cd: 0.7, range: 520, speed: 540, r: 8 },
    skills: [
      { name: '화염구', icon: '🔥', desc: '직격 30 피해, 직격하지 못하고 터지면 범위 20 피해', cd: 5, proj: 1, ai: { use: 'attack', maxD: 480 }, fx: [{ t: 'proj', dmg: 30, aoeDmg: 20, speed: 540, r: 14, aoe: 96, life: 1.4, col: '#ff8a4a' }] },
      { name: '빙결', icon: '❄️', desc: '맞으면 2초간 둔화', cd: 8, proj: 1, ai: { use: 'attack', maxD: 480 }, fx: [{ t: 'proj', dmg: 10, speed: 720, r: 15, life: 1.1, slowT: 2, slowMul: 0.5, col: '#8fd8ff' }] },
      { name: '순간이동', icon: '✨', desc: '드래그한 방향(탭하면 이동 방향, 없으면 뒤)으로 순간이동', cd: 10, ai: { use: 'escape', minD: 130 }, fx: [{ t: 'blink', dist: 220, dir: 'move' }] },
    ] },
};
const CHAR_ORDER = ['tank', 'warrior', 'archer', 'mage'];
// 방향을 정해서 쓰는 스킬인지(드래그 조준 가능) 자동 판별
for (const id of CHAR_ORDER) for (const s of CHARS[id].skills) s.aimed = s.fx.some(f => ['proj', 'cone', 'line', 'charge', 'blink'].includes(f.t));

const DIFFS = {
  easy:   { name: '쉬움',   react: 0.34, dodge: 0.10, skillP: 0.30 },
  normal: { name: '보통',   react: 0.20, dodge: 0.40, skillP: 0.60 },
  hard:   { name: '어려움', react: 0.10, dodge: 0.80, skillP: 0.92 },
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function normAng(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function resolveCircleRect(o, r, w) {
  const cx = clamp(o.x, w.x, w.x + w.w), cy = clamp(o.y, w.y, w.y + w.h);
  let dx = o.x - cx, dy = o.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return false;
  if (d2 > 1e-6) { const d = Math.sqrt(d2); dx /= d; dy /= d; o.x = cx + dx * r; o.y = cy + dy * r; return true; }
  const l = o.x - w.x, rr = w.x + w.w - o.x, t = o.y - w.y, b = w.y + w.h - o.y, m = Math.min(l, rr, t, b);
  if (m === l) o.x = w.x - r; else if (m === rr) o.x = w.x + w.w + r; else if (m === t) o.y = w.y - r; else o.y = w.y + w.h + r;
  return true;
}
const freshWant = () => ({ dash: 0, sk: [0, 0, 0], angs: [null, null, null] });

function mkPlayer(idx, charId) {
  const ch = CHARS[charId];
  return { idx, ch, x: 0, y: 0, vx: 0, vy: 0, aim: 0, hp: ch.hp, maxHp: ch.hp, alive: true, atkCd: 0, skCd: [0, 0, 0],
    dashCd: 0, dashT: 0, dx: 1, dy: 0, inv: 0, stun: 0, slowT: 0, slowMul: 1, shield: 0, shieldMax: 0, shieldT: 0, dr: 0, drT: 0, haste: 0, hasteMul: 1, charge: null, guard: null,
    atkHold: false, atkBuf: 0,
    inp: { mx: 0, my: 0 }, want: freshWant(),
    think: 0, strafe: 1, strafeT: 0, stuckT: 0, lx: 0, ly: 0, unstick: 0, unstickAng: 0 };
}

class Game {
  constructor(myChar, aiChar, diffKey) {
    this.diff = DIFFS[diffKey] || DIFFS.normal;
    this.players = [mkPlayer(0, myChar), mkPlayer(1, aiChar)];
    this.auto0 = false;       // true면 0번(사람 자리)도 AI가 조작 (테스트용)
    this.remote = false;      // true면 1번도 사람(온라인 상대)이 조작: AI를 쓰지 않음
    this.ev = []; this.fx = []; this.bullets = []; this.zones = [];
    this.startMatch();
  }
  startMatch() {
    this.score = [0, 0]; this.round = 1; this.matchWinner = -1;
    for (const p of this.players) p.maxHp = p.ch.hp;     // 영구 체력 증가는 한 판(매치) 동안만 유지
    this.startRound();
  }
  startRound() {
    for (const p of this.players) {
      p.x = SPAWN[p.idx].x; p.y = SPAWN[p.idx].y; p.vx = p.vy = 0; p.aim = p.idx === 0 ? 0 : Math.PI;
      p.maxHp = p.ch.hp; p.hp = p.maxHp; p.alive = true; p.atkCd = 0.5;      // 함성 등으로 늘어난 최대 체력은 라운드가 끝나면 초기화
      p.atkBuf = 0; p.skCd = [0, 0, 0]; p.dashCd = 0; p.dashT = 0; p.inv = 0; p.stun = 0;
      p.slowT = 0; p.shield = 0; p.shieldT = 0; p.dr = 0; p.drT = 0; p.haste = 0; p.charge = null; p.guard = null; p.inp = { mx: 0, my: 0 }; p.want = freshWant();
      p.think = 0.4; p.stuckT = 0; p.lx = p.x; p.ly = p.y; p.unstick = 0;
    }
    this.bullets = []; this.fx = []; this.zones = []; this.fightT = 0; this.res = null; this.ph = 'count'; this.timer = COUNT_TIME;
  }
  setMove(mx, my) { this.players[0].inp = { mx, my }; }
  pressDash() { this.pressDashP(0); }
  pressSkill(i, ang) { this.pressSkillP(0, i, ang); }
  pressAttack() { this.pressAttackP(0); }
  // 플레이어 번호를 지정하는 입력 (온라인 대전에서 1번 입력용)
  pressDashP(k) { if (this.ph === 'fight') this.players[k].want.dash = 1; }
  pressSkillP(k, i, ang) { if (this.ph === 'fight' && i >= 0 && i < 3) { const w = this.players[k].want; w.sk[i] = 1; w.angs[i] = typeof ang === 'number' ? ang : null; } }
  pressAttackP(k) { if (this.ph === 'fight') this.players[k].atkBuf = ATK_BUFFER; }

  update(dt) {
    for (const f of this.fx) f.life -= dt;
    this.fx = this.fx.filter(f => f.life > 0);
    if (this.ph === 'count') {
      this.timer -= dt;
      for (const p of this.players) { const e = this.players[1 - p.idx]; p.aim = Math.atan2(e.y - p.y, e.x - p.x); }
      if (this.timer <= 0) { this.ph = 'fight'; this.fightT = 0; }
    } else if (this.ph === 'fight') { this.fightT += dt; this.stepFight(dt); }
    else if (this.ph === 'end') {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.score.some(s => s >= WIN)) { this.ph = 'over'; this.matchWinner = this.score[0] >= WIN ? 0 : 1; }
        else { this.round++; this.startRound(); }
      }
    }
  }

  clear(x1, y1, x2, y2) {
    const d = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.ceil(d / 10));
    for (let i = 1; i < n; i++) {
      const x = x1 + (x2 - x1) * i / n, y = y1 + (y2 - y1) * i / n;
      for (const w of WALLS) if (x > w.x - 6 && x < w.x + w.w + 6 && y > w.y - 6 && y < w.y + w.h + 6) return false;
    }
    return true;
  }

  dealDamage(src, t, dmg, o) {
    if (!t.alive || t.dashT > 0 || t.inv > 0) return false;
    let a = dmg * (this.fightT > OT_START ? OT_DMG_MUL : 1);   // 서든데스 규칙: 모든 데미지 2배
    if (t.drT > 0) a *= 1 - t.dr;      // 받는 피해 감소 버프(전사의 함성)
    if (t.shieldT > 0 && t.shield > 0) { const ab = Math.min(t.shield, a); t.shield -= ab; a -= ab; }
    t.hp -= a;
    if (o && o.stun) { t.stun = Math.max(t.stun, o.stun); t.charge = null; }
    if (o && o.slowT) { t.slowT = Math.max(t.slowT, o.slowT); t.slowMul = o.slowMul || 0.5; }
    this.ev.push({ k: 'hit', x: t.x, y: t.y - 8, d: Math.round(dmg * (this.fightT > OT_START ? OT_DMG_MUL : 1) * (t.drT > 0 ? 1 - t.dr : 1)), to: t.idx });
    return true;
  }

  fireProj(p, f, ang) {
    const base = typeof ang === 'number' ? ang : p.aim;
    const n = f.n || 1, sp = f.spread || 0;
    for (let k = 0; k < n; k++) {
      const a = base + (k - (n - 1) / 2) * sp;
      this.bullets.push({ x: p.x + Math.cos(a) * (R + 4), y: p.y + Math.sin(a) * (R + 4), vx: Math.cos(a) * f.speed, vy: Math.sin(a) * f.speed,
        r: f.r || 5, dmg: f.dmg, owner: p.idx, pierce: !!f.pierce, aoe: f.aoe || 0, aoeDmg: f.aoeDmg, stun: f.stun || 0, slowT: f.slowT || 0, slowMul: f.slowMul || 1,
        life: f.life || 1.4, col: f.col || null, hit: false });
    }
  }
  explode(b, noDmg) {      // noDmg: 직격으로 이미 피해를 줬을 때는 폭발 효과만(피해 2번 방지)
    this.fx.push({ k: 'ring', x: b.x, y: b.y, r: b.aoe, life: 0.3, max: 0.3, col: b.col || '#ff8a4a' });
    const e = this.players[1 - b.owner];
    if (!noDmg && e.alive && Math.hypot(e.x - b.x, e.y - b.y) <= b.aoe + R) this.dealDamage(this.players[b.owner], e, b.aoeDmg != null ? b.aoeDmg : b.dmg, b);
  }
  chargeEnd(p, c) {      // 끝까지 돌진하면 도착 지점에서 원형 범위 기절
    if (!c.endR) return;
    this.fx.push({ k: 'ring', x: p.x, y: p.y, r: c.endR, life: 0.4, max: 0.4, col: c.col || '#5b8def' });
    const e = this.players[1 - p.idx];
    if (e.alive && e.dashT <= 0 && e.inv <= 0 && Math.hypot(e.x - p.x, e.y - p.y) <= c.endR + R) {
      if (!c.hit) this.dealDamage(p, e, c.dmg, Object.assign({}, c, { stun: 0 }));      // 경로에서 안 맞았다면 원 안에서 12 피해 (한 번만)
      if (!e.alive) return;
      e.stun = Math.max(e.stun, c.endStun); e.charge = null; this.ev.push({ k: 'text', x: e.x, y: e.y - 30, txt: '기절!', col: '#ffd24a' }); }
  }
  coneHit(p, range, arc, dmg, o, ang) {
    const A = typeof ang === 'number' ? ang : p.aim, e = this.players[1 - p.idx], life = (o && o.guard) || 0.2;
    this.fx.push({ k: 'cone', x: p.x, y: p.y, a: A, arc, r: range, life, max: life, col: (o && o.col) || '#e8edf7', follow: o && o.guard ? p.idx : -1 });
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d <= range + R && Math.abs(normAng(Math.atan2(e.y - p.y, e.x - p.x) - A)) <= arc / 2) this.dealDamage(p, e, dmg, o);
  }
  lineArea(src, x, y, A, len, width, dmg, o) {      // 고정 위치의 직선 범위를 지금 판정
    const e = this.players[1 - src.idx];
    this.fx.push({ k: 'line', x, y, a: A, len, w: width, life: 0.25, max: 0.25, col: (o && o.col) || '#e8edf7' });
    const ex = e.x - x, ey = e.y - y, c = Math.cos(A), s = Math.sin(A);
    const along = ex * c + ey * s, perp = Math.abs(-ex * s + ey * c);
    if (along >= -R && along <= len + R && perp <= width / 2 + R) this.dealDamage(src, e, dmg, o);
  }
  lineHit(p, len, width, dmg, o, ang) { this.lineArea(p, p.x, p.y, typeof ang === 'number' ? ang : p.aim, len, width, dmg, o); }
  stepZones(dt) {      // 선딜이 있는 범위 스킬: 범위가 먼저 보이고, 시간이 지나면 그 자리에서 판정(그 사이 벗어나거나 대시로 피하면 안 맞음)
    for (const z of this.zones) {
      z.t -= dt;
      if (z.t <= 0) { z.done = true; this.lineArea(this.players[z.owner], z.x, z.y, z.a, z.len, z.w, z.dmg, z.o); }
    }
    this.zones = this.zones.filter(z => !z.done);
  }
  useSkill(p, i, angArg) {
    const sk = p.ch.skills[i], aimed = typeof angArg === 'number', ang = aimed ? angArg : p.aim;
    p.skCd[i] = sk.cd;                 // 시전하자마자 쿨타임이 돌기 시작
    this.ev.push({ k: 'skill', p: p.idx, i });
    const e = this.players[1 - p.idx];
    for (const f of sk.fx) {
      if (f.t === 'proj') this.fireProj(p, f, ang);
      else if (f.t === 'aoe') {
        this.fx.push({ k: 'ring', x: p.x, y: p.y, r: f.radius, life: 0.3, max: 0.3, col: f.col || '#ffffff' });
        if (Math.hypot(e.x - p.x, e.y - p.y) <= f.radius + R) this.dealDamage(p, e, f.dmg, f);
      } else if (f.t === 'cone') {
        if (f.guard) {      // 막기 먼저, 피해는 막기가 끝난 뒤(stepPlayer)에 범위 안의 적에게
          this.fx.push({ k: 'cone', x: p.x, y: p.y, a: ang, arc: f.arc, r: f.range, life: f.guard, max: f.guard, col: f.col || '#e8edf7', follow: p.idx });
          p.guard = { a: ang, arc: f.arc, r: f.range, t: f.guard, dmg: f.dmg, o: f };
        } else this.coneHit(p, f.range, f.arc, f.dmg, f, ang);
      } else if (f.t === 'line') {
        if (f.delay) {
          this.zones.push({ owner: p.idx, x: p.x, y: p.y, a: ang, len: f.len, w: f.w, dmg: f.dmg, o: f, t: f.delay });
          this.fx.push({ k: 'tele', x: p.x, y: p.y, a: ang, len: f.len, w: f.w, life: f.delay, max: f.delay, col: f.col || '#ff8a4a' });
        } else this.lineHit(p, f.len, f.w, f.dmg, f, ang);
      }
      else if (f.t === 'shield') { p.shield = f.amount; p.shieldMax = f.amount; p.shieldT = f.dur; }
      else if (f.t === 'buff') {
        if (f.haste) { p.haste = f.dur; p.hasteMul = f.haste; }
        if (f.dr) { p.dr = f.dr; p.drT = f.dur; }
        if (f.maxHp) { p.maxHp += f.maxHp; p.hp += f.maxHp; this.ev.push({ k: 'text', x: p.x, y: p.y - 30, txt: '최대 체력 +' + f.maxHp, col: '#ffd24a' }); }
        this.fx.push({ k: 'ring', x: p.x, y: p.y, r: 60, life: 0.4, max: 0.4, col: f.col || '#ffd24a' });
      } else if (f.t === 'charge') {
        p.charge = { dx: Math.cos(ang), dy: Math.sin(ang), speed: f.speed, left: f.dist / f.speed, dmg: f.dmg, stun: f.stun || 0, w: f.w || 52, endR: f.endR || 0, endStun: f.endStun || 0, hit: false, col: f.col };
        const T = f.dist / f.speed + 0.1;      // 돌진하는 동안 경로(사각)와 도착 원을 모두에게 보여줌
        this.fx.push({ k: 'tele', x: p.x, y: p.y, a: ang, len: f.dist, w: f.w || 52, life: T, max: T, col: f.col || '#5b8def' });
        if (f.endR) this.fx.push({ k: 'teleC', x: p.x + Math.cos(ang) * f.dist, y: p.y + Math.sin(ang) * f.dist, r: f.endR, life: T, max: T, col: f.col || '#5b8def' });
      }
      else if (f.t === 'blink') {
        let dx, dy; const m = Math.hypot(p.inp.mx, p.inp.my);
        if (aimed) { const sgn = f.dir === 'away' ? -1 : 1; dx = Math.cos(ang) * sgn; dy = Math.sin(ang) * sgn; }
        else if (f.dir === 'toward') { dx = Math.cos(p.aim); dy = Math.sin(p.aim); }
        else if (f.dir === 'move' && m > 0.2) { dx = p.inp.mx / m; dy = p.inp.my / m; }
        else { dx = -Math.cos(p.aim); dy = -Math.sin(p.aim); }
        this.fx.push({ k: 'ring', x: p.x, y: p.y, r: 30, life: 0.25, max: 0.25, col: p.ch.color });
        p.x = clamp(p.x + dx * f.dist, R, W - R); p.y = clamp(p.y + dy * f.dist, R, H - R);
        for (const w of WALLS) resolveCircleRect(p, R, w);
        p.x = clamp(p.x, R, W - R); p.y = clamp(p.y, R, H - R);
        this.fx.push({ k: 'ring', x: p.x, y: p.y, r: 30, life: 0.25, max: 0.25, col: p.ch.color });
      }
    }
  }
  basicAttack(p) {
    const a = p.ch.atk;
    if (a.type === 'melee') this.coneHit(p, a.range, a.arc, a.dmg, null);
    else this.fireProj(p, { dmg: a.dmg, speed: a.speed, r: a.r });
    p.atkCd = a.cd;
  }

  stepPlayer(p, dt) {
    const e = this.players[1 - p.idx];
    p.atkCd -= dt; p.dashCd -= dt; p.inv -= dt;
    if (p.atkBuf > 0) p.atkBuf -= dt;
    for (let i = 0; i < 3; i++) p.skCd[i] = Math.max(0, p.skCd[i] - dt);
    if (p.stun > 0) p.stun -= dt;
    if (p.slowT > 0) p.slowT -= dt;
    if (p.haste > 0) p.haste -= dt;
    if (p.drT > 0) p.drT -= dt;
    if (p.guard) {
      p.guard.t -= dt;
      if (p.guard.t <= 0) {
        const g = p.guard; p.guard = null;
        if (p.alive) this.coneHit(p, g.r, g.arc, g.dmg, Object.assign({}, g.o, { guard: 0 }), g.a);   // 막기가 끝난 뒤, 범위 안에 있으면 피해
      }
    }
    if (p.shieldT > 0) { p.shieldT -= dt; if (p.shieldT <= 0) p.shield = 0; }
    if (p.alive && !p.charge) p.aim = Math.atan2(e.y - p.y, e.x - p.x);

    if (p.alive && p.stun <= 0 && !p.charge && p.dashT <= 0) {
      if (p.want.dash && p.dashCd <= 0) {
        const m = Math.hypot(p.inp.mx, p.inp.my);
        if (m > 0.2) { p.dx = p.inp.mx / m; p.dy = p.inp.my / m; } else { p.dx = -Math.cos(p.aim); p.dy = -Math.sin(p.aim); }
        p.dashT = DASH.time; p.dashCd = DASH.cd;
        this.ev.push({ k: 'dash', p: p.idx });
        this.fx.push({ k: 'ring', x: p.x, y: p.y, r: 28, life: 0.25, max: 0.25, col: '#6be08a' });
      } else {
        for (let i = 0; i < 3; i++) if (p.want.sk[i] && p.skCd[i] <= 0) { this.useSkill(p, i, p.want.angs[i]); break; }
      }
    }
    p.want = freshWant();

    let vx = 0, vy = 0;
    if (!p.alive) { /* 정지 */ }
    else if (p.charge) { const c = p.charge; vx = c.dx * c.speed; vy = c.dy * c.speed; c.left -= dt; if (c.left <= 0) { p.charge = null; this.chargeEnd(p, c); } }
    else if (p.dashT > 0) { vx = p.dx * DASH.speed; vy = p.dy * DASH.speed; p.dashT -= dt; }
    else if (p.stun <= 0) {
      let mx = p.inp.mx, my = p.inp.my; const ml = Math.hypot(mx, my);
      if (ml > 1) { mx /= ml; my /= ml; }
      const sp = p.ch.speed * (p.slowT > 0 ? p.slowMul : 1) * (p.haste > 0 ? p.hasteMul : 1);
      vx = mx * sp; vy = my * sp;
    }
    p.vx = vx; p.vy = vy;
    p.x = clamp(p.x + vx * dt, R, W - R); p.y = clamp(p.y + vy * dt, R, H - R);
    for (const w of WALLS) resolveCircleRect(p, R, w);
    p.x = clamp(p.x, R, W - R); p.y = clamp(p.y, R, H - R);

    const dist = Math.hypot(e.x - p.x, e.y - p.y);
    if (p.charge && !p.charge.hit && dist < p.charge.w / 2 + R) {      // 경로상 적 12 피해      // 지나가며 부딪힌 적에게 1회 피해 (돌진은 계속)
      const c = p.charge; c.hit = true;
      this.fx.push({ k: 'ring', x: e.x, y: e.y, r: 45, life: 0.25, max: 0.25, col: '#ffffff' });
      this.dealDamage(p, e, c.dmg, c);
    }
    // 기본공격: 버튼을 톡 누르면 1회(사거리 상관없이), 꾹 누르면 사거리 안에서 자동 반복
    if (p.alive && p.stun <= 0 && !p.charge && p.dashT <= 0 && p.atkCd <= 0) {
      const a = p.ch.atk;
      const inRange = a.type === 'melee' ? dist <= a.range + R : (dist <= a.range && this.clear(p.x, p.y, e.x, e.y));
      if (p.atkBuf > 0 || (p.atkHold && inRange)) { this.basicAttack(p); p.atkBuf = 0; }
    }
  }

  ai(p, dt) {
    p.atkHold = true;
    const e = this.players[1 - p.idx], d = this.diff, inp = p.inp;
    p.think -= dt; p.strafeT -= dt; p.unstick -= dt; p.stuckT += dt;
    if (p.stuckT >= 0.6) {
      const moved = Math.hypot(p.x - p.lx, p.y - p.ly); p.lx = p.x; p.ly = p.y; p.stuckT = 0;
      if (moved < 25 && p.stun <= 0) { p.unstick = 0.6; p.unstickAng = Math.random() * 6.283; p.strafe *= -1; }
    }
    if (p.strafeT <= 0) { p.strafe = Math.random() < 0.5 ? -1 : 1; p.strafeT = 0.6 + Math.random() * 1.2; }
    if (p.think > 0) return;
    p.think = d.react;
    const dx = e.x - p.x, dy = e.y - p.y, dist = Math.hypot(dx, dy) || 1, ux = dx / dist, uy = dy / dist;
    const los = this.clear(p.x, p.y, e.x, e.y), keep = p.ch.keep, melee = p.ch.atk.type === 'melee';
    let ap = dist > keep + 30 ? 1 : dist < keep - 30 ? -1 : 0;
    if (!los) ap = Math.max(ap, 0.8);
    let mx, my;
    if (p.unstick > 0) { mx = Math.cos(p.unstickAng); my = Math.sin(p.unstickAng); }
    else { const sw = melee ? 0.35 : 0.8; mx = ux * ap - uy * p.strafe * sw; my = uy * ap + ux * p.strafe * sw; }
    let danger = false, dodged = false;
    for (const b of this.bullets) {
      if (b.owner === p.idx) continue;
      const rx = p.x - b.x, ry = p.y - b.y, rd = Math.hypot(rx, ry);
      if (rd > 170 || rd < 1) continue;
      const sp = Math.hypot(b.vx, b.vy) || 1;
      if ((b.vx * rx + b.vy * ry) / (sp * rd) > 0.85) {
        danger = true;
        const px = -b.vy / sp, py = b.vx / sp, side = (px * rx + py * ry) >= 0 ? 1 : -1;
        mx = px * side; my = py * side;
        if (p.dashCd <= 0 && Math.random() < d.dodge) { p.want.dash = 1; dodged = true; }
        break;
      }
    }
    p.inp = { mx, my };
    for (let i = 0; i < 3; i++) {
      const sk = p.ch.skills[i];
      if (dodged || p.skCd[i] > 0 || Math.random() > d.skillP) continue;
      const h = sk.ai || {}; let use = false;
      if (h.use === 'attack') use = dist <= h.maxD && dist >= (h.minD || 0) && (!sk.proj || los);
      else if (h.use === 'defend') use = danger || (p.hp < p.maxHp * 0.75 && dist < 260);
      else if (h.use === 'escape') use = dist < (h.minD || 110);
      else if (h.use === 'block') use = danger || dist <= h.maxD;
      else if (h.use === 'gapclose') use = dist >= (h.minD || 0) && dist <= (h.maxD || 9999);
      if (use) p.want.sk[i] = 1;
    }
  }

  stepFight(dt) {
    const P = this.players;
    if (!this.remote) this.ai(P[1], dt);
    if (this.auto0) this.ai(P[0], dt);
    this.stepZones(dt);
    for (const p of P) this.stepPlayer(p, dt);
    this.stepBullets(dt);
    for (const p of P) if (p.hp <= 0) p.alive = false;
    const a0 = P[0].alive, a1 = P[1].alive;
    if (!a0 || !a1) {
      let w = -1; if (a0 && !a1) w = 0; else if (a1 && !a0) w = 1;
      if (w >= 0) this.score[w]++;
      this.res = { w }; this.ph = 'end'; this.timer = ROUNDEND_TIME;
    }
  }

  stepBullets(dt) {
    for (const b of this.bullets) {
      b.life -= dt; let dead = false, boom = false;
      b.x += b.vx * dt; b.y += b.vy * dt;
      const t = this.players[1 - b.owner];
      if (b.life <= 0) { dead = true; boom = b.aoe > 0; }
      else if (b.x < b.r || b.x > W - b.r || b.y < b.r || b.y > H - b.r) { dead = true; boom = b.aoe > 0; }
      if (!dead && t.guard) {      // 가로베기 같은 막기: 부채꼴 안으로 들어온 투사체는 사라짐
        const gx = b.x - t.x, gy = b.y - t.y;
        if (Math.hypot(gx, gy) <= t.guard.r + b.r && Math.abs(normAng(Math.atan2(gy, gx) - t.guard.a)) <= t.guard.arc / 2) {
          dead = true; this.fx.push({ k: 'ring', x: b.x, y: b.y, r: 20, life: 0.2, max: 0.2, col: '#ffffff' });
        }
      }
      if (!dead && !b.pierce) for (const w of WALLS) if (resolveCircleRect(b, b.r, w)) { dead = true; boom = b.aoe > 0; break; }
      if (!dead) {
        if (t.alive && t.dashT <= 0 && t.inv <= 0 && !(b.pierce && b.hit)) {
          const dx = t.x - b.x, dy = t.y - b.y, rr = R + b.r;
          if (dx * dx + dy * dy < rr * rr) {
            this.dealDamage(this.players[b.owner], t, b.dmg, b); b.hit = true;      // 직격 피해
            if (b.aoe > 0) { dead = true; this.explode(b, true); }               // 폭발은 모양만, 추가 피해 없음
            else if (!b.pierce) dead = true;
          }
        }
      }
      if (boom) this.explode(b);
      if (dead) b.dead = true;
    }
    this.bullets = this.bullets.filter(b => !b.dead);
  }
}

export { Game, CHARS, CHAR_ORDER, W, H };
export const BUILD = 27;
