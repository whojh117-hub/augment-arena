// index.html(단일 원본)에서 서버용 엔진 모듈과 Cloudflare 배포용 정적 파일을 만든다.
//   node tools/build.mjs          생성
//   node tools/build.mjs --check  원본과 생성물이 같은지 확인 (다르면 종료 코드 1)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const a = src.indexOf('// ===== ENGINE START ====='), b = src.indexOf('// ===== ENGINE END =====');
if (a < 0 || b < 0) throw new Error('ENGINE 구간을 찾지 못했어요');
const build = Number((src.match(/const BUILD = (\d+);/) || [])[1]);
if (!build) throw new Error('BUILD 번호를 찾지 못했어요');
const engine = '// 자동 생성 파일입니다. 직접 고치지 말고 index.html을 고친 뒤 `node tools/build.mjs`를 실행하세요.\n' + src.slice(a, b) + '\nexport { Game, CHARS, CHAR_ORDER, W, H, MAPS, MAP_ORDER };\nexport const BUILD = ' + build + ';\n';
const outs = { 'engine.mjs': engine, 'public/index.html': src };
let bad = 0;
for (const [f, text] of Object.entries(outs)) {
  const p = path.join(root, f);
  if (process.argv.includes('--check')) { if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== text) { console.error('오래됨: ' + f); bad++; } }
  else { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
}
if (process.argv.includes('--check')) { if (bad) process.exit(1); console.log('생성물이 원본과 같아요 (BUILD ' + build + ')'); } else console.log('생성 완료 (BUILD ' + build + ')');
