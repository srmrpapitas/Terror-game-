// Conexión WebSocket con el servidor de la sala.
export class Net {
  // `code`: sala a la que unirse (en Cloudflare decide a qué servidor de sala conectar).
  constructor(onMessage, onClose, code = null) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const query = code ? `?sala=${encodeURIComponent(code)}` : '';
    this.ws = new WebSocket(`${proto}://${location.host}/ws${query}`);
    this.open = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    this.ws.onclose = onClose;
  }

  send(msg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
