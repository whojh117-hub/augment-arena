# 증강 아레나

1:1 실시간 아레나 게임. `server.js`가 게임 페이지(`index.html`)를 제공하고, 온라인 대전은 **서버가 판정**합니다.

- 두 사람의 입력을 서버가 받아 한 판을 계산하고(index.html의 ENGINE 구간을 그대로 사용), 각자의 화면 기준으로 상태를 보냅니다.
- 방 목록·버전 확인은 WebSocket `/ws` 방 중계(프레즌스)로 합니다.
- 실행: `node server.js` (포트는 `PORT`, 기본 3000). 배포: Render Web Service (`render.yaml`), `git push` 하면 자동 재배포.
