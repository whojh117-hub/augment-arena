# 증강 아레나

1:1 실시간 아레나 게임. `server.js`가 게임 페이지(`index.html`)를 제공하고, 온라인 대전은 **서버가 판정**합니다.

- 두 사람의 입력을 서버가 받아 한 판을 계산하고(index.html의 ENGINE 구간을 그대로 사용), 각자의 화면 기준으로 상태를 보냅니다.
- 방 목록·버전 확인은 WebSocket `/ws` 방 중계(프레즌스)로 합니다.
- 실행: `node server.js` (포트는 `PORT`, 기본 3000). 배포: Render Web Service (`render.yaml`), `git push` 하면 자동 재배포.

## Cloudflare Workers (무료) 배포
- `wrangler.jsonc` + `worker.mjs` (Durable Object `GameHub`) + `public/` 정적 파일.
- `index.html`을 고치면 `node tools/build.mjs`가 `engine.mjs`/`public/index.html`을 다시 만든다 (배포 때 자동 실행).
- 게임 로직은 `core.mjs`(공용), Render용 Node 서버는 `server.js`.
