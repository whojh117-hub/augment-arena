# 증강 아레나

1:1 실시간 아레나 게임. `server.js`가 게임 페이지(`index.html`)를 제공하고, 온라인 대전용 방 중계(WebSocket `/ws`)를 맡습니다.
판정은 방장 브라우저가 하고 서버는 상태만 전달합니다.

- 실행: `node server.js` (포트는 `PORT` 환경변수, 기본 3000)
- 배포: Render에서 이 저장소를 Web Service로 연결 (`render.yaml` 포함). `git push` 하면 자동 재배포됩니다.
