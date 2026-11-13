// 증강 아레나 - Cloudflare Workers 진입점 (무료 플랜).
// 정적 파일(public/)은 Workers Assets가 주고, /ws 연결은 하나의 Durable Object(GameHub)가 모두 받아서 방/대전을 처리한다.
import { Hub } from './core.mjs';

// WebSocket 하나를 허브에 연결 (실제 서버 소켓과 테스트용 가짜 소켓 모두 같은 방식)
export function attach(hub, ws) {
  const c = hub.addConn(str => ws.send(str), () => { try { ws.close(1011, 'closed'); } catch (e) { /* 무시 */ } });
  ws.addEventListener('message', ev => {
    let msg = null;
    if (typeof ev.data === 'string') { try { msg = JSON.parse(ev.data); } catch (e) { /* 무시 */ } }
    if (msg && typeof msg === 'object') { try { hub.onMessage(c, msg); } catch (e) { console.error(e); } }
  });
  const gone = () => hub.drop(c);
  ws.addEventListener('close', gone);
  ws.addEventListener('error', gone);
  return c;
}

export class GameHub {
  constructor(state, env) { this.hub = new Hub({}); }
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    if (this.hub.conns.size >= 400) return new Response('full', { status: 503 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    attach(this.hub, server);
    return new Response(null, { status: 101, webSocket: client });
  }
  async health() { return 'ok ' + this.hub.conns.size; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      const stub = env.HUB.get(env.HUB.idFromName('main'));
      return stub.fetch(request);
    }
    if (url.pathname === '/health') return new Response('ok', { headers: { 'content-type': 'text/plain' } });
    if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });
    const res = await env.ASSETS.fetch(request);
    const h = new Headers(res.headers);
    if (/\.html?$/.test(url.pathname) || url.pathname.endsWith('/')) h.set('content-type', 'text/html; charset=utf-8');      // 한글이 깨지지 않게 인코딩 명시
    h.set('cache-control', 'no-store');      // 업데이트(git push)가 바로 반영되도록 캐시하지 않음
    return new Response(res.body, { status: res.status, headers: h });
  },
};
