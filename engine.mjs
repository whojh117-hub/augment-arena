// 자동 생성 파일입니다. 직접 고치지 말고 index.html을 고친 뒤 `node tools/build.mjs`를 실행하세요.
// ===== ENGINE START =====
const W = 960, H = 540, R = 20;
const WIN = 3, COUNT_TIME = 3, ROUNDEND_TIME = 2.8, OT_START = 40;   // 전투 40초가 지나면 서든데스: 모든 피해 2배
const OT_DMG_MUL = 2;
const DASH = { cd: 5, time: 0.28, speed: 640 };   // 대시: 사용 중 무적, 쿨타임 5초
const STL_MUL = 1.2;                               // 은신 중 이동속도 배수
const ATK_BUFFER = 0.3;                            // 공격 버튼을 톡 눌렀을 때, 쿨타임이 끝날 때까지 기다려 주는 시간
// ─────────────────────────────────────────────────────────────
// 맵. walls: 벽 목록, fx: 라운드 시작 전에 보여 줄 추가 효과 설명. 1칸 = 70px 기준.
//  speedMul(이동속도 배수) / bolt(번개) / heat(고정 피해) / ess(정수) 가 있으면 그 효과가 켜짐
// ─────────────────────────────────────────────────────────────
const MAPS = {
  basic: { id: 'basic', name: '기본', icon: '🏟️', fx: '추가 효과 없음', bg: '#131923', grid: '#1b2331', wall: '#2b3447', line: '#4a5a78',
    walls: [{ x: 450, y: 200, w: 60, h: 140 }, { x: 250, y: 90, w: 50, h: 50 }, { x: 250, y: 400, w: 50, h: 50 }, { x: 660, y: 90, w: 50, h: 50 }, { x: 660, y: 400, w: 50, h: 50 }] },
  waste: { id: 'waste', name: '황무지', icon: '🏜️', fx: '날아오는 모래로 모든 플레이어 이동속도 20% 감소', speedMul: 0.8, bg: '#2a2218', grid: '#352b1d', wall: '#6b5638', line: '#9b7f52',
    walls: [{ x: 260, y: 110, w: 60, h: 60 }, { x: 640, y: 370, w: 60, h: 60 }, { x: 420, y: 330, w: 60, h: 60 }, { x: 480, y: 150, w: 60, h: 60 }] },      // 180도 돌려도 같은 모양(대각선 대칭)
  temple: { id: 'temple', name: '신전', icon: '🏛️', fx: '5초마다 번개가 떨어져요 (빨간 원 경고 1초 뒤 30 피해)', bolt: { first: 4, every: 5, warn: 1, r: 70, dmg: 30 }, bg: '#1a1a22', grid: '#242430', wall: '#4a4660', line: '#8f86b8',
    walls: [{ x: 375, y: 165, w: 70, h: 24 }, { x: 375, y: 165, w: 24, h: 70 }, { x: 515, y: 165, w: 70, h: 24 }, { x: 561, y: 165, w: 24, h: 70 },
            { x: 375, y: 351, w: 70, h: 24 }, { x: 375, y: 305, w: 24, h: 70 }, { x: 515, y: 351, w: 70, h: 24 }, { x: 561, y: 305, w: 24, h: 70 }] },      // 가운데 3x3칸 사각형의 네 모서리만 ㄱ·ㄴ자 벽(상하좌우 가운데는 열려 있음)
  hell: { id: 'hell', name: '지옥', icon: '🔥', fx: '뜨거운 공기로 1초마다 체력 1 고정 피해 · 가운데 정수: 체력 +10(25초마다 재생성)', heat: { every: 1, dmg: 1 }, ess: { first: 5, respawn: 25, heal: 10, r: 16 }, bg: '#220f0f', grid: '#2e1515', wall: '#5a2a24', line: '#c0553a',
    walls: [{ x: 170, y: 165, w: 70, h: 210 }, { x: 720, y: 165, w: 70, h: 210 }, { x: 400, y: 80, w: 50, h: 50 }, { x: 510, y: 80, w: 50, h: 50 }, { x: 400, y: 410, w: 50, h: 50 }, { x: 510, y: 410, w: 50, h: 50 }] },
};
const MAP_ORDER = ['basic', 'waste', 'temple', 'hell'];
const pickMap = () => MAP_ORDER[Math.floor(Math.random() * MAP_ORDER.length)];
let WALLS = MAPS.basic.walls;      // 지금 계산 중인 게임의 벽 (Game.update가 시작할 때 자기 맵으로 바꿈)
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
    atk: { type: 'melee', dmg: 8, cd: 0.8, range: 68, arc: 2.4, fist: true },
    rageAt: 50, passive: '합계 50 피해를 받으면(보호막 포함) 다음 대지 강타가 분노의 강타로 변해 피해 30 · 쓰면 원래대로(라운드마다 초기화)',
    skills: [
      { name: '방패', icon: '🛡️', desc: '3초간 내구도 40의 방패(체력 아래 파란 바)', cd: 8, ai: { use: 'defend' }, fx: [{ t: 'shield', amount: 40, dur: 3 }] },
      { name: '돌진', icon: '🐗', desc: '돌진하다 벽에 닿거나 사거리 끝에 이르면 그 자리에 원형 범위가 터져 12 피해(1회) + 기절 0.8초', cd: 9, ai: { use: 'attack', maxD: 300, minD: 90 }, fx: [{ t: 'charge', dist: 260, speed: 640, w: 64, dmg: 12, endR: 100, endStun: 0.8, col: '#5b8def' }] },
      { name: '대지 강타', icon: '💥', desc: '주변 20 피해 + 2초간 50% 둔화 (분노 상태면 분노의 강타: 30 피해)', cd: 6, ai: { use: 'attack', maxD: 120 }, fx: [{ t: 'aoe', radius: 132, dmg: 20, rageDmg: 30, slowT: 2, slowMul: 0.5, col: '#ffb347' }] },
    ] },
  warrior: { id: 'warrior', name: '전사', icon: '⚔️', atkIcon: '⚔️', color: '#ff8a4a', role: '근접 · 높은 공격력', hp: 110, speed: 220, keep: 64,
    atk: { type: 'melee', dmg: 10, cd: 0.6, range: 72, arc: 2.2 },
    skills: [
      { name: '강타', icon: '🗡️', desc: '직선 범위가 보이고 0.2초 뒤 25 피해', cd: 5, ai: { use: 'attack', maxD: 195 }, fx: [{ t: 'line', len: 215, w: 68, dmg: 25, delay: 0.2, col: '#ff8a4a' }] },
      { name: '전사의 함성', icon: '📣', desc: '3초간 받는 피해 30% 감소, 최대 체력 +10(그 라운드 동안)', cd: 15, ai: { use: 'attack', maxD: 200 }, fx: [{ t: 'buff', dr: 0.3, dur: 3, maxHp: 10, col: '#ffd24a' }] },
      { name: '가로베기', icon: '🌙', desc: '0.6초간 120° 부채꼴로 투사체를 막고, 끝나면 범위 안의 적에게 15 피해', cd: 10, ai: { use: 'block', maxD: 125 }, fx: [{ t: 'cone', range: 128, arc: 2.094, dmg: 15, guard: 0.6, col: '#ff8a4a' }] },
    ] },
  archer: { id: 'archer', name: '궁수', icon: '🏹', atkIcon: '🏹', color: '#6be08a', role: '원거리 · 빠른 연사', hp: 90, speed: 235, keep: 300,
    atk: { type: 'ranged', dmg: 8, cd: 0.4, range: 560, speed: 620, r: 5 },
    skills: [
      { name: '삼연사', icon: '🎯', desc: '화살 3발 부채꼴 발사', cd: 6, proj: 1, ai: { use: 'attack', maxD: 450 }, fx: [{ t: 'proj', n: 3, spread: 0.22, dmg: 9, speed: 640, r: 5 }] },
      { name: '후퇴 사격', icon: '↩️', desc: '뒤로 물러나며 큰 화살 발사, 맞으면 1초간 속박(이동·대시 불가, 공격은 가능)', cd: 10, proj: 1, ai: { use: 'escape', minD: 150 }, fx: [{ t: 'blink', dist: 150, dir: 'away' }, { t: 'proj', dmg: 10, speed: 520, r: 14, slowT: 1, slowMul: 0 }] },
      { name: '관통 화살', icon: '➳', desc: '적과 벽을 꿰뚫는 강한 화살', cd: 7, proj: 1, ai: { use: 'attack', maxD: 520 }, fx: [{ t: 'proj', dmg: 20, speed: 950, r: 8, pierce: true, life: 1.0, col: '#4cff7a' }] },
    ] },
  mage: { id: 'mage', name: '마법사', icon: '🔮', atkIcon: '🔮', color: '#c36bff', role: '원거리 · 범위 마법', hp: 95, speed: 225, keep: 280,
    atk: { type: 'ranged', dmg: 11, cd: 0.7, range: 520, speed: 540, r: 8 },
    skills: [
      { name: '화염구', icon: '🔥', desc: '직격 30 피해, 직격하지 못하고 터지면 범위 20 피해', cd: 5, proj: 1, ai: { use: 'attack', maxD: 480 }, fx: [{ t: 'proj', dmg: 30, aoeDmg: 20, speed: 540, r: 14, aoe: 96, life: 1.4, col: '#ff8a4a' }] },
      { name: '빙결', icon: '❄️', desc: '맞으면 2초간 둔화', cd: 8, proj: 1, ai: { use: 'attack', maxD: 480 }, fx: [{ t: 'proj', dmg: 10, speed: 720, r: 15, life: 1.1, slowT: 2, slowMul: 0.5, col: '#8fd8ff' }] },
      { name: '순간이동', icon: '✨', desc: '드래그한 방향(탭하면 이동 방향, 없으면 뒤)으로 순간이동', cd: 10, ai: { use: 'escape', minD: 130 }, fx: [{ t: 'blink', dist: 147, dir: 'move', thru: true }] },
    ] },
};
CHARS.assassin = { id: 'assassin', name: '암살자', icon: '🗡️', atkIcon: '🗡️', color: '#ff3b3b', role: '근접 · 암살', hp: 90, speed: 220, keep: 40,
  dashN: 2, dashCd: 6, empAtk: 5,
  passive: '대시 2회(둘 다 써야 6초 쿨타임이 돎) · 스킬을 쓰면 다음 기본공격 피해 +5(중첩 없음) + 상대 쪽으로 짧게 파고들며 벰',
  atk: { type: 'melee', dmg: 15, cd: 0.5, range: 56, arc: 2.4, lunge: 30 },
  skills: [
    { name: '단검투척', icon: '🗡️', desc: '단검을 던져 적중하면 10 피해 + 그 적의 바로 뒤로 순간이동', cd: 6, proj: 1, ai: { use: 'attack', maxD: 360 }, fx: [{ t: 'proj', dmg: 10, speed: 760, r: 8, life: 0.5, tp: true, col: '#ff6b6b' }] },
    { name: '반격', icon: '🤺', desc: '0.5초간 삼각형 범위로 오는 공격을 막고(제자리), 끝나면 범위 안의 적에게 피해: 막았으면 20 / 못 막았으면 10', cd: 10, ai: { use: 'block', maxD: 130 }, fx: [{ t: 'counter', len: 140, w: 70, block: 0.5, hit: 20, miss: 10, col: '#ff6b6b' }] },
    { name: '은신', icon: '🫥', desc: '5초간 은신: 이동속도 1.2배, 상대에게 보이지 않고 기본공격 투사체에 맞지 않음. 공격·스킬을 쓰면 풀림(피해를 받아도 유지). 쿨타임 9초는 은신이 끝난 뒤부터', cd: 9, ai: { use: 'gapclose', minD: 220, maxD: 9999 }, fx: [{ t: 'stealth', dur: 5, speed: STL_MUL }] },
  ] };
const CHAR_ORDER = ['tank', 'warrior', 'archer', 'mage', 'assassin'];      // 플레이할 수 있는 캐릭터
// 방향을 정해서 쓰는 스킬인지(드래그 조준 가능) 자동 판별
for (const id of CHAR_ORDER) for (const s of CHARS[id].skills) s.aimed = s.fx.some(f => ['proj', 'cone', 'line', 'charge', 'blink', 'counter'].includes(f.t));

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
// 벽을 뚫고 지나가지 않도록 잘게 나눠서 이동 (프레임이 끊겨 한 번에 크게 움직여도 벽에서 멈춤)
function stepMove(o, dx, dy) {
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 8)), sx = dx / n, sy = dy / n;
  for (let i = 0; i < n; i++) {
    o.x = clamp(o.x + sx, R, W - R); o.y = clamp(o.y + sy, R, H - R);
    for (const w of WALLS) resolveCircleRect(o, R, w);
    o.x = clamp(o.x, R, W - R); o.y = clamp(o.y, R, H - R);
  }
}
// 반격 삼각형: 시전자 위치가 밑변(폭 w), 조준 방향 len 앞이 꼭지점. (x,y)가 안(여유 pad 포함)에 있는지
function inTri(c, o, x, y, pad) {
  const ca = Math.cos(c.a), sa = Math.sin(c.a), dx = x - o.x, dy = y - o.y, along = dx * ca + dy * sa, perp = Math.abs(-dx * sa + dy * ca);
  return along >= -pad && along <= c.len + pad && perp <= (c.w / 2) * (1 - Math.max(0, along) / c.len) + pad;
}
const isRoot = p => p.slowT > 0 && p.slowMul === 0;      // 속박: 이동·대시·이동기 불가, 공격·그 밖의 스킬은 가능
const moveSkill = sk => sk.fx.some(f => f.t === 'blink' || f.t === 'charge');
// 돌진 경로: 벽에 닿으면 거기서 멈춤. 실제로 갈 수 있는 거리와 도착 지점을 돌려줌
function chargePath(p, ang, dist) {
  const o = { x: p.x, y: p.y }, ux = Math.cos(ang), uy = Math.sin(ang); let tr = 0;
  for (let it = 0; it < 80 && tr < dist; it++) {      // 반복 횟수 제한(무한 반복 방지)
    const st = Math.min(8, dist - tr), px = o.x, py = o.y;
    stepMove(o, ux * st, uy * st);
    const mv = Math.hypot(o.x - px, o.y - py); tr += mv;
    if (mv < st * 0.9) break;      // 벽에 닿음
  }
  return { d: Math.min(tr, dist), x: o.x, y: o.y };
}
const freshWant = () => ({ dash: 0, sk: [0, 0, 0], angs: [null, null, null] });

function mkPlayer(idx, charId) {
  const ch = CHARS[charId];
  return { idx, ch, x: 0, y: 0, vx: 0, vy: 0, aim: 0, hp: ch.hp, maxHp: ch.hp, alive: true, atkCd: 0, skCd: [0, 0, 0],
    dashCd: 0, dashT: 0, dx: 1, dy: 0, inv: 0, stun: 0, slowT: 0, slowMul: 1, shield: 0, shieldMax: 0, shieldT: 0, dr: 0, drT: 0, haste: 0, hasteMul: 1, charge: null, guard: null,
    atkHold: false, atkBuf: 0, dashN: ch.dashN || 0, stl: 0, stlI: -1, emp: false, cnt: null, seenX: 0, seenY: 0,
    inp: { mx: 0, my: 0 }, want: freshWant(), taken: 0, rage: false,
    think: 0, strafe: 1, strafeT: 0, stuckT: 0, lx: 0, ly: 0, unstick: 0, unstickAng: 0 };
}

class Game {
  constructor(myChar, aiChar, diffKey, mapId) {
    this.diff = DIFFS[diffKey] || DIFFS.normal; this.setMap(mapId);
    this.players = [mkPlayer(0, myChar), mkPlayer(1, aiChar)];
    this.auto0 = false;       // true면 0번(사람 자리)도 AI가 조작 (테스트용)
    this.remote = false;      // true면 1번도 사람(온라인 상대)이 조작: AI를 쓰지 않음
    this.ev = []; this.fx = []; this.bullets = []; this.zones = [];
    this.startMatch();
  }
  setMap(id) { this.mapId = MAPS[id] ? id : 'basic'; this.map = MAPS[this.mapId]; this.walls = this.map.walls; WALLS = this.walls; }
  startMatch() {
    this.score = [0, 0]; this.round = 1; this.matchWinner = -1;
    for (const p of this.players) p.maxHp = p.ch.hp;     // 영구 체력 증가는 한 판(매치) 동안만 유지
    this.startRound();
  }
  startRound() {
    for (const p of this.players) {
      p.x = SPAWN[p.idx].x; p.y = SPAWN[p.idx].y; p.vx = p.vy = 0; p.aim = p.idx === 0 ? 0 : Math.PI;
      p.maxHp = p.ch.hp; p.hp = p.maxHp; p.alive = true; p.atkCd = 0.5;      // 함성 등으로 늘어난 최대 체력은 라운드가 끝나면 초기화
      p.atkBuf = 0; p.skCd = [0, 0, 0]; p.dashCd = 0; p.dashT = 0; p.inv = 0; p.stun = 0; p.dashN = p.ch.dashN || 0; p.stl = 0; p.stlI = -1; p.emp = false; p.cnt = null; p.taken = 0; p.rage = false; p.seenX = p.x; p.seenY = p.y;
      p.slowT = 0; p.shield = 0; p.shieldT = 0; p.dr = 0; p.drT = 0; p.haste = 0; p.charge = null; p.guard = null; p.inp = { mx: 0, my: 0 }; p.want = freshWant();
      p.think = 0.4; p.stuckT = 0; p.lx = p.x; p.ly = p.y; p.unstick = 0;
    }
    this.bullets = []; this.fx = []; this.zones = []; this.fightT = 0; this.res = null; this.ph = 'count'; this.timer = COUNT_TIME;
    const m = this.map; this.bolts = []; this.boltT = m.bolt ? m.bolt.first : 0; this.heatT = m.heat ? m.heat.every : 0; this.ess = m.ess ? { up: false, t: m.ess.first } : null;
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
    WALLS = this.walls;
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
    if (t.cnt && src && src !== t && inTri(t.cnt, t, src.x, src.y, R)) { this.blockedBy(t); return false; }      // 반격: 삼각형 안에서 오는 피해를 막음
    let a = dmg * (this.fightT > OT_START ? OT_DMG_MUL : 1);   // 서든데스 규칙: 모든 데미지 2배
    if (t.drT > 0) a *= 1 - t.dr;      // 받는 피해 감소 버프(전사의 함성)
    if (t.ch.rageAt && !t.rage) { t.taken += a; if (t.taken >= t.ch.rageAt) { t.rage = true; t.taken = 0; this.ev.push({ k: 'text', x: t.x, y: t.y - 36, txt: '분노!', col: '#ffd24a' }); } }      // 탱커: 받은 피해(보호막이 막은 양 포함)가 쌓이면 분노
    if (t.shieldT > 0 && t.shield > 0) { const ab = Math.min(t.shield, a); t.shield -= ab; a -= ab; }
    t.hp -= a;
    if (o && o.stun) { t.stun = Math.max(t.stun, o.stun); t.charge = null; t.cnt = null; }
    if (o && o.slowT) { t.slowT = Math.max(t.slowT, o.slowT); t.slowMul = o.slowMul != null ? o.slowMul : 0.5; }
    this.ev.push({ k: 'hit', x: t.x, y: t.y - 8, d: Math.round(dmg * (this.fightT > OT_START ? OT_DMG_MUL : 1) * (t.drT > 0 ? 1 - t.dr : 1)), to: t.idx });
    return true;
  }

  blockedBy(t) {
    if (!t.cnt.blocked) this.ev.push({ k: 'text', x: t.x, y: t.y - 58, txt: '막음!', col: '#ffd24a' });
    t.cnt.blocked = true;
    this.fx.push({ k: 'ring', x: t.x, y: t.y, r: 34, life: 0.2, max: 0.2, col: '#ffffff' });
  }
  endStealth(p) {      // 은신이 끝나거나 풀리면 그때부터 스킬 쿨타임이 돎
    if (p.stl > 0 || p.stlI >= 0) { p.stl = 0; if (p.stlI >= 0) p.skCd[p.stlI] = p.ch.skills[p.stlI].cd; p.stlI = -1; }
  }
  fireProj(p, f, ang) {
    const base = typeof ang === 'number' ? ang : p.aim;
    const n = f.n || 1, sp = f.spread || 0;
    for (let k = 0; k < n; k++) {
      const a = base + (k - (n - 1) / 2) * sp;
      this.bullets.push({ x: p.x + Math.cos(a) * (R + 4), y: p.y + Math.sin(a) * (R + 4), vx: Math.cos(a) * f.speed, vy: Math.sin(a) * f.speed,
        r: f.r || 5, dmg: f.dmg, owner: p.idx, pierce: !!f.pierce, aoe: f.aoe || 0, aoeDmg: f.aoeDmg, stun: f.stun || 0, slowT: f.slowT || 0, slowMul: f.slowMul != null ? f.slowMul : 1,
        life: f.life || 1.4, col: f.col || null, hit: false, basic: !!f.basic, tp: !!f.tp });
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
    this.fx.push({ k: 'cone', x: p.x, y: p.y, a: A, arc, r: range, life, max: life, col: (o && o.col) || '#e8edf7', follow: o && o.guard ? p.idx : -1, fist: !o && !!p.ch.atk.fist });
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
    if (p.stl > 0 && !sk.fx.some(f => f.t === 'stealth')) this.endStealth(p);      // 스킬을 쓰면 은신이 풀림
    if (p.ch.empAtk) p.emp = true;      // 스킬을 쓰면 다음 기본공격 강화
    p.skCd[i] = sk.cd;                 // 시전하자마자 쿨타임이 돌기 시작
    this.ev.push({ k: 'skill', p: p.idx, i });
    const e = this.players[1 - p.idx];
    for (const f of sk.fx) {
      if (f.t === 'proj') this.fireProj(p, f, ang);
      else if (f.t === 'aoe') {
        const rg = !!(f.rageDmg && p.rage); if (rg) { p.rage = false; p.taken = 0; }      // 분노의 강타: 한 번 쓰면 원래대로
        this.fx.push({ k: 'ring', x: p.x, y: p.y, r: f.radius * (rg ? 1.1 : 1), life: rg ? 0.45 : 0.3, max: rg ? 0.45 : 0.3, col: rg ? '#ffd24a' : (f.col || '#ffffff') });
        if (Math.hypot(e.x - p.x, e.y - p.y) <= f.radius * (rg ? 1.1 : 1) + R) this.dealDamage(p, e, rg ? f.rageDmg : f.dmg, f);
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
      else if (f.t === 'counter') {
        p.cnt = { a: ang, t: f.block, len: f.len, w: f.w, hit: f.hit, miss: f.miss, blocked: false, col: f.col };
        this.fx.push({ k: 'tri', x: p.x, y: p.y, a: ang, len: f.len, w: f.w, life: f.block, max: f.block, col: f.col || '#ff6b6b' });
      } else if (f.t === 'stealth') {
        p.stl = f.dur; p.stlI = i; p.stlMul = f.speed; p.skCd[i] = sk.cd + f.dur;      // 은신이 끝난 뒤부터 쿨타임
        this.fx.push({ k: 'ring', x: p.x, y: p.y, r: 44, life: 0.35, max: 0.35, col: '#9aa4b8' });
      }
      else if (f.t === 'shield') { p.shield = f.amount; p.shieldMax = f.amount; p.shieldT = f.dur; }
      else if (f.t === 'buff') {
        if (f.haste) { p.haste = f.dur; p.hasteMul = f.haste; }
        if (f.dr) { p.dr = f.dr; p.drT = f.dur; }
        if (f.maxHp) { p.maxHp += f.maxHp; p.hp += f.maxHp; this.ev.push({ k: 'text', x: p.x, y: p.y - 30, txt: '최대 체력 +' + f.maxHp, col: '#ffd24a' }); }
        this.fx.push({ k: 'ring', x: p.x, y: p.y, r: 60, life: 0.4, max: 0.4, col: f.col || '#ffd24a' });
      } else if (f.t === 'charge') {
        const cp = chargePath(p, ang, f.dist);      // 벽이 있으면 거기까지만 돌진
        p.charge = { dx: Math.cos(ang), dy: Math.sin(ang), speed: f.speed, left: cp.d / f.speed, dmg: f.dmg, stun: f.stun || 0, w: f.w || 52, endR: f.endR || 0, endStun: f.endStun || 0, hit: false, col: f.col };
        const T = cp.d / f.speed + 0.1;      // 돌진하는 동안 경로(사각)와 도착 원을 모두에게 보여줌
        this.fx.push({ k: 'tele', x: p.x, y: p.y, a: ang, len: cp.d, w: f.w || 52, life: T, max: T, col: f.col || '#5b8def' });
        if (f.endR) this.fx.push({ k: 'teleC', x: cp.x, y: cp.y, r: f.endR, life: T, max: T, col: f.col || '#5b8def' });
      }
      else if (f.t === 'blink') {
        let dx, dy; const m = Math.hypot(p.inp.mx, p.inp.my);
        if (aimed) { const sgn = f.dir === 'away' ? -1 : 1; dx = Math.cos(ang) * sgn; dy = Math.sin(ang) * sgn; }
        else if (f.dir === 'toward') { dx = Math.cos(p.aim); dy = Math.sin(p.aim); }
        else if (f.dir === 'move' && m > 0.2) { dx = p.inp.mx / m; dy = p.inp.my / m; }
        else { dx = -Math.cos(p.aim); dy = -Math.sin(p.aim); }
        this.fx.push({ k: 'ring', x: p.x, y: p.y, r: 30, life: 0.25, max: 0.25, col: p.ch.color });
        if (f.thru) {      // 마법사 순간이동: 벽을 관통 (도착 지점이 벽 안이면 밖으로 밀어냄)
          p.x = clamp(p.x + dx * f.dist, R, W - R); p.y = clamp(p.y + dy * f.dist, R, H - R);
          for (const w of WALLS) resolveCircleRect(p, R, w);
          p.x = clamp(p.x, R, W - R); p.y = clamp(p.y, R, H - R);
        } else stepMove(p, dx * f.dist, dy * f.dist);      // 후퇴 사격 등은 벽 앞에서 멈춤
        this.fx.push({ k: 'ring', x: p.x, y: p.y, r: 30, life: 0.25, max: 0.25, col: p.ch.color });
      }
    }
  }
  basicAttack(p) {
    const a = p.ch.atk, dmg = a.dmg + (p.emp && p.ch.empAtk ? p.ch.empAtk : 0);
    if (p.stl > 0) this.endStealth(p);      // 공격하면 은신이 풀림
    const emp = p.emp && p.ch.empAtk; p.emp = false;
    if (emp && a.lunge) {      // 강화 평타: 상대 쪽으로 짧게 파고들며 벤다 (몸이 겹치지 않는 거리까지만)
      const e = this.players[1 - p.idx], dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1, mv = Math.min(a.lunge, d - (2 * R + 2));
      if (mv > 0) { stepMove(p, dx / d * mv, dy / d * mv); this.fx.push({ k: 'ring', x: p.x, y: p.y, r: 26, life: 0.18, max: 0.18, col: p.ch.color }); }
    }
    if (a.type === 'melee') this.coneHit(p, a.range, a.arc, dmg, null);
    else this.fireProj(p, { dmg, speed: a.speed, r: a.r, basic: true });
    p.atkCd = a.cd;
  }

  stepPlayer(p, dt) {
    const e = this.players[1 - p.idx];
    p.atkCd -= dt; p.dashCd -= dt; p.inv -= dt;
    if (p.ch.dashN && p.dashN === 0 && p.dashCd <= 0) p.dashN = p.ch.dashN;      // 대시를 모두 쓴 뒤 쿨타임이 끝나면 다시 충전
    if (!(p.stl > 0)) { p.seenX = p.x; p.seenY = p.y; }      // 은신 직전 위치(상대가 마지막으로 본 곳)
    if (p.atkBuf > 0) p.atkBuf -= dt;
    for (let i = 0; i < 3; i++) p.skCd[i] = Math.max(0, p.skCd[i] - dt);
    if (p.stl > 0) {
      p.stl -= dt;
      if (p.stl <= 0) this.endStealth(p); else p.skCd[p.stlI] = p.ch.skills[p.stlI].cd + p.stl;      // 은신 중엔 쿨타임이 멈춰 있다가 끝나면 9초부터
    }
    if (p.cnt) {
      p.cnt.t -= dt;
      if (p.cnt.t <= 0) {      // 막기가 끝남: 삼각형 안의 적에게 피해 (막았으면 12, 못 막았으면 6)
        const c = p.cnt; p.cnt = null;
        this.fx.push({ k: 'tri', x: p.x, y: p.y, a: c.a, len: c.len, w: c.w, life: 0.2, max: 0.2, col: c.blocked ? '#ffd24a' : c.col });
        if (p.alive && e.alive && inTri(c, p, e.x, e.y, R)) this.dealDamage(p, e, c.blocked ? c.hit : c.miss, null);
      }
    }
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
    if (p.alive && !p.charge) p.aim = e.stl > 0 ? Math.atan2(e.seenY - p.y, e.seenX - p.x) : Math.atan2(e.y - p.y, e.x - p.x);

    if (p.alive && p.stun <= 0 && !p.charge && p.dashT <= 0 && !p.cnt) {
      if (p.want.dash && (p.ch.dashN ? p.dashN > 0 : p.dashCd <= 0) && !isRoot(p)) {
        const m = Math.hypot(p.inp.mx, p.inp.my);
        if (m > 0.2) { p.dx = p.inp.mx / m; p.dy = p.inp.my / m; } else { p.dx = -Math.cos(p.aim); p.dy = -Math.sin(p.aim); }
        p.dashT = DASH.time;
        if (p.ch.dashN) { p.dashN--; if (p.dashN === 0) p.dashCd = p.ch.dashCd || DASH.cd; } else p.dashCd = DASH.cd;      // 암살자: 충전 대시를 모두 써야 쿨타임이 돎
        this.ev.push({ k: 'dash', p: p.idx });
        this.fx.push({ k: 'ring', x: p.x, y: p.y, r: 28, life: 0.25, max: 0.25, col: '#6be08a' });
      } else {
        for (let i = 0; i < 3; i++) if (p.want.sk[i] && p.skCd[i] <= 0 && !(isRoot(p) && moveSkill(p.ch.skills[i]))) { this.useSkill(p, i, p.want.angs[i]); break; }
      }
    }
    p.want = freshWant();

    let vx = 0, vy = 0;
    if (!p.alive) { /* 정지 */ }
    else if (p.charge) { const c = p.charge; vx = c.dx * c.speed; vy = c.dy * c.speed; c.left -= dt; if (c.left <= 0) { p.charge = null; this.chargeEnd(p, c); } }
    else if (p.dashT > 0) { vx = p.dx * DASH.speed; vy = p.dy * DASH.speed; p.dashT -= dt; }
    else if (p.cnt) { /* 반격 중에는 제자리 */ }
    else if (p.stun <= 0) {
      let mx = p.inp.mx, my = p.inp.my; const ml = Math.hypot(mx, my);
      if (ml > 1) { mx /= ml; my /= ml; }
      const sp = p.ch.speed * (p.slowT > 0 ? p.slowMul : 1) * (p.haste > 0 ? p.hasteMul : 1) * (p.stl > 0 ? STL_MUL : 1) * (this.map.speedMul || 1);
      vx = mx * sp; vy = my * sp;
    }
    p.vx = vx; p.vy = vy;
    stepMove(p, vx * dt, vy * dt);

    const dist = Math.hypot(e.x - p.x, e.y - p.y);
    if (p.charge && !p.charge.hit && dist < p.charge.w / 2 + R) {      // 경로상 적 12 피해      // 지나가며 부딪힌 적에게 1회 피해 (돌진은 계속)
      const c = p.charge; c.hit = true;
      this.fx.push({ k: 'ring', x: e.x, y: e.y, r: 45, life: 0.25, max: 0.25, col: '#ffffff' });
      this.dealDamage(p, e, c.dmg, c);
    }
    // 기본공격: 버튼을 톡 누르면 1회(사거리 상관없이), 꾹 누르면 사거리 안에서 자동 반복
    if (p.alive && p.stun <= 0 && !p.charge && p.dashT <= 0 && !p.cnt && p.atkCd <= 0) {
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
    const hid = e.stl > 0, ex = hid ? e.seenX : e.x, ey = hid ? e.seenY : e.y;      // 은신한 상대는 마지막으로 본 위치만 알 수 있음
    const dx = ex - p.x, dy = ey - p.y, dist = Math.hypot(dx, dy) || 1, ux = dx / dist, uy = dy / dist;
    const los = this.clear(p.x, p.y, ex, ey), keep = p.ch.keep, melee = p.ch.atk.type === 'melee';
    let ap = dist > keep + 30 ? 1 : dist < keep - 30 ? -1 : 0;
    if (!los) ap = Math.max(ap, 0.8);
    let mx, my;
    if (p.unstick > 0) { mx = Math.cos(p.unstickAng); my = Math.sin(p.unstickAng); }
    else { const sw = melee ? 0.35 : 0.8; mx = ux * ap - uy * p.strafe * sw; my = uy * ap + ux * p.strafe * sw; }
    if (this.map.bolt) for (const bt of this.bolts) { const rx = p.x - bt.x, ry = p.y - bt.y, rd = Math.hypot(rx, ry) || 1; if (rd < this.map.bolt.r + R + 30) { mx = rx / rd; my = ry / rd; break; } }      // 번개 경고 원에서 벗어남
    if (this.ess && this.ess.up && p.hp <= p.maxHp - 6) { const de = Math.hypot(p.x - W / 2, p.y - H / 2), dp = Math.hypot(e.x - W / 2, e.y - H / 2); if (de < dp + 120 || p.hp < p.maxHp * 0.6) { mx = (W / 2 - p.x) / (de || 1); my = (H / 2 - p.y) / (de || 1); } }      // 정수 먹으러 감
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
        if ((p.ch.dashN ? p.dashN > 0 : p.dashCd <= 0) && Math.random() < d.dodge) { p.want.dash = 1; dodged = true; }
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

  stepMapFx(dt) {      // 맵 추가 효과: 번개(신전) / 뜨거운 공기와 정수(지옥)
    const m = this.map, P = this.players;
    if (m.bolt) {
      const B = m.bolt; this.boltT -= dt;
      if (this.boltT <= 0) {
        this.boltT += B.every; const bx = 70 + Math.random() * (W - 140), by = 70 + Math.random() * (H - 140);
        this.bolts.push({ x: bx, y: by, t: B.warn }); this.fx.push({ k: 'bolt', x: bx, y: by, r: B.r, life: B.warn, max: B.warn, col: '#ff4a4a' });
      }
      for (const b of this.bolts) {
        b.t -= dt; if (b.t > 0) continue; b.done = true;
        this.fx.push({ k: 'bstar', x: b.x, y: b.y, r: B.r, life: 0.45, max: 0.45, col: '#ffe14a' });
        for (const p of P) if (p.alive && Math.hypot(p.x - b.x, p.y - b.y) <= B.r + R) this.dealDamage(null, p, B.dmg, null);
      }
      this.bolts = this.bolts.filter(b => !b.done);
    }
    if (m.heat) {      // 체력에서 바로 깎음: 피해 감소·보호막·무적(대시)의 영향을 받지 않음
      this.heatT -= dt;
      if (this.heatT <= 0) { this.heatT += m.heat.every; for (const p of P) if (p.alive) { p.hp -= m.heat.dmg; this.ev.push({ k: 'text', x: p.x, y: p.y - 30, txt: '-' + m.heat.dmg, col: '#ff8a4a' }); } }
    }
    if (this.ess) {
      const E = m.ess, e = this.ess;
      if (!e.up) { e.t -= dt; if (e.t <= 0) { e.up = true; e.t = 0; } }
      else for (const p of P) if (p.alive && Math.hypot(p.x - W / 2, p.y - H / 2) <= R + E.r) {
        p.hp = Math.min(p.maxHp, p.hp + E.heal); e.up = false; e.t = E.respawn;
        this.ev.push({ k: 'text', x: p.x, y: p.y - 30, txt: '+' + E.heal, col: '#6be08a' }); this.fx.push({ k: 'ring', x: W / 2, y: H / 2, r: 50, life: 0.4, max: 0.4, col: '#6be08a' }); break;
      }
    }
  }
  stepFight(dt) {
    const P = this.players;
    if (!this.remote) this.ai(P[1], dt);
    if (this.auto0) this.ai(P[0], dt);
    this.stepZones(dt); this.stepMapFx(dt);
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

  tpBehind(o, t, b) {
    const sp = Math.hypot(b.vx, b.vy) || 1, d = 2 * R + 4;
    this.fx.push({ k: 'ring', x: o.x, y: o.y, r: 30, life: 0.25, max: 0.25, col: o.ch.color });
    o.x = clamp(t.x + b.vx / sp * d, R, W - R); o.y = clamp(t.y + b.vy / sp * d, R, H - R);
    for (const w of WALLS) resolveCircleRect(o, R, w);
    o.x = clamp(o.x, R, W - R); o.y = clamp(o.y, R, H - R);
    this.fx.push({ k: 'ring', x: o.x, y: o.y, r: 30, life: 0.25, max: 0.25, col: o.ch.color });
  }
  stepBullets(dt) {
    for (const b of this.bullets) {
      b.life -= dt; let dead = false, boom = false;
      b.x += b.vx * dt; b.y += b.vy * dt;
      const t = this.players[1 - b.owner];
      if (b.life <= 0) { dead = true; boom = b.aoe > 0; }
      else if (b.x < b.r || b.x > W - b.r || b.y < b.r || b.y > H - b.r) { dead = true; boom = b.aoe > 0; }
      if (!dead && t.cnt && inTri(t.cnt, t, b.x, b.y, b.r)) {      // 반격: 삼각형 안으로 들어온 투사체를 막음
        dead = true; this.blockedBy(t);
      }
      if (!dead && t.guard) {      // 가로베기 같은 막기: 부채꼴 안으로 들어온 투사체는 사라짐
        const gx = b.x - t.x, gy = b.y - t.y;
        if (Math.hypot(gx, gy) <= t.guard.r + b.r && Math.abs(normAng(Math.atan2(gy, gx) - t.guard.a)) <= t.guard.arc / 2) {
          dead = true; this.fx.push({ k: 'ring', x: b.x, y: b.y, r: 20, life: 0.2, max: 0.2, col: '#ffffff' });
        }
      }
      if (!dead && !b.pierce) for (const w of WALLS) if (resolveCircleRect(b, b.r, w)) { dead = true; boom = b.aoe > 0; break; }
      if (!dead) {
        if (t.alive && t.dashT <= 0 && t.inv <= 0 && !(b.pierce && b.hit) && !(t.stl > 0 && b.basic)) {      // 은신 중엔 기본공격 투사체에 맞지 않음
          const dx = t.x - b.x, dy = t.y - b.y, rr = R + b.r;
          if (dx * dx + dy * dy < rr * rr) {
            const ok = this.dealDamage(this.players[b.owner], t, b.dmg, b); b.hit = true;      // 직격 피해
            if (ok && b.tp) this.tpBehind(this.players[b.owner], t, b);      // 단검투척: 맞힌 적의 바로 뒤로 순간이동
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

export { Game, CHARS, CHAR_ORDER, W, H, MAPS, MAP_ORDER };
export const BUILD = 43;
