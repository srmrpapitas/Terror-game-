// Versión para Cloudflare Workers: el mismo juego que server/index.js, pero cada sala
// vive en un Durable Object (una instancia por código de sala) y los archivos del
// cliente salen de dist/. El modelo del monstruo se sirve desde R2 si no está en dist/.
import { Room } from '../server/game.js';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Se esperaba WebSocket', { status: 426 });
      let code = (url.searchParams.get('sala') || '').toUpperCase();
      if (!/^[A-Z]{4}$/.test(code)) {
        code = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
      }
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      const forward = new URL(request.url);
      forward.searchParams.set('code', code);
      return stub.fetch(new Request(forward, request));
    }

    if (url.pathname.startsWith('/models/')) {
      // Con la SPA, un archivo que no existe devuelve index.html: eso cuenta como "no está"
      const fromAssets = await env.ASSETS.fetch(request);
      if (fromAssets.ok && !(fromAssets.headers.get('Content-Type') || '').includes('text/html')) return fromAssets;
      const obj = env.MODELS && (await env.MODELS.get(url.pathname.slice('/models/'.length)));
      if (!obj) return new Response('No encontrado', { status: 404 });
      return new Response(obj.body, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'public, max-age=86400',
          ETag: obj.httpEtag,
        },
      });
    }

    return env.ASSETS.fetch(request);
  },
};

// Una sala de juego. Usa la misma clase Room que el servidor de Node.
export class GameRoom {
  constructor(state) {
    this.state = state;
    this.room = null;
    this.nextId = 1;
  }

  async fetch(request) {
    const code = new URL(request.url).searchParams.get('code');
    const { 0: client, 1: ws } = new WebSocketPair();
    ws.accept();
    const id = String(this.nextId++);
    const send = (msg) => {
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        /* conexión cerrada */
      }
    };
    let joined = false;

    ws.addEventListener('message', (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!joined) {
        const name = String(msg.name || 'Jugador').slice(0, 16);
        if (msg.t === 'create') {
          if (this.room) return send({ t: 'error', msg: 'Inténtalo otra vez.' });
          this.room = new Room(code, () => (this.room = null));
        } else if (msg.t === 'join') {
          if (!this.room) return send({ t: 'error', msg: 'No existe una sala con ese código.' });
        } else {
          return;
        }
        if (!this.room.addPlayer(id, name, send)) return send({ t: 'error', msg: 'La sala está llena (máximo 4).' });
        joined = true;
        return;
      }
      this.room?.handle(id, msg);
    });

    const leave = () => {
      if (joined) this.room?.removePlayer(id);
      joined = false;
    };
    ws.addEventListener('close', leave);
    ws.addEventListener('error', leave);

    return new Response(null, { status: 101, webSocket: client });
  }
}
