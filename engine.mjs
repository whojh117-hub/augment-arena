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
const SPAWN4 = [{ x: 90, y: 180 }, { x: 90, y: 360 }, { x: 870, y: 180 }, { x: 870, y: 360 }];      // 2대2: 0·1번 왼쪽 팀, 2·3번 오른쪽 팀

// ─────────────────────────────────────────────────────────────
// 캐릭터 정의. 체력/속도/기본공격/스킬은 이 표만 고치면 돼요. (전사는 확정값, 나머지는 임시값)
//  atk  : 기본공격. melee(근접) 또는 ranged(원거리). 공격 버튼을 누르면 나가고, 꾹 누르면 사거리 안에서 자동 반복
//  keep : AI가 유지하려는 거리
//  skills[].fx : 효과 목록. 종류 → proj(투사체) aoe(주변 범위) cone(부채꼴) line(직선 범위) shield(보호막) blink(순간이동) charge(돌진) buff(가속/체력)
//  skills[].ai : AI 사용 힌트. attack / defend / escape / block / gapclose
// ─────────────────────────────────────────────────────────────
const CHARS = {
  tank: { id: 'tank', name: '탱커', icon: '🛡️', atkIcon: '👊', color: '#5b8def', role: '근접 · 단단한 방어', hp: 150, speed: 190, keep: 64,
    atk: { type: 'melee', dmg: 8, cd: 0.8, range: 68, arc: 2.4, fist: true },
    rageAt: 70, passive: '합계 70 피해를 받으면(보호막 포함) 다음 대지 강타가 분노의 강타로 변해 피해 25 · 쓰면 원래대로(라운드마다 초기화)',
    skills: [
      { name: '방패', icon: '🛡️', desc: '3초간 내구도 40의 방패(체력 아래 파란 바) · 쿨타임은 방패가 끝난 뒤부터 8초', cd: 8, ai: { use: 'defend' }, fx: [{ t: 'shield', amount: 40, dur: 3 }] },
      { name: '돌진', icon: '🐗', desc: '돌진하다 벽에 닿거나 사거리 끝에 이르면 그 자리에 원형 범위가 터져 15 피해(1회) + 기절 0.8초', cd: 9, ai: { use: 'attack', maxD: 300, minD: 90 }, fx: [{ t: 'charge', dist: 260, speed: 640, w: 64, dmg: 15, endR: 100, endStun: 0.8, col: '#5b8def' }] },
      { name: '대지 강타', icon: '💥', desc: '주변 15 피해 + 2초간 50% 둔화 (분노 상태면 분노의 강타: 25 피해)', cd: 6, ai: { use: 'attack', maxD: 100 }, fx: [{ t: 'aoe', radius: 90, dmg: 15, rageDmg: 25, slowT: 2, slowMul: 0.5, col: '#ffb347' }] },
    ] },
  warrior: { id: 'warrior', name: '전사', icon: '⚔️', atkIcon: '⚔️', color: '#ff8a4a', role: '근접 · 높은 공격력', hp: 110, speed: 220, keep: 64,
    atk: { type: 'melee', dmg: 10, cd: 0.6, range: 72, arc: 2.2 },
    skills: [
      { name: '강타', icon: '🗡️', desc: '직선 범위가 보이고 0.25초 뒤 25 피해', cd: 5, ai: { use: 'attack', maxD: 195 }, fx: [{ t: 'line', len: 215, w: 68, dmg: 25, delay: 0.25, col: '#ff8a4a' }] },
      { name: '전사의 함성', icon: '📣', desc: '3초간 받는 피해 30% 감소, 최대 체력 +10(그 라운드 동안)', cd: 15, ai: { use: 'attack', maxD: 200 }, fx: [{ t: 'buff', dr: 0.3, dur: 3, maxHp: 10, col: '#ffd24a' }] },
      { name: '가로베기', icon: '🌙', desc: '0.6초간 120° 부채꼴로 투사체를 막고, 끝나면 범위 안의 적에게 15 피해', cd: 10, ai: { use: 'block', maxD: 125 }, fx: [{ t: 'cone', range: 128, arc: 2.094, dmg: 15, guard: 0.6, col: '#ff8a4a' }] },
    ] },
  archer: { id: 'archer', name: '궁수', icon: '🏹', atkIcon: '🏹', color: '#6be08a', role: '원거리 · 빠른 연사', hp: 90, speed: 230, keep: 300,
    atk: { type: 'ranged', dmg: 8, cd: 0.4, range: 560, speed: 620, r: 5 },
    skills: [
      { name: '삼연사', icon: '🎯', desc: '화살 3발 부채꼴 발사', cd: 6, proj: 1, ai: { use: 'attack', maxD: 450 }, fx: [{ t: 'proj', n: 3, spread: 0.22, dmg: 9, speed: 640, r: 5 }] },
      { name: '후퇴 사격', icon: '↩️', desc: '뒤로 물러나며 큰 화살 발사, 맞으면 1초간 속박: 이동·대시 불가, 공격은 가능', cd: 10, proj: 1, ai: { use: 'escape', minD: 150 }, fx: [{ t: 'blink', dist: 150, dir: 'away' }, { t: 'proj', dmg: 10, speed: 520, r: 14, slowT: 1, slowMul: 0 }] },
      { name: '관통 화살', icon: '➳', desc: '적과 벽을 꿰뚫는 강한 화살', cd: 7, proj: 1, ai: { use: 'attack', maxD: 520 }, fx: [{ t: 'proj', dmg: 20, speed: 950, r: 8, pierce: true, life: 1.0, col: '#4cff7a' }] },
    ] },
  mage: { id: 'mage', name: '마법사', icon: '🔮', atkIcon: '🔮', color: '#c36bff', role: '원거리 · 범위 마법', hp: 95, speed: 225, keep: 280,
    atk: { type: 'ranged', dmg: 11, cd: 0.7, range: 520, speed: 540, r: 8 },
    skills: [
      { name: '화염구', icon: '🔥', desc: '직격 25 피해, 직격하지 못하고 터지면 범위 15 피해', cd: 5, proj: 1, ai: { use: 'attack', maxD: 480 }, fx: [{ t: 'proj', dmg: 25, aoeDmg: 15, speed: 540, r: 14, aoe: 96, life: 1.4, col: '#ff8a4a' }] },
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
    { name: '반격', icon: '🤺', desc: '0.5초간 모든 공격을 막고(제자리), 끝나면 범위 안의 적에게 피해: 막았으면 20 / 못 막았으면 10', cd: 10, ai: { use: 'block', maxD: 130 }, fx: [{ t: 'counter', len: 140, w: 70, block: 0.5, hit: 20, miss: 10, col: '#ff6b6b' }] },
    { name: '은신', icon: '🫥', desc: '3.5초간 은신: 이동속도 1.2배, 상대에게 보이지 않고 기본공격 투사체에 맞지 않음. 공격·스킬을 쓰면 풀림(피해를 받아도 유지). 쿨타임 9초는 은신이 끝난 뒤부터', cd: 9, ai: { use: 'gapclose', minD: 220, maxD: 9999 }, fx: [{ t: 'stealth', dur: 3.5, speed: STL_MUL }] },
  ] };
CHARS.summoner = { id: 'summoner', name: '소환사', icon: '🪄', atkIcon: '🪄', color: '#ffd24a', role: '원거리 · 소환', hp: 100, speed: 215, keep: 240,
  passive: '기본 공격을 5번 적중시키면 다음 기본 공격이 \'강림\'(용 소환)으로 바뀜(게이지는 내 몸 둘레에 표시). 터치하면 내 자리에, 드래그하면 그 방향 앞에 소환. 용은 10초 뒤 사라지고, 살아 있으면 강림을 쓸 수 없음',
  advent: { hits: 5, dist: 118, burst: { r: 110, dmg: 10, slowT: 1, slowMul: 0.5 }, dragon: { life: 10, hp: 50, speed: 90, r: 26, range: 110, arc: 1.9, dmg: 5, every: 0.3 } },
  atk: { type: 'ranged', dmg: 10, cd: 1.5, range: 210, speed: 300, r: 9, hom: 4, life: 0.95, pass: true, rangeCircle: true },
  skills: [
    { name: '추적 구슬', icon: '🔮', desc: '내 자리에 체력 10의 구슬 2개 소환(0.5초 뒤부터 움직임). 속도 230으로 쫓다가 4초 뒤 저절로 터짐. 쿨타임은 구슬이 모두 터진 뒤부터. 상대를 쫓아가 닿거나 죽으면 반지름 1칸 폭발(각 10 피해)', cd: 10, ai: { use: 'attack', maxD: 420 }, fx: [{ t: 'orbs', n: 2, hp: 10, speed: 230, r: 14, burst: 70, dmg: 10, life: 4 }] },
    { name: '벽 소환', icon: '🧱', desc: '드래그한 방향 앞(70)에 1×2칸 벽을 5초간 설치(탭하면 상대 쪽). 다른 벽 위에도 설치 가능(맵 가장자리는 안쪽으로 밀려 설치). 내 기본 공격은 소환 벽만 통과하고 원래 벽은 통과 못 함. 쿨타임 10초는 벽이 사라진 뒤부터', cd: 10, ai: { use: 'wall', minD: 110, maxD: 330 }, fx: [{ t: 'pwall', w: 70, h: 140, dur: 5, dist: 70 }] },
    { name: '용의 힘', icon: '🐉', desc: '강림 게이지를 1칸 채움(용이 없고 게이지가 가득이면 쓸 수 없음). 내 용이 살아 있으면 \'위치 교환\'으로 바뀌어 용과 위치를 맞바꿈(게이지는 안 참, 화면이 흔들림)', cd: 12, ai: { use: 'power' }, fx: [{ t: 'dpower' }] },
  ] };
CHARS.tide = { id: 'tide', name: '조류술사', icon: '🌊', atkIcon: '💧', color: '#3d3fd1', role: '중거리 · 위치 컨트롤', hp: 110, speed: 220, keep: 300,
  atk: { type: 'ranged', dmg: 9, cd: 0.55, range: 400, speed: 600, r: 8 },
  skills: [
    { name: '썰물', icon: '🌀', desc: '수류 채찍을 쏘아 맞은 적을 내 쪽으로 250 끌어당기고 15 피해. 쓰고 7초 뒤 이 버튼이 \'밀물\'로 바뀜', cd: 7, proj: 1, ai: { use: 'attack', minD: 130, maxD: 340 }, fx: [{ t: 'proj', dmg: 15, speed: 520, r: 21, life: 0.65, pull: 250, col: '#7fd3ff' }],
      alt: { name: '밀물', icon: '🌊', desc: '벽을 넘는 넓은 해일을 쏘아 느리게 밀려오는 파도: 맞은 적은 10 피해를 받고 파도 끝까지 함께 밀려남(관통). 도중에 벽에 부딪히면 멈추며 10 피해 + 1초 기절. 쓰고 7초 뒤 다시 \'썰물\'로 바뀜', cd: 7, proj: 1, aimed: true, ai: { use: 'attack', maxD: 300 }, fx: [{ t: 'proj', dmg: 10, speed: 300, r: 68, life: 1.0, push: 200, carry: true, wallDmg: 10, wallStun: 1, wp: true, col: '#4aa8ff' }] } },
    { name: '웅덩이', icon: '🫧', desc: '내 자리에 반경 90의 웅덩이를 3초간 만들고 안의 적에게 8 피해. 안에 들어온 적은 20% 느려지고, 안에 있는 나는 20%, 같은 팀은 10% 빨라짐', cd: 10, ai: { use: 'pool' }, fx: [{ t: 'pool', dist: 0, r: 90, dur: 3, slow: 0.8, haste: 1.2, allyHaste: 1.1, dmg: 8, col: '#3aa8ff' }] },
    { name: '용오름', icon: '🌪️', desc: '소용돌이가 직선으로 날아가 끝나는 곳에 작은 원(반경 55)이 생기고 0.5초 뒤(직선에 맞췄으면 0.2초 뒤) 토네이도가 솟아 20 피해 + 0.5초간 붙잡음. 직선에 맞은 상대는 원 중심으로 빨려 들어감. 탭하면 상대 쪽, 드래그하면 그 방향으로 사거리 231 끝에 원이 고정됨', cd: 9, ai: { use: 'tornado', minD: 90, maxD: 231 }, fx: [{ t: 'tornado', dist: 231, min: 231, max: 231, r: 55, delay: 0.5, dmg: 20, hold: 0.5, hitDelay: 0.2, speed: 640, pr: 16, col: '#9fe8ff' }] },
  ] };
const GAVEL = '<svg viewBox="0 0 32 32" width="1em" height="1em" style="vertical-align:-0.12em;display:inline-block"><g transform="translate(22.5 9.5) rotate(-45)"><path d="M-5 0H-27" stroke="#7a3f17" stroke-width="4.2" stroke-linecap="round"/><path d="M-21 -2.4V2.4M-25 -2.4V2.4" stroke="#e8c04a" stroke-width="2"/><rect x="-5.2" y="-11" width="10.4" height="5" rx="2" fill="#b8591f" stroke="#5a2c0e" stroke-width="0.8"/><rect x="-5.2" y="6" width="10.4" height="5" rx="2" fill="#b8591f" stroke="#5a2c0e" stroke-width="0.8"/><rect x="-5.2" y="-6.4" width="10.4" height="12.8" fill="#f6e7a1" stroke="#c9a83c" stroke-width="0.8"/></g></svg>';      // 심판의 재판 망치 아이콘
CHARS.angel = { id: 'angel', name: '천사', icon: '😇', atkIcon: '✨', color: '#fdfdff', role: '원거리 · 회복 지원', hp: 100, speed: 225, keep: 300, stackMax: 10, noIcon: true,
  passive: '평타를 적중할 때마다 구원 스택이 1 쌓임(최대 10, 체력 아래 노란 바). 스택 1마다 구원의 회복 +3, 피해 +2',
  atk: { type: 'ranged', dmg: 6, cd: 0.6, range: 320, speed: 560, r: 7, col: '#ffffff' },
  hammer: { dur: 5, stack: 2, atk: { type: 'melee', dmg: 12, cd: 0.8, range: 70, arc: 2.2, col: '#ffd24a' } },
  skills: [
    { name: '구원', icon: '✨', desc: '내 주변 큰 원(반경 150): 나와 팀원은 10 + 3×스택 회복, 적은 10 + 2×스택 피해. 쓰면 스택을 모두 잃음', cd: 10, ai: { use: 'salv' }, fx: [{ t: 'salv', radius: 150, base: 10, healPer: 3, dmgPer: 2, col: '#ffe58a' }] },
    { name: '법률', icon: '⚖️', desc: '내 자리에 반경 130의 판결 구역을 3초간 펼침. 안에 있는 적은 40% 느려지고 스킬을 쓸 수 없음(평타·대시는 가능). 우리 팀은 구역 안에서 받는 피해 0.8배. 쿨타임은 구역이 끝난 뒤부터', cd: 13, ai: { use: 'pool' }, fx: [{ t: 'pool', dist: 0, r: 130, dur: 3, slow: 0.6, sil: true, col: '#ffd24a' }] },
    { name: '심판', icon: GAVEL, desc: '5초간 금 망치를 듦: 평타가 근접(피해 12, 0.8초, 사거리 70)으로 바뀌고, 적중하면 스택 +2. 쿨타임은 쓴 때부터 12초', cd: 12, ai: { use: 'gapclose', minD: 0, maxD: 150 }, fx: [{ t: 'hammer', dur: 5 }] },
  ] };
const KUNAI = '<svg viewBox="0 0 32 32" width="1em" height="1em" style="vertical-align:-0.12em;display:inline-block"><g transform="translate(16 16) rotate(45)"><path d="M0 -14 L4.2 -1 L0 4 L-4.2 -1 Z" fill="#c9d0de" stroke="#3a4052" stroke-width="1"/><path d="M0 -13 L0 3" stroke="#8c95aa" stroke-width="0.9"/><rect x="-2.2" y="4" width="4.4" height="9" rx="1.2" fill="#2a2d36" stroke="#0e0f13" stroke-width="0.8"/><path d="M-2.2 7H2.2M-2.2 10H2.2" stroke="#6b7388" stroke-width="0.9"/><circle cx="0" cy="15.2" r="2.6" fill="none" stroke="#8c95aa" stroke-width="1.4"/></g></svg>';      // 닌자 선택 카드 쿠나이 아이콘
CHARS.ninja = { id: 'ninja', name: '닌자', icon: '🥷', atkIcon: KUNAI, color: '#23262e', role: '중거리 · 스피드 · 덫', hp: 90, speed: 255, keep: 250, noIcon: true,
  ninjutsu: { max: 4, decay: 3, spd: 0.03, atk: 0.07 }, passive: '스킬, 대쉬 사용시 인술스택이 쌓이며 인술 스택이 쌓일수록 ‘참’피해, 평타 속도와 이동속도가 증가함. 4스택 시 평타 하나가 추가로 더 나가고 ‘참’의 피해가 30으로 증가함',
  atk: { type: 'ranged', dmg: 5, cd: 0.45, range: 300, speed: 620, r: 6, col: '#cfd3dc' },
  skills: [
    { name: '덫', icon: '🪤', desc: '드래그한 방향 앞쪽 150 지점에 덫을 설치(0.6초 뒤부터 발동, 최대 3개, 12초 유지). 밟은 적은 6 피해 + 1초 속박(이동·대시 불가). 상대에겐 희미하게 보임', cd: 6, ai: { use: 'trap' }, fx: [{ t: 'trap', dist: 150, r: 34, life: 12, maxN: 3, arm: 0.6, dmg: 6, root: 1, col: '#9aa4b8' }] },
    { name: '질풍', icon: '🌪️', desc: '3초간 이동속도 +45%. 덫으로 묶은 적을 쫓거나 거리를 벌릴 때 사용', cd: 10, ai: { use: 'attack', maxD: 330 }, fx: [{ t: 'buff', haste: 1.45, dur: 3, col: '#b9c4d8' }] },
    { name: '참', icon: '🗡️', desc: '드래그한 방향(탭하면 상대 쪽) 직선으로 240을 빠르게 질주하며 지나가는 적을 벰(적마다 1회): 피해 12 + 쓰기 전 인술 스택당 2, 인술 4스택이면 +10 더(최대 30). 질주하는 동안 무적. 벽 앞에서는 멈춤', cd: 8, ai: { use: 'attack', minD: 70, maxD: 240 }, fx: [{ t: 'charge', dist: 240, speed: 1000, w: 56, dmg: 12, perNin: 2, maxBonus: 10, inv: true, col: '#e8edf7' }] },
  ] };
const SHORT = {      // 메뉴에 보이는 간단 설명 (자세히 보기에서는 위 desc/passive 전체 설명)
  assassin: { p: '대시를 2번 할 수 있음, 스킬을 쓰면 다음 기본공격이 강화됨', s: ['단검을 던져 맞으면 상대 뒤로 이동함', '자신에게 오는 모든 피해를 막았다가 반격함', '상대에게 보이지 않으며 평타를 맞지 않음'] },
  warrior: { s: ['상대를 25 피해로 강타함', '최대 체력이 10 증가하며 3초간 받는 피해를 30% 줄임', '날아오는 투사체를 막고 범위 안 상대에게 15 피해'] },
  summoner: { p: '강림 스택을 5개 쌓으면 평타가 강림으로 변하여 용을 소환함 (강림 스택: 평타, 용의 힘으로 쌓음)', s: ['적을 따라가 폭발하며 10의 피해를 주는 체력 10의 구슬 소환', '자신의 기본공격만 통과하는 벽을 5초간 소환', '강림 스택을 1스택 쌓음, 용이 있으면 용과 위치를 교환함'] },
  tank: { p: '총합 70 피해를 받으면 대지강타가 분노 강타로 변함', s: ['3초간 내구도 40의 방패를 듦', '돌진 시 15의 피해, 돌진이 끝나면 원형 범위 기절', '주변 적에게 15의 피해를 주며 둔화 (분노 강타 시 25 피해)'] },
  archer: { s: ['화살 3발을 부채꼴로 발사', '뒤로 물러나며 큰 화살 발사, 맞으면 1초간 속박', '적과 벽을 꿰뚫는 강한 화살'] },
  mage: { s: ['직격 25 피해, 터지면 15 피해', '맞으면 2초간 둔화', '드래그한 방향으로 순간이동'] },
  angel: { p: '평타를 맞힐 때마다 구원 스택(최대 10): 스택당 구원의 회복 +3 · 피해 +2', s: ['내 주변 큰 원: 나·팀원 10+3×스택 회복, 적 10+2×스택 피해 (스택 소모)', '내 자리에 3초간 판결 구역: 안의 적은 40% 느려지고 스킬 사용 불가, 우리 팀은 받는 피해 0.8배', '5초간 금 망치 근접 평타 (피해 12, 적중 시 스택 +2)'] },
  ninja: { p: '스킬, 대쉬 사용시 인술스택이 쌓이며 인술 스택이 쌓일수록 ‘참’피해, 평타 속도와 이동속도가 증가함. 4스택 시 평타 하나가 추가로 더 나가고 ‘참’의 피해가 30으로 증가함', s: ['설치형 덫: 6 피해 + 1초 속박', '질풍: 3초간 이동속도 +45%', '참: 무적으로 직선 질주하며 베기, 12 피해 + 인술 스택당 2 (4스택 최대 30)'] },
  tide: { s: ['적을 내 쪽으로 끌어당기고 15 피해, 쓰면 7초 뒤 밀물로 변함', '3초간 내 자리에 웅덩이: 적은 20% 느려지고 나는 20%, 팀원은 10% 빨라짐', '직선으로 날아가 원이 되고 0.5초 뒤 토네이도: 맞은 상대는 빨려 들어가 20 피해 + 붙잡힘'] },
};
const CHAR_ORDER = ['tank', 'warrior', 'archer', 'mage', 'assassin', 'summoner', 'tide', 'angel', 'ninja'];      // 플레이할 수 있는 캐릭터
// 방향을 정해서 쓰는 스킬인지(드래그 조준 가능) 자동 판별
for (const id of CHAR_ORDER) for (const s of CHARS[id].skills) s.aimed = s.fx.some(f => ['proj', 'cone', 'line', 'charge', 'blink', 'counter', 'aoe', 'pwall', 'pool', 'tornado', 'trap', 'decoy'].includes(f.t));

const PLAY_ORDER = CHAR_ORDER.filter(k => !CHARS[k].soon);      // 지금 고를 수 있는 캐릭터

const DIFFS = {
  easy:   { name: '쉬움',   react: 0.34, dodge: 0.10, skillP: 0.30 },
  normal: { name: '보통',   react: 0.20, dodge: 0.40, skillP: 0.60 },
  hard:   { name: '어려움', react: 0.10, dodge: 0.80, skillP: 0.92 },
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function normAng(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function resolveRect(o, r, w) {
  const cx = clamp(o.x, w.x, w.x + w.w), cy = clamp(o.y, w.y, w.y + w.h);
  let dx = o.x - cx, dy = o.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return false;
  if (d2 > 1e-6) { const d = Math.sqrt(d2); dx /= d; dy /= d; o.x = cx + dx * r; o.y = cy + dy * r; return true; }
  const l = o.x - w.x, rr = w.x + w.w - o.x, t = o.y - w.y, b = w.y + w.h - o.y, m = Math.min(l, rr, t, b);
  if (m === l) o.x = w.x - r; else if (m === rr) o.x = w.x + w.w + r; else if (m === t) o.y = w.y - r; else o.y = w.y + w.h + r;
  return true;
}
// 회전 벽(소환사): 벽 중심 기준 좌표로 돌려서 일반 사각형처럼 처리
function resolveCircleRect(o, r, w) {
  if (w.ca === undefined) return resolveRect(o, r, w);
  const dx0 = o.x - w.cx, dy0 = o.y - w.cy, t = { x: dx0 * w.ca + dy0 * w.sa, y: -dx0 * w.sa + dy0 * w.ca };
  if (!resolveRect(t, r, { x: -w.hw, y: -w.hh, w: 2 * w.hw, h: 2 * w.hh })) return false;
  o.x = w.cx + t.x * w.ca - t.y * w.sa; o.y = w.cy + t.x * w.sa + t.y * w.ca; return true;
}
function wallDist(w, x, y) {      // 점에서 벽까지 거리(안이면 0)
  if (w.ca === undefined) { const cx = clamp(x, w.x, w.x + w.w), cy = clamp(y, w.y, w.y + w.h); return Math.hypot(x - cx, y - cy); }
  const dx0 = x - w.cx, dy0 = y - w.cy, lx = dx0 * w.ca + dy0 * w.sa, ly = -dx0 * w.sa + dy0 * w.ca;
  return Math.hypot(lx - clamp(lx, -w.hw, w.hw), ly - clamp(ly, -w.hh, w.hh));
}
function makeWall(cx, cy, a, fw, fh) {      // 중심 (cx,cy), 방향 a, fw: a 방향 두께, fh: 수직 방향 길이
  const ca = Math.cos(a), sa = Math.sin(a), hw = fw / 2, hh = fh / 2, ex = Math.abs(ca) * hw + Math.abs(sa) * hh, ey = Math.abs(sa) * hw + Math.abs(ca) * hh;
  return { cx, cy, a, ca, sa, hw, hh, fw, fh, x: cx - ex, y: cy - ey, w: 2 * ex, h: 2 * ey };
}
function wallCorners(w) {
  if (w.ca === undefined) return [[w.x, w.y], [w.x + w.w, w.y], [w.x + w.w, w.y + w.h], [w.x, w.y + w.h]];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => { const lx = sx * w.hw, ly = sy * w.hh; return [w.cx + lx * w.ca - ly * w.sa, w.cy + lx * w.sa + ly * w.ca]; });
}
function wallsOverlap(A, B) {      // 분리축 정리
  const pa = wallCorners(A), pb = wallCorners(B);
  for (const P of [pa, pb]) for (let i = 0; i < 2; i++) {
    const nx = -(P[i + 1][1] - P[i][1]), ny = P[i + 1][0] - P[i][0]; let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
    for (const q of pa) { const d = q[0] * nx + q[1] * ny; if (d < a0) a0 = d; if (d > a1) a1 = d; }
    for (const q of pb) { const d = q[0] * nx + q[1] * ny; if (d < b0) b0 = d; if (d > b1) b1 = d; }
    if (a1 <= b0 + 0.01 || b1 <= a0 + 0.01) return false;
  }
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
// 두 지점 사이 직선 경로가 벽에 막히는지 (서버 위치로 맞출 때, 벽 반대편에 갇히지 않게 쓰임)
function pathBlocked(ax, ay, bx, by) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 6));
  for (let i = 1; i < n; i++) { const x = ax + (bx - ax) * i / n, y = ay + (by - ay) * i / n; for (const w of WALLS) if (wallDist(w, x, y) < R - 1) return true; }
  return false;
}
// 반격 삼각형: 시전자 위치가 밑변(폭 w), 조준 방향 len 앞이 꼭지점. (x,y)가 안(여유 pad 포함)에 있는지
function inTri(c, o, x, y, pad) {
  const ca = Math.cos(c.a), sa = Math.sin(c.a), dx = x - o.x, dy = y - o.y, along = dx * ca + dy * sa, perp = Math.abs(-dx * sa + dy * ca);
  return along >= -pad && along <= c.len + pad && perp <= (c.w / 2) * (1 - Math.max(0, along) / c.len) + pad;
}
const LAG = 0.12;      // 온라인 판정 보정(초)
const isRoot = p => p.slowT > 0 && p.slowMul === 0;      // 속박: 이동·대시·이동기 불가, 공격·그 밖의 스킬은 가능
const moveSkill = sk => sk.fx.some(f => f.t === 'blink' || f.t === 'charge' || f.t === 'rewind');
const tornPos = (g, p, f, ang) => [clamp(p.x + Math.cos(ang) * f.max, 20, W - 20), clamp(p.y + Math.sin(ang) * f.max, 20, H - 20)];      // 용오름: 사거리 끝(231)에 고정, 방향만 정함
const tornDist = (f, fr) => (typeof fr === 'number' ? f.min + (f.max - f.min) * clamp(fr, 0, 1) : f.dist);      // 드래그 길이(0~1)로 정한 설치 거리
const atkOf = p => (p.tm && p.ch.hammer) ? p.ch.hammer.atk : p.ch.atk;      // 천사: 심판(금 망치) 중에는 근접 망치 평타
const skOf = (p, i) => (i === 0 && p.tm && p.ch.skills[0].alt) ? p.ch.skills[0].alt : p.ch.skills[i];      // 1번 스킬이 둘로 바뀌는 캐릭터(조류술사: 썰물↔밀물)
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
const freshWant = () => ({ dash: 0, sk: [0, 0, 0], angs: [null, null, null], dists: [null, null, null], dd: null });

function mkPlayer(idx, charId) {
  const ch = CHARS[charId];
  return { idx, team: idx, ch, x: 0, y: 0, vx: 0, vy: 0, aim: 0, hp: ch.hp, maxHp: ch.hp, alive: true, atkCd: 0, skCd: [0, 0, 0],
    dashCd: 0, dashT: 0, dx: 1, dy: 0, inv: 0, stun: 0, slowT: 0, slowMul: 1, sil: 0, shield: 0, shieldMax: 0, shieldT: 0, dr: 0, drT: 0, haste: 0, hasteMul: 1, charge: null, guard: null, tm: 0, hm: 0, kb: null,
    atkHold: false, atkBuf: 0, atkAng: null, hits: 0, adv: false, orbSk: -1, dashN: ch.dashN || 0, stl: 0, stlI: -1, emp: false, cnt: null, seenX: 0, seenY: 0,
    inp: { mx: 0, my: 0 }, want: freshWant(), taken: 0, rage: false,
    think: 0, strafe: 1, strafeT: 0, stuckT: 0, lx: 0, ly: 0, unstick: 0, unstickAng: 0 };
}

class Game {
  constructor(myChar, aiChar, diffKey, mapId, chars) {
    this.diff = DIFFS[diffKey] || DIFFS.normal; this.setMap(mapId);
    this.quad = !!(chars && chars.length === 4);      // 2대2: chars = 4명의 캐릭터(0·1번이 한 팀, 2·3번이 다른 팀)
    this.players = this.quad ? chars.map((c, i) => { const p = mkPlayer(i, c); p.team = i < 2 ? 0 : 1; return p; }) : [mkPlayer(0, myChar), mkPlayer(1, aiChar)];
    this.practice = false;    // true면 연습 모드: 1번은 가만히 서 있는 체력 무한 인형, 시간 제한·라운드 종료 없음
    this.auto0 = false;       // true면 0번(사람 자리)도 AI가 조작 (테스트용)
    this.remote = false;      // true면 1번도 사람(온라인 상대)이 조작: AI를 쓰지 않음
    this.ev = []; this.fx = []; this.bullets = []; this.zones = []; this.pools = []; this.minions = []; this.mid = 0;
    this.startMatch();
  }
  foes(p) { return this.players.filter(q => q.team !== p.team); }      // 상대 팀 사람들
  nearFoe(team, x, y) {      // (x,y)에서 가장 가까운 상대 팀 플레이어(살아 있는 사람 우선, 은신한 사람은 마지막으로 보인 자리 기준)
    let best = null, bd = 1e9;
    for (const q of this.players) { if (q.team === team) continue; const hid = q.stl > 0, d = Math.hypot((hid ? q.seenX : q.x) - x, (hid ? q.seenY : q.y) - y) + (q.alive ? 0 : 1e6); if (d < bd) { bd = d; best = q; } }
    return best;
  }
  foe(p) { return this.nearFoe(p.team, p.x, p.y); }
  setMap(id) { this.mapId = MAPS[id] ? id : 'basic'; this.map = MAPS[this.mapId]; this.baseWalls = this.map.walls; this.pw = []; this.walls = this.baseWalls; WALLS = this.walls; }
  rebuildWalls() { this.walls = this.pw.length ? this.baseWalls.concat(this.pw) : this.baseWalls; WALLS = this.walls; }      // 맵 벽 + 소환사가 세운 벽
  startMatch() {
    this.score = [0, 0]; this.round = 1; this.matchWinner = -1;
    for (const p of this.players) p.maxHp = p.ch.hp;     // 영구 체력 증가는 한 판(매치) 동안만 유지
    this.startRound();
  }
  startRound() {
    for (const p of this.players) {
      const sp0 = (this.quad ? SPAWN4 : SPAWN)[p.idx]; p.x = sp0.x; p.y = sp0.y; p.vx = p.vy = 0; p.aim = p.team === 0 ? 0 : Math.PI;
      p.maxHp = p.ch.hp; p.hp = p.maxHp; p.alive = true; p.atkCd = 0.5;      // 함성 등으로 늘어난 최대 체력은 라운드가 끝나면 초기화
      p.atkBuf = 0; p.skCd = [0, 0, 0]; p.dashCd = 0; p.dashT = 0; p.inv = 0; p.stun = 0; p.dashN = p.ch.dashN || 0; p.stl = 0; p.stlI = -1; p.emp = false; p.cnt = null; p.taken = 0; p.rage = false; p.seenX = p.x; p.seenY = p.y;
      p.slowT = 0; p.sil = 0; p.shield = 0; p.shieldT = 0; p.dr = 0; p.drT = 0; p.haste = 0; p.charge = null; p.guard = null; p.kb = null; p.tm = 0; p.hm = 0; p.inp = { mx: 0, my: 0 }; p.want = freshWant();
      p.hist = []; p.histT = 0; p.pend2 = null; p.nin = 0; p.ninT = 0; p.think = 0.4; p.stuckT = 0; p.lx = p.x; p.ly = p.y; p.unstick = 0; p.atkAng = null; p.hits = 0; p.adv = false; p.orbSk = -1;
    }
    this.minions = []; this.pw = []; this.pools = []; this.rebuildWalls();
    this.bullets = []; this.fx = []; this.zones = []; this.fightT = 0; this.res = null; this.ph = 'count'; this.timer = COUNT_TIME;
    const m = this.map; this.bolts = []; this.boltT = m.bolt ? m.bolt.first : 0; this.heatT = m.heat ? m.heat.every : 0; this.ess = m.ess ? { up: false, t: m.ess.first } : null;
  }
  setMove(mx, my) { this.players[0].inp = { mx, my }; }
  pressDash() { this.pressDashP(0); }
  pressSkill(i, ang, fr) { this.pressSkillP(0, i, ang, fr); }
  pressAttack(ang) { this.pressAttackP(0, ang); }
  // 플레이어 번호를 지정하는 입력 (온라인 대전에서 1번 입력용)
  pressDashP(k, dx, dy) { if (this.ph === 'fight') { const w = this.players[k].want; w.dash = 1; const l = Math.hypot(dx, dy); w.dd = l > 0.2 ? [dx / l, dy / l] : null; } }      // dx,dy: 누른 사람 화면에서 정한 대시 방향(서버가 늦게 받아도 같은 방향으로 감)
  pressSkillP(k, i, ang, fr) { if (this.ph === 'fight' && i >= 0 && i < 3) { const w = this.players[k].want; w.sk[i] = 1; w.angs[i] = typeof ang === 'number' ? ang : null; w.dists[i] = typeof fr === 'number' ? fr : null; } }
  pressAttackP(k, ang) { if (this.ph === 'fight') { this.players[k].atkBuf = ATK_BUFFER; this.players[k].atkAng = typeof ang === 'number' ? ang : null; } }

  update(dt) {
    WALLS = this.walls;
    for (const f of this.fx) f.life -= dt;
    this.fx = this.fx.filter(f => f.life > 0);
    if (this.ph === 'count') {
      this.timer -= dt;
      for (const p of this.players) { const e = this.foe(p); p.aim = Math.atan2(e.y - p.y, e.x - p.x); }
      if (this.timer <= 0) { this.ph = 'fight'; this.fightT = 0; }
    } else if (this.ph === 'fight') {
      this.fightT += dt; this.stepFight(dt);
      if (this.practice) { const d = this.players[1], sp = SPAWN[1]; d.hp = d.maxHp; d.alive = true; d.stun = 0; d.slowT = 0; d.slowMul = 1; d.charge = null; d.inp = { mx: 0, my: 0 }; d.x = sp.x; d.y = sp.y; d.vx = d.vy = 0; this.players[0].hp = Math.max(this.players[0].hp, 1); this.fightT = 0; this.res = null; this.ph = 'fight'; }      // 연습 인형은 죽지도 움직이지도 않음
    }
    else if (this.ph === 'end') {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.score.some(s => s >= WIN)) { this.ph = 'over'; this.matchWinner = this.score[0] >= WIN ? 0 : 1; }      // 점수는 팀 기준(0: 왼쪽 팀, 1: 오른쪽 팀)
        else { this.round++; this.startRound(); }
      }
    }
  }

  clearR(x1, y1, x2, y2, r) {      // 반지름 r짜리 몸이 벽에 안 걸리고 갈 수 있는 직선인지
    const d = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.ceil(d / 8));
    for (let i = 0; i <= n; i++) {
      const x = x1 + (x2 - x1) * i / n, y = y1 + (y2 - y1) * i / n;
      for (const w of WALLS) if (wallDist(w, x, y) < r) return false;
    }
    return true;
  }
  navDir(p, tx, ty) {      // 목표 쪽으로 갈 방향(단위벡터). 벽에 막히면 격자 길찾기(BFS)로 돌아가는 길을 찾음
    const dx = tx - p.x, dy = ty - p.y, dd = Math.hypot(dx, dy) || 1, S = 20, C = Math.ceil(W / S), Rw = Math.ceil(H / S), rr0 = R + 3;
    if (this.clearR(p.x, p.y, tx, ty, rr0)) return [dx / dd, dy / dd];
    if (this._gw !== this.walls) {
      this._gw = this.walls; const g = new Uint8Array(C * Rw);
      for (let j = 0; j < Rw; j++) for (let i = 0; i < C; i++) { const x = i * S + S / 2, y = j * S + S / 2; let b = x < R || x > W - R || y < R || y > H - R; if (!b) for (const w of this.walls) if (wallDist(w, x, y) < rr0) { b = true; break; } g[j * C + i] = b ? 1 : 0; }
      this._g = g;
    }
    const g = this._g, si = clamp(Math.floor(p.x / S), 0, C - 1), sj = clamp(Math.floor(p.y / S), 0, Rw - 1), prev = new Int32Array(C * Rw).fill(-2), q = [sj * C + si]; prev[q[0]] = -1;
    let goal = -1;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], ci = c % C, cj = (c - ci) / C;
      if (Math.hypot(ci * S + S / 2 - tx, cj * S + S / 2 - ty) < S * 1.6 && (g[c] === 0 || h === 0)) { goal = c; break; }
      for (let k = 0; k < 8; k++) {
        const ox = [1, -1, 0, 0, 1, 1, -1, -1][k], oy = [0, 0, 1, -1, 1, -1, 1, -1][k], ni = ci + ox, nj = cj + oy;
        if (ni < 0 || nj < 0 || ni >= C || nj >= Rw) continue; const nc = nj * C + ni; if (prev[nc] !== -2 || g[nc]) continue;
        if (k >= 4 && (g[cj * C + ni] || g[nj * C + ci])) continue;      // 모서리 가로지르기 금지
        prev[nc] = c; q.push(nc);
      }
    }
    if (goal < 0) return [dx / dd, dy / dd];
    const path = []; for (let c = goal; c >= 0; c = prev[c]) path.push(c); path.reverse();      // 시작 → 목표
    let pick = path[Math.min(path.length - 1, 3)];      // 몇 칸 앞 지점을 향해 감(바로 앞 모서리에 걸리지 않게)
    for (let k = Math.min(path.length - 1, 7); k >= 1; k--) { const c = path[k], x = (c % C) * S + S / 2, y = Math.floor(c / C) * S + S / 2; if (this.clearR(p.x, p.y, x, y, rr0 - 1)) { pick = c; break; } }
    const wx = (pick % C) * S + S / 2 - p.x, wy = Math.floor(pick / C) * S + S / 2 - p.y, wl = Math.hypot(wx, wy) || 1;
    return [wx / wl, wy / wl];
  }
  clear(x1, y1, x2, y2, own) {      // own: 이 플레이어가 세운 벽은 통과로 침(소환사 평타)
    const d = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.ceil(d / 10));
    for (let i = 1; i < n; i++) {
      const x = x1 + (x2 - x1) * i / n, y = y1 + (y2 - y1) * i / n;
      for (const w of WALLS) if (!(own != null && w.own === own) && wallDist(w, x, y) < 6) return false;
    }
    return true;
  }

  dealDamage(src, t, dmg, o) {
    if (!t.alive || t.dashT > 0 || t.inv > 0) return false;
    if (t.cnt && src !== t) { this.blockedBy(t); return false; }      // 반격 중에는 어떤 공격(방향·거리 상관없이)도 막음
    let a = dmg * (this.fightT > OT_START ? OT_DMG_MUL : 1);   // 서든데스 규칙: 모든 데미지 2배
    if (t.drT > 0) a *= 1 - t.dr;      // 받는 피해 감소 버프(전사의 함성)
    const lawMul = this.pools.some(z => z.kind === 'pool' && z.f.sil && this.players[z.owner].team === t.team && Math.hypot(z.x - t.x, z.y - t.y) <= z.r) ? 0.8 : 1; a *= lawMul;
    if (t.ch.rageAt && !t.rage) { t.taken += a; if (t.taken >= t.ch.rageAt) { t.rage = true; t.taken = 0; this.ev.push({ k: 'text', x: t.x, y: t.y - 36, txt: '분노!', col: '#ffd24a' }); } }      // 탱커: 받은 피해(보호막이 막은 양 포함)가 쌓이면 분노
    if (t.shieldT > 0 && t.shield > 0) { const ab = Math.min(t.shield, a); t.shield -= ab; a -= ab; if (t.shield <= 0) { const si = t.ch.skills.findIndex(k => k.fx.some(f => f.t === 'shield')); if (si >= 0) t.skCd[si] = Math.max(0, t.skCd[si] - t.shieldT); t.shieldT = 0; } }      // 방패가 깨지면 그때부터 쿨타임
    t.hp -= a;
    if (o && o.stun) { t.stun = Math.max(t.stun, o.stun); t.charge = null; t.cnt = null; }
    if (o && o.slowT) { t.slowT = Math.max(t.slowT, o.slowT); t.slowMul = o.slowMul != null ? o.slowMul : 0.5; }
    this.ev.push({ k: 'hit', x: t.x, y: t.y - 8, d: Math.round(dmg * (this.fightT > OT_START ? OT_DMG_MUL : 1) * (t.drT > 0 ? 1 - t.dr : 1) * lawMul), to: t.idx });
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
        life: f.life || 1.4, col: f.col || null, hit: false, basic: !!f.basic, tp: !!f.tp, hom: f.hom || 0, pass: !!f.pass, push: f.push || 0, pull: f.pull || 0, wallDmg: f.wallDmg || 0, wp: !!f.wp, wallStun: f.wallStun || 0, carry: !!f.carry });
    }
  }
  knock(src, t, b) {      // 밀치기/끌어당기기: 잠깐 움직이게 함. 벽(맵 가장자리 포함)에 막히면 추가 피해(밀물)
    let dx, dy, dist;
    if (b.pull) { dx = src.x - t.x; dy = src.y - t.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; dist = Math.min(b.pull, Math.max(0, l - (2 * R + 6))); }
    else { const sp = Math.hypot(b.vx, b.vy) || 1; dx = b.vx / sp; dy = b.vy / sp; dist = b.push; }
    if (dist <= 0) return;
    const cl = b.carry ? Math.max(0.1, b.life) : 0.2, csp = b.carry ? Math.hypot(b.vx, b.vy) : dist / 0.2;      // 밀물: 파도가 끝날 때까지 파도와 함께 밀려감
    t.kb = { dx, dy, left: cl, speed: csp, wall: b.pull ? 0 : (b.wallDmg || 0), stun: b.pull ? 0 : (b.wallStun || 0), src, hitW: false };
    if (b.pull) { b.pulled = true; this.fx.push({ k: 'tether', x: t.x, y: t.y, follow: src.idx, len: dist, w: 0, life: 0.28, max: 0.28, col: '#7fd3ff' }); }
    t.charge = null; t.cnt = null; t.guard = null;
  }
  makeTornado(p, x, y, f, delay) {      // 직선이 끝난 자리에 원(예고 0.5초) → 토네이도
    const zx = clamp(x, 20, W - 20), zy = clamp(y, 20, H - 20);
    const dl = delay != null ? delay : f.delay;
    this.pools.push({ kind: 'tornado', owner: p.idx, x: zx, y: zy, r: f.r, t: dl, max: dl, f });
    this.fx.push({ k: 'bolt', x: zx, y: zy, r: f.r, life: dl, max: dl, tz: p.idx, follow: p.idx, col: '#4aa8ff' });
  }
  tornPull(b, t) {      // 직선에 맞은 상대는 원 중심으로 빨려 들어감
    const dx = b.ex - t.x, dy = b.ey - t.y, d = Math.hypot(dx, dy); if (d < 6) return;
    const left = Math.max(0.12, b.life); t.kb = { dx: dx / d, dy: dy / d, left, speed: d / left, wall: 0, src: this.players[b.owner], hitW: false };
    t.charge = null; t.cnt = null; t.guard = null;
  }
  stepPools(dt) {      // 웅덩이(적 둔화·내 이속 증가), 용오름(예고 뒤 토네이도)
    if (!this.pools.length) return;
    for (const z of this.pools) {
      z.t -= dt; const o = this.players[z.owner], F = z.f;
      if (z.kind === 'tornado') {
        if (z.t <= 0 && !z.fired) {
          z.fired = true;
          this.fx.push({ k: 'whirl', x: z.x, y: z.y, r: z.r, life: F.hold, max: F.hold, col: F.col });
          for (const q of this.foes(o)) if (q.alive && Math.hypot(q.x - z.x, q.y - z.y) <= z.r + R) { if (this.dealDamage(o, q, F.dmg, { stun: F.hold })) { q.vx = q.vy = 0; q.kb = null; } }
          this.hitMinions(z.owner, m => Math.hypot(m.x - z.x, m.y - z.y) <= z.r + m.r, F.dmg);
        }
        continue;
      }
      if (z.kind === 'trap') {      // 덫: 무장된 뒤 밟은 적에게 피해 + 속박
        if (z.arm > 0) { z.arm -= dt; continue; }
        for (const q of this.foes(o)) if (q.alive && q.dashT <= 0 && q.inv <= 0 && Math.hypot(q.x - z.x, q.y - z.y) <= z.r + 8) {
          this.fx.push({ k: 'ring', x: z.x, y: z.y, r: z.r + 20, life: 0.3, max: 0.3, col: '#cfd3dc' }); this.ev.push({ k: 'text', x: q.x, y: q.y - 30, txt: '덫!', col: '#cfd3dc' });
          this.dealDamage(o, q, F.dmg, null); q.slowT = Math.max(q.slowT, z.root); q.slowMul = 0; q.charge = null; q.cnt = null;
          z.t = 0; if (z.fo) z.fo.life = 0; break;
        }
        continue;
      }
      for (const q of this.players) {
        if (!q.alive) continue;
        if (Math.hypot(z.x - q.x, z.y - q.y) > z.r) continue;
        if (q.team === o.team) { const hm = q === o ? F.haste : F.allyHaste; if (hm && !(q.haste > 0.3 && q.hasteMul > hm)) { q.haste = Math.max(q.haste, 0.3); q.hasteMul = hm; } }      // 시전자 +20%, 같은 팀 +10%
        else if (q.dashT <= 0 && q.inv <= 0) { if (!(q.slowT > 0.3 && q.slowMul < F.slow)) { q.slowT = Math.max(q.slowT, 0.3); q.slowMul = F.slow; } if (F.sil) q.sil = Math.max(q.sil, 0.3); }      // 법률: 느려지고 스킬 봉인
      }
    }
    this.pools = this.pools.filter(z => z.t > 0);
  }
  explode(b, noDmg) {      // noDmg: 직격으로 이미 피해를 줬을 때는 폭발 효과만(피해 2번 방지)
    this.fx.push({ k: 'ring', x: b.x, y: b.y, r: b.aoe, life: 0.3, max: 0.3, col: b.col || '#ff8a4a' });
    if (!noDmg) for (const e of this.foes(this.players[b.owner])) if (e.alive && Math.hypot(e.x - b.x, e.y - b.y) <= b.aoe + R) this.dealDamage(this.players[b.owner], e, b.aoeDmg != null ? b.aoeDmg : b.dmg, b);
    if (!noDmg) this.hitMinions(b.owner, m => Math.hypot(m.x - b.x, m.y - b.y) <= b.aoe + m.r, b.aoeDmg != null ? b.aoeDmg : b.dmg);
  }
  chargeEnd(p, c) {      // 끝까지 돌진하면 도착 지점에서 원형 범위 기절
    if (!c.endR) return;
    if (c.soft) {      // 날개짓: 도착하면 가까운 적을 밀쳐냄 (피해 없음)
      this.fx.push({ k: 'ring', x: p.x, y: p.y, r: c.endR, life: 0.35, max: 0.35, col: c.col || '#fff3b0' });
      for (const e of this.foes(p)) if (e.alive && e.dashT <= 0 && e.inv <= 0 && Math.hypot(e.x - p.x, e.y - p.y) <= c.endR + R) {
        const dx = e.x - p.x, dy = e.y - p.y, l = Math.hypot(dx, dy) || 1;
        e.kb = { dx: dx / l, dy: dy / l, left: 0.4, tot: 0.4, ease: true, speed: c.push / 0.4, wall: 0, stun: 0, src: p, hitW: false }; e.charge = null; e.cnt = null; e.guard = null;      // 처음엔 빠르게 밀리다 점점 느려지며 멈춤(넉백)
        this.fx.push({ k: 'ring', x: e.x, y: e.y, r: 34, life: 0.3, max: 0.3, col: '#ffffff' });
      }
      return;
    }
    this.fx.push({ k: 'ring', x: p.x, y: p.y, r: c.endR, life: 0.4, max: 0.4, col: c.col || '#5b8def' });
    this.hitMinions(p.idx, m => Math.hypot(m.x - p.x, m.y - p.y) <= c.endR + m.r, c.dmg);
    for (const e of this.foes(p)) if (e.alive && e.dashT <= 0 && e.inv <= 0 && Math.hypot(e.x - p.x, e.y - p.y) <= c.endR + R) {
      if (!(c.hits ? c.hits.has(e.idx) : c.hit)) this.dealDamage(p, e, c.dmg, Object.assign({}, c, { stun: 0 }));      // 경로에서 안 맞았다면 원 안에서 12 피해 (한 번만)
      if (!e.alive) continue;
      e.stun = Math.max(e.stun, c.endStun); e.charge = null; this.ev.push({ k: 'text', x: e.x, y: e.y - 30, txt: '기절!', col: '#ffd24a' }); }
  }
  hitT(e, f) {      // 범위 판정. 온라인(서버)에서는 지연 때문에 화면과 서버 위치가 어긋나므로: 몸 판정을 줄이고, 현재 위치와 '조금 앞선 위치' 둘 다 범위 안일 때만 맞음
    if (!this.remote) return f(e.x, e.y, R);
    const pd = R * 0.6; return f(e.x, e.y, pd) && f(e.x + (e.vx || 0) * LAG, e.y + (e.vy || 0) * LAG, pd);
  }
  coneHit(p, range, arc, dmg, o, ang) {
    const A = typeof ang === 'number' ? ang : p.aim, life = (o && o.guard) || 0.2;
    this.fx.push({ k: 'cone', x: p.x, y: p.y, a: A, arc, r: range, life, max: life, col: (o && o.col) || '#e8edf7', follow: o && o.guard ? p.idx : -1, fist: !o && !!p.ch.atk.fist });
    let n = 0;
    for (const e of this.foes(p)) { if (e.alive && this.hitT(e, (x, y, pd) => Math.hypot(x - p.x, y - p.y) <= range + pd && Math.abs(normAng(Math.atan2(y - p.y, x - p.x) - A)) <= arc / 2)) { if (this.dealDamage(p, e, dmg, o)) n++; } }
    this.hitMinions(p.idx, m => Math.hypot(m.x - p.x, m.y - p.y) <= range + m.r && Math.abs(normAng(Math.atan2(m.y - p.y, m.x - p.x) - A)) <= arc / 2, dmg);
    return n;
  }
  lineArea(src, x, y, A, len, width, dmg, o) {      // 고정 위치의 직선 범위를 지금 판정
    this.fx.push({ k: 'line', x, y, a: A, len, w: width, life: 0.25, max: 0.25, col: (o && o.col) || '#e8edf7' });
    const c = Math.cos(A), s = Math.sin(A);
    for (const e of this.foes(src)) {
      if (e.alive && this.hitT(e, (qx, qy, pd) => { const ex = qx - x, ey = qy - y, along = ex * c + ey * s, perp = Math.abs(-ex * s + ey * c); return along >= -pd && along <= len + pd && perp <= width / 2 + pd; })) this.dealDamage(src, e, dmg, o);
    }
    this.hitMinions(src.idx, m => { const mx = m.x - x, my = m.y - y, al = mx * c + my * s, pe = Math.abs(-mx * s + my * c); return al >= -m.r && al <= len + m.r && pe <= width / 2 + m.r; }, dmg);
  }
  lineHit(p, len, width, dmg, o, ang) { this.lineArea(p, p.x, p.y, typeof ang === 'number' ? ang : p.aim, len, width, dmg, o); }
  stepZones(dt) {      // 선딜이 있는 범위 스킬: 범위가 먼저 보이고, 시간이 지나면 그 자리에서 판정(그 사이 벗어나거나 대시로 피하면 안 맞음)
    for (const z of this.zones) {
      z.t -= dt;
      if (z.t <= 0) { z.done = true; this.lineArea(this.players[z.owner], z.x, z.y, z.a, z.len, z.w, z.dmg, z.o); }
    }
    this.zones = this.zones.filter(z => !z.done);
  }
  useSkill(p, i, angArg, frArg) {
    const sk = skOf(p, i), aimed = typeof angArg === 'number', ang = aimed ? angArg : p.aim, n0 = p.nin | 0;      // n0: 이 스킬을 쓰기 전 인술 스택
    if (i === 0 && p.ch.skills[0].alt) p.tm = p.tm ? 0 : 1;      // 썰물을 쓰면 밀물로, 밀물을 쓰면 썰물로 (쿨타임 7초가 지나면 그 스킬을 쓸 수 있음)
    if (p.stl > 0 && !sk.fx.some(f => f.t === 'stealth')) this.endStealth(p);      // 스킬을 쓰면 은신이 풀림
    if (p.ch.empAtk) p.emp = true;      // 스킬을 쓰면 다음 기본공격 강화
    p.skCd[i] = sk.cd;                 // 시전하자마자 쿨타임이 돌기 시작
    this.ninGain(p);      // 닌자 인술 +1
    this.ev.push({ k: 'skill', p: p.idx, i });
    for (const f of sk.fx) {
      if (f.t === 'proj') this.fireProj(p, f, ang);
      else if (f.t === 'aoe') {
        const rg = !!(f.rageDmg && p.rage); if (rg) { p.rage = false; p.taken = 0; }      // 분노의 강타: 한 번 쓰면 원래대로
        this.fx.push({ k: 'ring', x: p.x, y: p.y, r: f.radius * (rg ? 1.1 : 1), life: rg ? 0.45 : 0.3, max: rg ? 0.45 : 0.3, col: rg ? '#ffd24a' : (f.col || '#ffffff') });
        for (const e of this.foes(p)) if (e.alive && Math.hypot(e.x - p.x, e.y - p.y) <= f.radius * (rg ? 1.1 : 1) + R) this.dealDamage(p, e, rg ? f.rageDmg : f.dmg, f);
        this.hitMinions(p.idx, m => Math.hypot(m.x - p.x, m.y - p.y) <= f.radius * (rg ? 1.1 : 1) + m.r, rg ? f.rageDmg : f.dmg);
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
      else if (f.t === 'pool') {      // 조류술사 웅덩이: 내 자리에 설치, 만들어질 때 안에 있는 적에게 피해
        const zx = clamp(p.x + Math.cos(ang) * f.dist, 20, W - 20), zy = clamp(p.y + Math.sin(ang) * f.dist, 20, H - 20);
        this.pools.push({ kind: 'pool', owner: p.idx, x: zx, y: zy, r: f.r, t: f.dur, max: f.dur, f });
        if (f.sil) p.skCd[i] = sk.cd + f.dur;      // 법률: 구역이 끝난 뒤부터 쿨타임(구역 중엔 버튼에 풀 쿨타임 표시)
        this.fx.push({ k: 'pool', x: zx, y: zy, r: f.r, life: f.dur, max: f.dur, col: f.col, follow: p.idx });
        if (f.dmg) { for (const e of this.foes(p)) if (e.alive && Math.hypot(e.x - zx, e.y - zy) <= f.r + R) this.dealDamage(p, e, f.dmg, null); this.hitMinions(p.idx, m => Math.hypot(m.x - zx, m.y - zy) <= f.r + m.r, f.dmg); }
      } else if (f.t === 'tornado') {      // 용오름: 작은 원이 먼저 보이고(번개처럼) 잠시 뒤 토네이도
        const [zx, zy] = tornPos(this, p, f, ang, aimed ? frArg : undefined), a2 = Math.atan2(zy - p.y, zx - p.x), len = Math.max(30, Math.hypot(zx - p.x, zy - p.y) - (R + 4));
        this.fireProj(p, { dmg: 0, speed: f.speed, r: f.pr, life: len / f.speed, col: f.col }, a2);
        const tb = this.bullets[this.bullets.length - 1]; tb.torn = f; tb.ex = zx; tb.ey = zy;      // 직선으로 날아가다 끝나면 원(토네이도)이 됨
      }
      else if (f.t === 'counter') {
        p.cnt = { a: ang, t: f.block, len: f.len, w: f.w, hit: f.hit, miss: f.miss, blocked: false, col: f.col };
        this.fx.push({ k: 'tri', x: p.x, y: p.y, a: ang, len: f.len, w: f.w, life: f.block, max: f.block, col: f.col || '#ff6b6b' });
      } else if (f.t === 'stealth') {
        p.stl = f.dur; p.stlI = i; p.stlMul = f.speed; p.skCd[i] = sk.cd + f.dur;      // 은신이 끝난 뒤부터 쿨타임
        this.fx.push({ k: 'ring', x: p.x, y: p.y, r: 44, life: 0.35, max: 0.35, col: '#9aa4b8' });
      }
      else if (f.t === 'shield') { p.shield = f.amount; p.shieldMax = f.amount; p.shieldT = f.dur; p.skCd[i] = sk.cd + f.dur; }      // 방패가 끝난 뒤부터 쿨타임(방패 중엔 화면에 풀 쿨타임으로 표시)
      else if (f.t === 'buff') {
        if (f.haste) { p.haste = f.dur; p.hasteMul = f.haste; }
        if (f.dr) { p.dr = f.dr; p.drT = f.dur; }
        if (f.maxHp) { p.maxHp += f.maxHp; p.hp += f.maxHp; this.ev.push({ k: 'text', x: p.x, y: p.y - 30, txt: '최대 체력 +' + f.maxHp, col: '#ffd24a' }); }
        this.fx.push({ k: 'ring', x: p.x, y: p.y, r: 60, life: 0.4, max: 0.4, col: f.col || '#ffd24a' });
      } else if (f.t === 'trap') {      // 닌자 덫: 앞쪽에 설치, 적이 밟으면 피해 + 속박
        const zx = clamp(p.x + Math.cos(ang) * f.dist, 20, W - 20), zy = clamp(p.y + Math.sin(ang) * f.dist, 20, H - 20), r = f.r;
        const mine = this.pools.filter(z => z.owner === p.idx && z.kind === 'trap'); while (mine.length >= f.maxN) { const o = mine.shift(); o.t = 0; if (o.fo) o.fo.life = 0; }
        const fo = { k: 'trap', x: zx, y: zy, r, life: f.life, max: f.life, col: f.col, follow: p.idx };
        this.fx.push(fo); this.pools.push({ kind: 'trap', owner: p.idx, x: zx, y: zy, r, t: f.life, max: f.life, arm: f.arm, f, root: f.root, fo });
      } else if (f.t === 'decoy') {      // 닌자 분신 포대: 한 자리에 서서 사거리 안의 적에게 자동 사격
        let zx = clamp(p.x + Math.cos(ang) * f.dist, 20, W - 20), zy = clamp(p.y + Math.sin(ang) * f.dist, 20, H - 20); if (!this.clear(p.x, p.y, zx, zy)) { zx = p.x + Math.cos(ang) * 40; zy = p.y + Math.sin(ang) * 40; }
        const mine = this.minions.filter(m => m.owner === p.idx && m.kind === 'nin' && m.hp > 0); while (mine.length >= f.maxN) mine.shift().hp = 0;
        this.minions.push({ id: ++this.mid, kind: 'nin', owner: p.idx, x: zx, y: zy, vx: 0, vy: 0, hp: 1, maxHp: 1, r: R, life: f.life, maxLife: f.life, f, aim: ang, fire: 0, fireT: 0.4, guard: 0 });
        this.fx.push({ k: 'ring', x: zx, y: zy, r: 36, life: 0.3, max: 0.3, col: '#cfd3dc' });
      } else if (f.t === 'detonate') {      // 결계 격발: 덫·분신을 모두 터뜨림 (둘 다 있으면 피해 +25%)
        const traps = this.pools.filter(z => z.owner === p.idx && z.kind === 'trap'), cl = this.minions.filter(m => m.owner === p.idx && m.kind === 'nin' && m.hp > 0), mul = traps.length && cl.length ? f.combo : 1;
        const blast = (x, y, r, dmg, root) => { this.fx.push({ k: 'ring', x, y, r, life: 0.35, max: 0.35, col: '#e8edf7' }); for (const q of this.foes(p)) if (q.alive && Math.hypot(q.x - x, q.y - y) <= r + R) { if (this.dealDamage(p, q, dmg * mul, null) && root) { q.slowT = Math.max(q.slowT, root); q.slowMul = 0; q.charge = null; q.cnt = null; } } };
        for (const z of traps) { blast(z.x, z.y, f.trapR, f.trapDmg, f.trapRoot); z.t = 0; if (z.fo) z.fo.life = 0; }
        for (const m of cl) { blast(m.x, m.y, f.cloneR, f.cloneDmg, 0); m.hp = 0; }
        this.ev.push({ k: 'text', x: p.x, y: p.y - 36, txt: mul > 1 ? '결계 격발 · 콤보!' : '결계 격발!', col: '#e8edf7' });
      } else if (f.t === 'charge') {
        const cp = chargePath(p, ang, f.dist);      // 벽이 있으면 거기까지만 돌진
        p.charge = { dx: Math.cos(ang), dy: Math.sin(ang), speed: f.speed, left: cp.d / f.speed, dmg: f.dmg + (f.perNin || 0) * n0 + (p.ch.ninjutsu && n0 >= p.ch.ninjutsu.max ? (f.maxBonus || 0) : 0), stun: f.stun || 0, w: f.w || 52, endR: f.endR || 0, endStun: f.endStun || 0, hit: false, col: f.col, soft: !!f.soft, push: f.push || 0 };
        if (f.inv) p.inv = Math.max(p.inv, cp.d / f.speed + 0.05);      // 날개짓: 날아가는 동안 무적
        const T = cp.d / f.speed + 0.1;      // 돌진하는 동안 경로(사각)와 도착 원을 모두에게 보여줌
        this.fx.push({ k: 'tele', x: p.x, y: p.y, a: ang, len: cp.d, w: f.w || 52, life: T, max: T, col: f.col || '#5b8def' });
        if (f.endR) this.fx.push({ k: 'teleC', x: cp.x, y: cp.y, r: f.endR, life: T, max: T, col: f.col || '#5b8def' });
      }
      else if (f.t === 'salv') {      // 천사 구원: 내 주변 큰 원 — 나·팀원 회복, 적 피해 (스택 10 + 3·2 / 10 + 2·2)
        const stk = Math.min(p.ch.stackMax || 0, p.hits | 0), heal = f.base + f.healPer * stk, dmg = f.base + f.dmgPer * stk;
        this.fx.push({ k: 'ring', x: p.x, y: p.y, r: f.radius, life: 0.55, max: 0.55, col: f.col });
        this.fx.push({ k: 'ring', x: p.x, y: p.y, r: f.radius * 0.6, life: 0.4, max: 0.4, col: '#ffffff' });
        for (const q of this.players) if (q.team === p.team && q.alive && Math.hypot(q.x - p.x, q.y - p.y) <= f.radius + R) {
          const b4 = q.hp; q.hp = Math.min(q.maxHp, q.hp + heal);
          if (q.hp > b4) this.ev.push({ k: 'text', x: q.x, y: q.y - 30, txt: '+' + Math.round(q.hp - b4), col: '#6be08a' });
        }
        for (const e of this.foes(p)) if (e.alive && Math.hypot(e.x - p.x, e.y - p.y) <= f.radius + R) this.dealDamage(p, e, dmg, null);
        this.hitMinions(p.idx, m => Math.hypot(m.x - p.x, m.y - p.y) <= f.radius + m.r, dmg);
        p.hits = 0;
      } else if (f.t === 'hammer') {      // 천사 심판: 금 망치(근접 평타)로 변신, 지속시간이 끝나면 원래대로
        p.hm = f.dur; p.tm = Math.ceil(f.dur * 10); p.atkCd = Math.min(p.atkCd, 0.15);      // tm = 남은 시간(0.1초 단위, 온라인 화면에도 전해짐)
        this.fx.push({ k: 'ring', x: p.x, y: p.y, r: 54, life: 0.4, max: 0.4, col: '#ffd24a' });
      }
      else if (f.t === 'orbs') {      // 추적 구슬: 내 자리에서 n개 소환
        for (let k = 0; k < f.n; k++) {
          const off = (k - (f.n - 1) / 2) * 26, nx = -Math.sin(p.aim), ny = Math.cos(p.aim);
          this.minions.push({ id: ++this.mid, kind: 'orb', owner: p.idx, x: p.x + nx * off, y: p.y + ny * off, vx: 0, vy: 0, hp: f.hp, maxHp: f.hp, r: f.r, speed: f.speed, burst: f.burst, dmg: f.dmg, life: f.life, delay: 0.5, guard: 0, slot: 0, aim: p.aim, fire: 0, fireT: 0, nv: null, nvT: 0 });
        }
        p.orbSk = i; p.skCd[i] = sk.cd + f.life;      // 쿨타임은 구슬이 모두 사라진 뒤부터
        this.fx.push({ k: 'ring', x: p.x, y: p.y, r: 40, life: 0.3, max: 0.3, col: '#c36bff' });
      } else if (f.t === 'pwall') {      // 벽 소환: 쿨타임은 벽이 사라진 뒤부터
        const r = this.wallRect(p, f, ang);
        if (r) { this.pw.push(Object.assign(r, { own: p.idx, t: f.dur, max: f.dur })); this.rebuildWalls(); p.skCd[i] = sk.cd + f.dur; this.fx.push({ k: 'ring', x: r.cx, y: r.cy, r: 48, life: 0.3, max: 0.3, col: '#ffd24a' }); }
      } else if (f.t === 'dpower') {      // 용의 힘: 강림 게이지 +1, 내 용이 있으면 용과 위치 교체
        const A = p.ch.advent, d = this.minions.find(m => m.owner === p.idx && m.kind === 'dragon' && m.hp > 0);
        if (!d) p.hits = Math.min(A.hits, p.hits + 1);      // 용이 없을 때만 게이지가 참 (용이 있으면 위치 교환만)
        this.fx.push({ k: 'ring', x: p.x, y: p.y, r: 54, life: 0.4, max: 0.4, col: '#ffd24a' });
        if (d) {
          const px = p.x, py = p.y, dx = d.x, dy = d.y; this.ev.push({ k: 'swap', p: p.idx });
          this.fx.push({ k: 'ring', x: dx, y: dy, r: 54, life: 0.4, max: 0.4, col: '#ff7a30' });
          p.x = clamp(dx, R, W - R); p.y = clamp(dy, R, H - R); for (const w of WALLS) resolveCircleRect(p, R, w); p.x = clamp(p.x, R, W - R); p.y = clamp(p.y, R, H - R);
          d.x = clamp(px, d.r, W - d.r); d.y = clamp(py, d.r, H - d.r); for (const w of WALLS) resolveCircleRect(d, d.r, w); d.x = clamp(d.x, d.r, W - d.r); d.y = clamp(d.y, d.r, H - d.r);
          d.nv = null; d.nvT = 0; this.fx.push({ k: 'ring', x: p.x, y: p.y, r: 30, life: 0.25, max: 0.25, col: '#ffd24a' });
        }
        this.ev.push({ k: 'text', x: p.x, y: p.y - 40, txt: '용의 힘 +1', col: '#ffd24a' });
      }
      else if (f.t === 'rewind') {      // 닌자 되감기: 2초 전 위치로, 체력은 더 낮았을 때만 회복
        const h = p.hist && p.hist[0]; if (h) {
          this.fx.push({ k: 'ring', x: p.x, y: p.y, r: 34, life: 0.35, max: 0.35, col: f.col });
          p.x = h.x; p.y = h.y; p.vx = p.vy = 0; p.kb = null; p.charge = null;
          for (const w of WALLS) resolveCircleRect(p, R, w); p.x = clamp(p.x, R, W - R); p.y = clamp(p.y, R, H - R);
          if (h.hp > p.hp) { this.ev.push({ k: 'text', x: p.x, y: p.y - 40, txt: '+' + Math.round(h.hp - p.hp), col: '#6be08a' }); p.hp = Math.min(p.maxHp, h.hp); }
          this.fx.push({ k: 'ring', x: p.x, y: p.y, r: 34, life: 0.35, max: 0.35, col: f.col }); p.hist = [{ x: p.x, y: p.y, hp: p.hp }]; p.histT = 0;
        }
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
  // ── 소환사: 벽·소환물 ──
  wallRect(p, f, ang, force) {      // 벽이 설 자리(자유 각도). 다른 벽(맵 벽·소환 벽) 위에도 설치 가능, 맵 밖으로 나가면 안쪽으로 밀어 넣음
    let cx = p.x + Math.cos(ang) * f.dist, cy = p.y + Math.sin(ang) * f.dist, r = makeWall(cx, cy, ang, f.w, f.h);
    for (let k = 0; k < 3; k++) {
      const cs = wallCorners(r), mnx = Math.min(...cs.map(q => q[0])), mxx = Math.max(...cs.map(q => q[0])), mny = Math.min(...cs.map(q => q[1])), mxy = Math.max(...cs.map(q => q[1]));
      const sx = mnx < 0 ? -mnx : mxx > W ? W - mxx : 0, sy = mny < 0 ? -mny : mxy > H ? H - mxy : 0;
      if (!sx && !sy) break; cx += sx; cy += sy; r = makeWall(cx, cy, ang, f.w, f.h);
    }
    const bad = wallCorners(r).some(q => q[0] < -0.5 || q[1] < -0.5 || q[0] > W + 0.5 || q[1] > H + 0.5);
    if (bad) { if (!force) return null; r.bad = true; }
    return r;
  }
  canUse(p, i, ang) {      // 쓸 수 없는 상황이면 쿨타임도 돌지 않음
    if (p.sil > 0) return false;      // 법률 구역 안: 스킬 봉인
    for (const f of skOf(p, i).fx) {
      if (f.t === 'rewind' && !(p.hist && p.hist.length)) return false;
      if (f.t === 'detonate' && !this.pools.some(z => z.owner === p.idx && z.kind === 'trap') && !this.minions.some(m => m.owner === p.idx && m.kind === 'nin' && m.hp > 0)) return false;      // 터뜨릴 설치물이 없으면 못 씀
      if (f.t === 'dpower' && p.hits >= p.ch.advent.hits && !this.minions.some(m => m.owner === p.idx && m.kind === 'dragon' && m.hp > 0)) return false;
      if (f.t === 'pwall' && !this.wallRect(p, f, typeof ang === 'number' ? ang : p.aim)) return false;
    }
    return true;
  }
  hurtMinion(m, dmg) {
    const a = dmg * (this.fightT > OT_START ? OT_DMG_MUL : 1); m.hp -= a;
    this.ev.push({ k: 'text', x: m.x, y: m.y - m.r - 6, txt: '-' + Math.round(a), col: '#e8edf7' });
  }
  hitMinions(srcIdx, pred, dmg) { const tm = this.players[srcIdx].team; for (const m of this.minions) if (this.players[m.owner].team !== tm && m.hp > 0 && pred(m)) this.hurtMinion(m, dmg); }
  orbBurst(m) {      // 구슬 폭발: 닿거나 죽을 때
    const own = this.players[m.owner];
    this.fx.push({ k: 'ring', x: m.x, y: m.y, r: m.burst, life: 0.6, max: 0.6, col: '#ffd24a' });
    for (const e of this.foes(own)) if (e.alive && Math.hypot(e.x - m.x, e.y - m.y) <= m.burst + R) this.dealDamage({ x: m.x, y: m.y, idx: own.idx }, e, m.dmg, null);
    m.hp = -1; m.done = true;
  }
  moveCirc(o, dx, dy) {      // 반지름 o.r짜리 소환물 이동(벽에 막힘)
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 6)), sx = dx / n, sy = dy / n;
    for (let i = 0; i < n; i++) { o.x = clamp(o.x + sx, o.r, W - o.r); o.y = clamp(o.y + sy, o.r, H - o.r); for (const w of WALLS) resolveCircleRect(o, o.r, w); o.x = clamp(o.x, o.r, W - o.r); o.y = clamp(o.y, o.r, H - o.r); }
  }
  advent(p) {      // 강림: 내 앞에 용 소환 + 넓은 범위 10 피해와 둔화. 소환 위치는 순간이동 조준과 같음
    const A = p.ch.advent, e = this.foe(p), m = Math.hypot(p.inp.mx, p.inp.my);
    let dx = 0, dy = 0, dist = 0;      // 터치만 하면 내 자리에 바로 소환, 드래그로 방향을 정하면 그 방향 앞에 소환
    if (typeof p.atkAng === 'number') { dx = Math.cos(p.atkAng); dy = Math.sin(p.atkAng); dist = A.dist; }
    p.atkAng = null;
    const D = A.dragon, o = { x: clamp(p.x + dx * dist, D.r, W - D.r), y: clamp(p.y + dy * dist, D.r, H - D.r), r: D.r };
    for (const w of WALLS) resolveCircleRect(o, D.r, w);
    o.x = clamp(o.x, D.r, W - D.r); o.y = clamp(o.y, D.r, H - D.r);
    this.minions.push({ id: ++this.mid, kind: 'dragon', owner: p.idx, x: o.x, y: o.y, vx: 0, vy: 0, hp: D.hp, maxHp: D.hp, life: D.life, r: D.r, speed: D.speed, guard: 0, slot: 0, aim: Math.atan2(e.y - o.y, e.x - o.x), fire: 0, fireT: 0.15, nv: null, nvT: 0 });
    this.fx.push({ k: 'ring', x: o.x, y: o.y, r: A.burst.r, life: 0.5, max: 0.5, col: '#ff7a30' });
    for (const q of this.foes(p)) if (q.alive && Math.hypot(q.x - o.x, q.y - o.y) <= A.burst.r + R) this.dealDamage(p, q, A.burst.dmg, { slowT: A.burst.slowT, slowMul: A.burst.slowMul });
    p.hits = 0; p.adv = false; p.atkBuf = 0;
    this.ev.push({ k: 'text', x: p.x, y: p.y - 40, txt: '강림!', col: '#ffd24a' });
  }
  stepMinions(dt) {
    const keep = [];
    for (const m of this.minions) {
      if (m.hp <= 0 && m.kind === 'orb' && !m.done) this.orbBurst(m);
      if (m.hp <= 0) { if (m.kind === 'dragon') this.fx.push({ k: 'ring', x: m.x, y: m.y, r: 40, life: 0.3, max: 0.3, col: '#ff7a30' }); else if (m.kind === 'nin') this.fx.push({ k: 'ring', x: m.x, y: m.y, r: 30, life: 0.3, max: 0.3, col: '#9aa4b8' }); continue; }
      if (m.kind === 'nin') {      // 닌자 분신 포대: 가만히 서서 사거리 안의 가장 가까운 적에게 자동 사격
        const own = this.players[m.owner];
        if ((m.life -= dt) <= 0 || !own.alive) { this.fx.push({ k: 'ring', x: m.x, y: m.y, r: 30, life: 0.3, max: 0.3, col: '#9aa4b8' }); continue; }
        let tg = null, td = m.f.range + R; for (const f of this.foes(own)) if (f.alive && f.stl <= 0) { const d = Math.hypot(f.x - m.x, f.y - m.y); if (d < td && this.clear(m.x, m.y, f.x, f.y)) { td = d; tg = f; } }
        m.fire = tg ? 1 : 0; m.fireT -= dt;
        if (tg) { m.aim = Math.atan2(tg.y - m.y, tg.x - m.x); if (m.fireT <= 0) { m.fireT = m.f.every; this.fireProj({ x: m.x, y: m.y, idx: m.owner }, { dmg: m.f.dmg, speed: m.f.speed, r: m.f.r, life: 0.7, col: m.f.col }, m.aim); } }
        keep.push(m); continue;
      }
      if (m.kind === 'dragon' && (m.life -= dt) <= 0) { this.fx.push({ k: 'ring', x: m.x, y: m.y, r: 40, life: 0.3, max: 0.3, col: '#ff7a30' }); continue; }      // 용은 소환 10초 뒤 사라짐
      const own = this.players[m.owner], e = this.nearFoe(own.team, m.x, m.y);
      if (!own.alive || !e.alive) { keep.push(m); m.vx = m.vy = 0; continue; }
      let tx, ty, sp = m.speed;
      if (m.guard > 0) { m.guard -= dt; tx = own.x + Math.cos(m.slot) * 46; ty = own.y + Math.sin(m.slot) * 46; sp = Math.max(sp, 260); }
      else { const hid = e.stl > 0; tx = hid ? e.seenX : e.x; ty = hid ? e.seenY : e.y; }
      const dd = Math.hypot(tx - m.x, ty - m.y);
      let mv = 0;
      if (m.delay > 0) m.delay -= dt;      // 구슬은 소환하고 0.5초 뒤부터 움직임(그동안 나는 움직일 수 있음)
      if (m.kind === 'dragon' && m.guard <= 0) mv = dd > 60 ? 1 : 0; else mv = dd > 6 ? 1 : 0;
      if (m.delay > 0) mv = 0;
      if (mv) {
        m.nvT -= dt; if (!m.nv || m.nvT <= 0) { m.nv = this.navDir(m, tx, ty); m.nvT = 0.08; }
        const px = m.x, py = m.y; this.moveCirc(m, m.nv[0] * sp * dt, m.nv[1] * sp * dt); m.vx = (m.x - px) / dt; m.vy = (m.y - py) / dt;
      } else m.vx = m.vy = 0;
      m.aim = Math.atan2(e.y - m.y, e.x - m.x);
      if (m.kind === 'orb') {
        m.life -= dt;
        if (m.life <= 0 || this.foes(own).some(f => f.alive && Math.hypot(f.x - m.x, f.y - m.y) <= m.r + R)) { this.orbBurst(m); continue; }
      } else {
        const D = CHARS.summoner.advent.dragon, de = Math.hypot(e.x - m.x, e.y - m.y);
        m.fireT -= dt;
        m.fire = 1;      // 용은 항상 상대 쪽으로 불을 뿜음(피해는 범위 안일 때만)
        if (m.fireT <= 0) {
          m.fireT = D.every;
          for (const f of this.foes(own)) if (f.alive && Math.hypot(f.x - m.x, f.y - m.y) <= D.range + R && Math.abs(normAng(Math.atan2(f.y - m.y, f.x - m.x) - m.aim)) <= D.arc / 2 + 0.2) this.dealDamage({ x: m.x, y: m.y, idx: own.idx }, f, D.dmg, null);
          this.hitMinions(own.idx, q => q.kind === 'orb' && Math.hypot(q.x - m.x, q.y - m.y) <= D.range + q.r && Math.abs(normAng(Math.atan2(q.y - m.y, q.x - m.x) - m.aim)) <= D.arc / 2, D.dmg);
        }
      }
      keep.push(m);
    }
    this.minions = keep;
  }
  stepPWalls(dt) {
    let ch = false;
    for (const w of this.pw) { w.t -= dt; if (w.t <= 0) ch = true; }
    if (ch) { this.pw = this.pw.filter(w => w.t > 0); this.rebuildWalls(); }
  }
  nearPost(p) {      // 닌자 인술 진지: 내 덫·분신 반경 안인가
    const r = p.ch.post.r;
    return this.pools.some(z => z.owner === p.idx && z.kind === 'trap' && Math.hypot(z.x - p.x, z.y - p.y) <= r) || this.minions.some(m => m.owner === p.idx && m.kind === 'nin' && m.hp > 0 && Math.hypot(m.x - p.x, m.y - p.y) <= r);
  }
  basicAttack(p) {
    if (p.adv) { this.advent(p); p.atkCd = p.ch.atk.cd; return; }
    const a = atkOf(p), dmg = (a.dmg + (p.emp && p.ch.empAtk ? p.ch.empAtk : 0)) * (p.ch.post && this.nearPost(p) ? p.ch.post.atk : 1);
    if (p.stl > 0) this.endStealth(p);      // 공격하면 은신이 풀림
    const emp = p.emp && p.ch.empAtk; p.emp = false;
    if (emp && a.lunge) {      // 강화 평타: 상대 쪽으로 짧게 파고들며 벤다 (몸이 겹치지 않는 거리까지만)
      const e = this.foe(p), dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1, mv = Math.min(a.lunge, d - (2 * R + 2));
      if (mv > 0) { stepMove(p, dx / d * mv, dy / d * mv); this.fx.push({ k: 'ring', x: p.x, y: p.y, r: 26, life: 0.18, max: 0.18, col: p.ch.color }); }
    }
    if (a.type === 'melee') { const n = this.coneHit(p, a.range, a.arc, dmg, a.col ? { col: a.col, basic: true } : null); if (n && p.ch.hammer) p.hits = Math.min(p.ch.stackMax, p.hits + p.ch.hammer.stack); }      // 금 망치 적중: 스택 +2
    else {
      const pf = { dmg, speed: a.speed, r: a.r, basic: true, hom: a.hom, life: a.life, pass: a.pass, col: a.col }; this.fireProj(p, pf);
      if (p.ch.ninjutsu && (p.nin | 0) >= p.ch.ninjutsu.max) p.pend2 = { t: 0.1, f: pf };      // 인술 최대: 평타가 2발 연속
    }
    p.atkCd = a.cd * (p.ch.ninjutsu && p.nin ? 1 - p.ch.ninjutsu.atk * p.nin : 1);
  }

  ninGain(p) { const n = p.ch.ninjutsu; if (n) { p.nin = Math.min(n.max, (p.nin | 0) + 1); p.ninT = n.decay; } }
  recHist(p, dt) {      // 닌자 되감기용: 0.1초마다 위치·체력을 기록(최대 2초)
    if (!p.hist) { p.hist = []; p.histT = 0; }
    p.histT += dt; if (p.histT >= 0.1) { p.histT -= 0.1; p.hist.push({ x: p.x, y: p.y, hp: p.hp }); if (p.hist.length > 20) p.hist.shift(); }
  }
  stepPlayer(p, dt) {
    const e = this.foe(p);
    if (p.ch.ninjutsu && p.nin > 0) { p.ninT -= dt; if (p.ninT <= 0 || !p.alive) { p.nin = 0; p.ninT = 0; } }
    p.atkCd -= dt; p.dashCd -= dt; p.inv -= dt;
    if (p.pend2) { p.pend2.t -= dt; if (p.pend2.t <= 0) { if (p.alive && !(p.stun > 0)) this.fireProj(p, p.pend2.f); p.pend2 = null; } }
    p.adv = !!(p.ch.advent && p.hits >= p.ch.advent.hits && !this.minions.some(m => m.owner === p.idx && m.kind === 'dragon' && m.hp > 0));      // 강림 가능: 게이지가 차고 내 용이 없을 때
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
        if (p.alive) for (const q of this.foes(p)) if (q.alive && this.hitT(q, (x, y, pd) => inTri(c, p, x, y, pd))) this.dealDamage(p, q, c.blocked ? c.hit : c.miss, null);
        if (p.alive) this.hitMinions(p.idx, m => inTri(c, p, m.x, m.y, m.r), c.blocked ? c.hit : c.miss);
      }
    }
    if (p.hm > 0) { p.hm -= dt; if (p.hm <= 0) { p.hm = 0; p.tm = 0; } else p.tm = Math.ceil(p.hm * 10); }      // 금 망치 지속시간
    if (p.stun > 0) p.stun -= dt;
    if (p.slowT > 0) p.slowT -= dt;
    if (p.sil > 0) p.sil -= dt;
    if (p.ch.post && p.alive && this.nearPost(p) && !(p.haste > 0.15 && p.hasteMul >= p.ch.post.spd)) { p.haste = Math.max(p.haste, 0.15); p.hasteMul = p.ch.post.spd; }      // 인술 진지: 설치물 근처 이속 +10%
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
    if (p.alive && !p.charge) {      // 조준: 가까운 적 또는 적 소환물(구슬·용) 중 가장 가까운 쪽 (소환물도 적 한 명처럼 취급)
      let tx = e.stl > 0 ? e.seenX : e.x, ty = e.stl > 0 ? e.seenY : e.y, bd = Math.hypot(tx - p.x, ty - p.y);
      for (const m of this.minions) if (m.hp > 0 && this.players[m.owner].team !== p.team) { const d = Math.hypot(m.x - p.x, m.y - p.y); if (d < bd) { bd = d; tx = m.x; ty = m.y; } }
      p.aim = Math.atan2(ty - p.y, tx - p.x);
    }

    if (p.alive && p.stun <= 0 && !p.charge && p.dashT <= 0 && !p.cnt) {
      if (p.want.dash && (p.ch.dashN ? p.dashN > 0 : p.dashCd <= 0) && !isRoot(p)) {
        const m = Math.hypot(p.inp.mx, p.inp.my);
        if (p.want.dd) { p.dx = p.want.dd[0]; p.dy = p.want.dd[1]; }
        else if (m > 0.2) { p.dx = p.inp.mx / m; p.dy = p.inp.my / m; } else { p.dx = -Math.cos(p.aim); p.dy = -Math.sin(p.aim); }
        p.dashT = DASH.time;
        this.ninGain(p);
        if (p.ch.dashN) { p.dashN--; if (p.dashN === 0) p.dashCd = p.ch.dashCd || DASH.cd; } else p.dashCd = DASH.cd;      // 암살자: 충전 대시를 모두 써야 쿨타임이 돎
        this.ev.push({ k: 'dash', p: p.idx });
        this.fx.push({ k: 'ring', x: p.x, y: p.y, r: 28, life: 0.25, max: 0.25, col: '#6be08a' });
      } else {
        for (let i = 0; i < 3; i++) if (p.want.sk[i] && p.skCd[i] <= 0 && !(isRoot(p) && moveSkill(p.ch.skills[i])) && this.canUse(p, i, p.want.angs[i])) { this.useSkill(p, i, p.want.angs[i], p.want.dists[i]); break; }
      }
    }
    p.want = freshWant();

    let vx = 0, vy = 0;
    if (!p.alive) { /* 정지 */ }
    else if (p.charge) { const c = p.charge; vx = c.dx * c.speed; vy = c.dy * c.speed; c.left -= dt; if (c.left <= 0) { p.charge = null; this.chargeEnd(p, c); } }
    else if (p.kb) { const k = p.kb, m = k.ease ? 2 * Math.max(0, k.left) / k.tot : 1; vx = k.dx * k.speed * m; vy = k.dy * k.speed * m; k.left -= dt; }
    else if (p.dashT > 0) { vx = p.dx * DASH.speed; vy = p.dy * DASH.speed; p.dashT -= dt; }
    else if (p.cnt) { /* 반격 중에는 제자리 */ }
    else if (p.stun <= 0) {
      let mx = p.inp.mx, my = p.inp.my; const ml = Math.hypot(mx, my);
      if (ml > 1) { mx /= ml; my /= ml; }
      const sp = p.ch.speed * (p.slowT > 0 ? p.slowMul : 1) * (p.haste > 0 ? p.hasteMul : 1) * (p.stl > 0 ? STL_MUL : 1) * (this.map.speedMul || 1) * (p.ch.ninjutsu && p.nin ? 1 + p.ch.ninjutsu.spd * p.nin : 1);
      vx = mx * sp; vy = my * sp;
    }
    p.vx = vx; p.vy = vy;
    const ox0 = p.x, oy0 = p.y;
    stepMove(p, vx * dt, vy * dt);
    if (p.kb) {      // 밀려나다 벽에 막히면 추가 피해하고 멈춤
      const k = p.kb, want = Math.hypot(vx, vy) * dt, got = Math.hypot(p.x - ox0, p.y - oy0);
      if (want > 0.5 && got < want * 0.5) { if (k.wall > 0 && !k.hitW) { k.hitW = true; this.dealDamage(k.src, p, k.wall, k.stun ? { stun: k.stun } : null); this.fx.push({ k: 'ring', x: p.x, y: p.y, r: 36, life: 0.25, max: 0.25, col: '#4aa8ff' }); } p.kb = null; }
      else if (k.left <= 0) p.kb = null;
    }

    const dist = Math.hypot(e.x - p.x, e.y - p.y);
    if (p.charge) {      // 경로상 적 피해: 지나가며 부딪힌 적에게 한 사람당 1회 (돌진은 계속)
      const c = p.charge; c.hits = c.hits || new Set();
      if (!c.soft) for (const q of this.foes(p)) if (q.alive && !c.hits.has(q.idx) && Math.hypot(q.x - p.x, q.y - p.y) < c.w / 2 + R) {
        c.hit = true; c.hits.add(q.idx);
        this.fx.push({ k: 'ring', x: q.x, y: q.y, r: 45, life: 0.25, max: 0.25, col: '#ffffff' });
        this.dealDamage(p, q, c.dmg, c);
      }
    }
    // 기본공격: 버튼을 톡 누르면 1회(사거리 상관없이), 꾹 누르면 사거리 안에서 자동 반복
    if (p.alive && p.stun <= 0 && !p.charge && p.dashT <= 0 && !p.cnt && (p.atkCd <= 0 || p.adv)) {      // 강림(5스택)은 평타 쿨타임과 상관없이 바로
      const a = atkOf(p);
      const inRange = a.type === 'melee' ? dist <= a.range + R : (dist <= a.range && this.clear(p.x, p.y, e.x, e.y, a.pass ? p.idx : null));
      if (p.atkBuf > 0 || (!p.adv && p.atkHold && inRange)) { this.basicAttack(p); p.atkBuf = 0; }      // 강림은 누를 때만(꾹 눌러 자동으로 나가지 않음)
    }
  }

  ai(p, dt) {
    p.atkHold = true;
    const e = this.foe(p), d = this.diff, inp = p.inp;
    p.think -= dt; p.strafeT -= dt; p.unstick -= dt; p.stuckT += dt;
    if (p.stuckT >= 0.6) {
      const moved = Math.hypot(p.x - p.lx, p.y - p.ly); p.lx = p.x; p.ly = p.y; p.stuckT = 0;
      if (moved < 25 && p.stun <= 0) { p.unstick = 0.6; p.unstickAng = Math.random() * 6.283; p.strafe *= -1; }
    }
    if (p.strafeT <= 0) { p.strafe = Math.random() < 0.5 ? -1 : 1; p.strafeT = 0.6 + Math.random() * 1.2; }
    if (p.adv && p.alive) { const hid0 = e.stl > 0; p.atkAng = Math.atan2((hid0 ? e.seenY : e.y) - p.y, (hid0 ? e.seenX : e.x) - p.x); p.atkBuf = ATK_BUFFER; }      // 강림은 상대 쪽으로
    if (p.think > 0) return;
    p.think = d.react;
    const hid = e.stl > 0, ex = hid ? e.seenX : e.x, ey = hid ? e.seenY : e.y;      // 은신한 상대는 마지막으로 본 위치만 알 수 있음
    const dx = ex - p.x, dy = ey - p.y, dist = Math.hypot(dx, dy) || 1, ux = dx / dist, uy = dy / dist;
    const los = this.clear(p.x, p.y, ex, ey), keep = p.tm && p.ch.hammer ? 64 : p.ch.keep, melee = atkOf(p).type === 'melee';
    let ap = dist > keep + 30 ? 1 : dist < keep - 30 ? -1 : 0;
    if (!los) ap = Math.max(ap, 0.8);
    let threat = false;
    if (this.smart && !melee) {      // 똑똑한 원거리 AI(시험용 옵션): 상대 스킬 시전·돌진·근접 접근에 반응해 후퇴 사격/순간이동
      const sc = e.skCd, pv = p._esc || [0, 0, 0]; let cast = false; for (let i = 0; i < 3; i++) if (sc[i] > pv[i] + 0.5) cast = true; p._esc = sc.slice();
      threat = (cast && dist < 340) || !!e.charge || (e.dashT > 0 && dist < 220) || (dist < 140 && atkOf(e).type === 'melee');
    }
    let mx, my;
    const nv = p.unstick > 0 ? null : this.navDir(p, ex, ey), around = nv && !this.clearR(p.x, p.y, ex, ey, R + 3);      // 벽에 막혀 있으면 돌아가는 길로
    if (p.unstick > 0) { mx = Math.cos(p.unstickAng); my = Math.sin(p.unstickAng); }
    else if (around) { mx = nv[0]; my = nv[1]; }
    else { const sw = melee ? 0.35 : 0.8; mx = ux * ap - uy * p.strafe * sw; my = uy * ap + ux * p.strafe * sw; }
    for (const f of this.fx) if (f.k === 'bolt' && f.tz != null && f.life > 0 && this.players[f.tz].team !== p.team) { const rx = p.x - f.x, ry = p.y - f.y, rd = Math.hypot(rx, ry) || 1; if (rd < f.r + R + 30) { mx = rx / rd; my = ry / rd; break; } }      // 용오름 예고 원에서 벗어남
    if (this.map.bolt) for (const bt of this.bolts) { const rx = p.x - bt.x, ry = p.y - bt.y, rd = Math.hypot(rx, ry) || 1; if (rd < this.map.bolt.r + R + 30) { mx = rx / rd; my = ry / rd; break; } }      // 번개 경고 원에서 벗어남
    if (this.ess && this.ess.up && p.hp <= p.maxHp - 6) { const de = Math.hypot(p.x - W / 2, p.y - H / 2), dp = Math.hypot(e.x - W / 2, e.y - H / 2); if (de < dp + 120 || p.hp < p.maxHp * 0.6) { const nv2 = this.navDir(p, W / 2, H / 2); mx = nv2[0]; my = nv2[1]; } }      // 정수 먹으러 감
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
    {      // 상대 스킬 대응: 예고선(강타·돌진 등)·근거리 시전·돌진·구슬 접근을 알아채면 방어/반격/이동 스킬로 막거나 피함 (못 쓰면 대시)
      let inc = false, pdx = 0, pdy = 0, tele = false;
      for (const f of this.fx) {
        if (f.k !== 'tele' || f.life <= 0 || Math.hypot(f.x - e.x, f.y - e.y) > 70) continue;
        const c = Math.cos(f.a), sn = Math.sin(f.a), rx = p.x - f.x, ry = p.y - f.y, al = rx * c + ry * sn, pe = -rx * sn + ry * c;
        if (al >= -R && al <= f.len + R && Math.abs(pe) <= f.w / 2 + R + 8) { inc = tele = true; const sd = pe >= 0 ? 1 : -1; pdx = -sn * sd; pdy = c * sd; break; }
      }
      const sc = e.skCd, pv = p._ecd || [0, 0, 0]; let cast = false; for (let i = 0; i < 3; i++) if (sc[i] > pv[i] + 0.5) cast = true; p._ecd = sc.slice();
      if (cast && dist < 260) inc = true;
      if (e.charge && dist < 380) inc = true;
      for (const m of this.minions) if (m.kind === 'orb' && m.hp > 0 && this.players[m.owner].team !== p.team && Math.hypot(m.x - p.x, m.y - p.y) < 150) inc = true;
      if (inc) {
        danger = true; threat = true;
        if (tele) { mx = pdx; my = pdy; }
        const ans = [0, 1, 2].some(i => { const k = skOf(p, i); return p.skCd[i] <= 0 && ['defend', 'block', 'escape'].includes((k.ai || {}).use) && !(isRoot(p) && moveSkill(k)); });
        if (!dodged && (tele || e.charge) && (p.ch.dashN ? p.dashN > 0 : p.dashCd <= 0) && Math.random() < d.dodge * (ans ? 0.35 : 1)) { p.want.dash = 1; dodged = true; }
      }
    }
    p.inp = { mx, my };
    for (let i = 0; i < 3; i++) {
      const sk = skOf(p, i);
      if (dodged || p.skCd[i] > 0 || Math.random() > d.skillP) continue;
      const h = sk.ai || {}; let use = false;
      if (h.use === 'attack') use = dist <= h.maxD && dist >= (h.minD || 0) && (!sk.proj || los);
      else if (h.use === 'defend') use = danger || (p.hp < p.maxHp * 0.75 && dist < 260);
      else if (h.use === 'escape') {
        use = dist < (h.minD || 110) || (threat && dist < 340);
        if (use && sk.fx.some(f => f.t === 'blink' && f.thru)) {      // 순간이동: 상대 반대편(벽에 안 몰리는 쪽)으로
          const base = Math.atan2(p.y - ey, p.x - ex); let best = base, bs = -1e9;
          for (const off of [0, 0.6, -0.6, 1.2, -1.2]) { const a = base + off, nx = p.x + Math.cos(a) * 147, ny = p.y + Math.sin(a) * 147; if (nx < R || nx > W - R || ny < R || ny > H - R) continue; const sc2 = Math.hypot(nx - ex, ny - ey) - Math.abs(off) * 20; if (sc2 > bs) { bs = sc2; best = a; } }
          p.want.angs[i] = best;
        }
        if (use && sk.fx.some(f => f.t === 'charge' && f.soft)) p.want.angs[i] = Math.atan2(p.y - ey, p.x - ex);      // 날개짓: 상대 반대쪽으로
        if (use && sk.fx.some(f => f.t === 'blink' && !f.thru && f.dir === 'move')) p.want.angs[i] = Math.atan2(p.y - ey, p.x - ex);      // 그림자 도약: 상대 반대쪽으로
      }
      else if (h.use === 'salv') use = dist <= sk.fx[0].radius && ((p.hits | 0) >= 4 || (p.hp < p.maxHp * 0.5 && (p.hits | 0) >= 2));
      else if (h.use === 'block') use = danger || dist <= h.maxD;
      else if (h.use === 'wall') use = dist >= (h.minD || 0) && dist <= (h.maxD || 9999) && los && Math.random() < 0.5;
      else if (h.use === 'power') { const dr = this.minions.some(m => m.owner === p.idx && m.kind === 'dragon' && m.hp > 0); use = dr ? (dist < 170 && Math.random() < 0.4) : p.hits < p.ch.advent.hits; }
      else if (h.use === 'gapclose') use = dist >= (h.minD || 0) && dist <= (h.maxD || 9999) && !(p.ch.hammer && p.tm);
      else if (h.use === 'trap') use = dist >= 90 && dist <= 330 && this.pools.filter(z => z.owner === p.idx && z.kind === 'trap').length < 2 && Math.random() < 0.5;
      else if (h.use === 'rewind') { const o = p.hist && p.hist[0]; use = !!o && (o.hp - p.hp >= 18 || (p.hp < p.maxHp * 0.5 && o.hp > p.hp && dist < 230) || (Math.hypot(o.x - p.x, o.y - p.y) > 130 && dist < 90 && p.hp < p.maxHp * 0.7)); }
      else if (h.use === 'decoy') use = dist <= 330 && this.minions.filter(m => m.owner === p.idx && m.kind === 'nin' && m.hp > 0).length < 2 && Math.random() < 0.5;
      else if (h.use === 'detonate') use = (this.pools.some(z => z.owner === p.idx && z.kind === 'trap') || this.minions.some(m => m.owner === p.idx && m.kind === 'nin' && m.hp > 0)) && dist < 150;
      else if (h.use === 'pool') use = dist < 130 && !this.pools.some(z => z.owner === p.idx && z.kind === 'pool');
      else if (h.use === 'tornado') use = dist >= (h.minD || 0) && dist <= (h.maxD || 9999) && los && Math.random() < 0.6;
      if (use) { p.want.sk[i] = 1; if (h.use === 'tornado') { const f0 = sk.fx[0]; p.want.dists[i] = clamp((dist - f0.min) / (f0.max - f0.min), 0, 1); } }
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
    if (m.heat) {      // 은신 중엔 숫자를 띄우지 않음(위치가 들통나므로) · 체력에서 바로 깎음: 피해 감소·보호막·무적(대시)의 영향을 받지 않음
      this.heatT -= dt;
      if (this.heatT <= 0) { this.heatT += m.heat.every; for (const p of P) if (p.alive) { p.hp -= m.heat.dmg; if (!(p.stl > 0)) this.ev.push({ k: 'text', x: p.x, y: p.y - 30, txt: '-' + m.heat.dmg, col: '#ff8a4a' }); } }
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
    if (!this.remote && !this.quad && !this.practice) this.ai(P[1], dt);
    if (this.auto0) this.ai(P[0], dt);
    this.stepZones(dt); this.stepPools(dt); this.stepMapFx(dt);
    this.stepPWalls(dt);
    for (const p of P) this.stepPlayer(p, dt);
    this.stepMinions(dt);
    for (const p of P) if (p.orbSk >= 0) {      // 추적 구슬 쿨타임: 구슬이 모두 사라진 뒤부터 돎 (남아 있는 동안은 남은 수명만큼 더해 둠)
      const i = p.orbSk, orbs = this.minions.filter(m => m.owner === p.idx && m.kind === 'orb' && m.hp > 0), cd = p.ch.skills[i].cd;
      if (!orbs.length) { p.skCd[i] = cd; p.orbSk = -1; } else p.skCd[i] = cd + Math.max(...orbs.map(m => Math.max(0, m.life)));
    }
    this.stepBullets(dt);
    for (const p of P) if (p.hp <= 0) p.alive = false;
    const a0 = P.some(p => p.team === 0 && p.alive), a1 = P.some(p => p.team === 1 && p.alive);      // 한 팀이 모두 쓰러지면 라운드 종료
    if (!a0 || !a1) {
      let w = -1; if (a0 && !a1) w = 0; else if (a1 && !a0) w = 1;
      if (w >= 0) this.score[w]++;
      this.res = { w }; this.ph = 'end'; this.timer = ROUNDEND_TIME;
      this.pools = this.pools.filter(z => z.kind !== 'trap'); for (const f of this.fx) if (f.k === 'trap') f.life = 0;      // 라운드가 끝나면 닌자 덫도 바로 사라짐
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
      const ownP = this.players[b.owner], FO = this.foes(ownP);
      let tg = null, td = 1e9;      // 유도: 가장 가까운 적(상대 본체 또는 소환물)을 향함
      if (b.hom) {
        for (const t of FO) if (t.alive && !(t.stl > 0)) { const dd = Math.hypot(t.x - b.x, t.y - b.y); if (dd < td) { td = dd; tg = t; } }
        for (const m of this.minions) if (this.players[m.owner].team !== ownP.team && m.hp > 0) { const dd = Math.hypot(m.x - b.x, m.y - b.y); if (dd < td) { td = dd; tg = m; } }
      }
      if (tg) {      // 서서히 방향을 틂(벽은 못 돌아감)
        const sp0 = Math.hypot(b.vx, b.vy) || 1, cur = Math.atan2(b.vy, b.vx), da = normAng(Math.atan2(tg.y - b.y, tg.x - b.x) - cur), na = cur + clamp(da, -b.hom * dt, b.hom * dt);
        b.vx = Math.cos(na) * sp0; b.vy = Math.sin(na) * sp0;
      }
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.life <= 0) { dead = true; boom = b.aoe > 0; }
      else if (b.wp ? (b.x < 0 || b.x > W || b.y < 0 || b.y > H) : (b.x < b.r || b.x > W - b.r || b.y < b.r || b.y > H - b.r)) { dead = true; boom = b.aoe > 0; }
      for (const t of FO) {
        if (!dead && t.cnt && inTri(t.cnt, t, b.x, b.y, b.r)) {      // 반격: 삼각형 안으로 들어온 투사체를 막음
          dead = true; this.blockedBy(t);
        }
        if (!dead && t.guard) {      // 가로베기 같은 막기: 부채꼴 안으로 들어온 투사체는 사라짐
          const gx = b.x - t.x, gy = b.y - t.y;
          if (Math.hypot(gx, gy) <= t.guard.r + b.r && Math.abs(normAng(Math.atan2(gy, gx) - t.guard.a)) <= t.guard.arc / 2) {
            dead = true; this.fx.push({ k: 'ring', x: b.x, y: b.y, r: 20, life: 0.2, max: 0.2, col: '#ffffff' });
          }
        }
      }
      if (!dead && !b.pierce && !b.wp) for (const w of WALLS) { if (b.pass && w.own === b.owner) continue; if (resolveCircleRect(b, b.r, w)) { dead = true; boom = b.aoe > 0; break; } }
      if (!dead) for (const t of FO) {
        if (dead) break;
        if (t.alive && t.dashT <= 0 && t.inv <= 0 && !((b.pierce || b.torn || b.carry) && b.hs && b.hs.has(t.idx)) && !(t.stl > 0 && b.basic)) {      // 은신 중엔 기본공격 투사체에 맞지 않음
          const dx = t.x - b.x, dy = t.y - b.y, rr = R + b.r;
          let touch;
          if (b.carry) { const sp = Math.hypot(b.vx, b.vy) || 1, ux = b.vx / sp, uy = b.vy / sp, al = dx * ux + dy * uy, pe = Math.abs(-dx * uy + dy * ux); touch = al <= 10 + R && al >= -130 && pe <= b.r + R; }      // 밀물: 파도 앞의 하얀 선에 닿았을 때부터 (몸통 사각형 안)
          else touch = dx * dx + dy * dy < rr * rr;
          if (touch) {
            if (b.torn) { if (t.cnt) { dead = true; this.blockedBy(t); } else { this.tornPull(b, t); (b.hs || (b.hs = new Set())).add(t.idx); } continue; }
            const ok = this.dealDamage(ownP, t, b.dmg, b); b.hit = true; (b.hs || (b.hs = new Set())).add(t.idx);      // 직격 피해 (관통탄은 한 사람당 1번)
            if (ok && b.basic && ownP.ch.stackMax) ownP.hits = Math.min(ownP.ch.stackMax, ownP.hits + 1);      // 천사 평타 적중 스택
            if (ok && b.hom) { const o = ownP; if (o.ch.advent && !o.adv) o.hits = Math.min(o.ch.advent.hits, o.hits + 1); }      // 소환사 평타 적중 게이지
            if (ok && (b.push || b.pull)) this.knock(ownP, t, b);      // 밀물: 진행 방향으로 밀어냄 / 썰물: 내 쪽으로 끌어당김
            if (ok && b.tp) this.tpBehind(ownP, t, b);      // 단검투척: 맞힌 적의 바로 뒤로 순간이동
            if (b.aoe > 0) { dead = true; this.explode(b, true); }               // 폭발은 모양만, 추가 피해 없음
            else if (!b.pierce && !b.carry) dead = true;
          }
        }
      }
      if (!dead && !b.carry) for (const m of this.minions) {      // 상대 소환물(용·구슬)도 맞을 수 있음 (밀물 파도는 소환물을 그냥 통과)
        if (this.players[m.owner].team === ownP.team || m.hp <= 0 || (b.pierce && b.hm && b.hm.has(m.id))) continue;
        const dx = m.x - b.x, dy = m.y - b.y, rr = m.r + b.r;
        if (dx * dx + dy * dy < rr * rr) {
          this.hurtMinion(m, b.dmg);
          if (b.pierce) { (b.hm || (b.hm = new Set())).add(m.id); }
          else { dead = true; if (b.aoe > 0) { boom = false; this.explode(b, false); } break; }
        }
      }
      if (boom) this.explode(b);
      if (dead) { b.dead = true; if (b.torn) this.makeTornado(ownP, b.x, b.y, b.torn, b.hs && b.hs.size ? b.torn.hitDelay : b.torn.delay); if (b.pull && !b.pulled) this.fx.push({ k: 'tether', x: b.x, y: b.y, follow: ownP.idx, len: 9999, w: 0, life: 0.25, max: 0.25, col: '#7fd3ff' }); }
    }
    this.bullets = this.bullets.filter(b => !b.dead);
  }
}

export { Game, CHARS, CHAR_ORDER, W, H, MAPS, MAP_ORDER, resolveCircleRect };
export const BUILD = 97;
