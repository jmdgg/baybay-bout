// Vite plugin: serves "Duel a friend" rooms over WebSocket at /duel on the same port as the game (dev and preview).
// The room logic lives in rooms.js; this file only moves JSON between sockets and it.
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { Plugin } from 'vite';
import { WebSocketServer, type WebSocket } from 'ws';
import { Rooms } from './rooms.js';

const TICK_MS = 50; // 20 Hz: burns, countdowns and state broadcasts

type Adapters = ReturnType<typeof networkInterfaces>;
const PRIVATE = /^(10.|192.168.|172.(1[6-9]|2d|3[01]).)/;
const VIRTUAL = /vpn|virtual|vbox|vmware|vethernet|hyper-v|docker|wsl|tailscale|zerotier|hamachi|radmin|loopback/i;

/** Private IPv4 addresses phones on the same Wi-Fi might reach, best guess first. */
export function lanAddresses(adapters: Adapters = networkInterfaces()): string[] {
  const score = (name: string, ip: string) =>
    (/wi-?fi|wlan|wireless/i.test(name) ? 2 : /ethernet|^end|^ethd/i.test(name) ? 1 : 0)
    - (ip.startsWith('192.168.56.') ? 3 : 0); // VirtualBox's default host-only network
  return Object.entries(adapters)
    .flatMap(([name, list]) => (list ?? []).filter(i => i.family === 'IPv4' && !i.internal && PRIVATE.test(i.address) && !VIRTUAL.test(name))
      .map(i => ({ ip: i.address, s: score(name, i.address) })))
    .sort((a, b) => b.s - a.s)
    .map(x => x.ip);
}

/** Phone addresses for the lobby ([] while the server only listens on this computer: run npm run dev:lan). */
export function padUrls(server: Pick<HttpServer, 'address'>, adapters?: Adapters): string[] {
  const address = server.address() as AddressInfo | null;
  if (!address || ['127.0.0.1', '::1', 'localhost'].includes(address.address)) return [];
  return lanAddresses(adapters).map(ip => `http://${ip}:${address.port}/pad.html`);
}

function attach(server: HttpServer | null): void {
  if (!server) return;
  const rooms = new Rooms();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/duel') return; // leave Vite's HMR socket alone
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws: WebSocket) => {
    const conn = { send: (msg: unknown) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); } } as Record<string, unknown> & { send: (m: unknown) => void };
    ws.on('message', data => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(String(data)); } catch { return conn.send({ type: 'error', message: 'Unreadable message.' }); }
      if (!msg || typeof msg !== 'object') return;
      try {
        if (msg.type === 'host') rooms.host(conn, padUrls(server));
        else if (msg.type === 'join') rooms.join(conn, msg);
        else if (msg.type === 'cast') rooms.cast(conn, msg);
        else if (msg.type === 'rematch') rooms.rematch(conn);
        else if (msg.type === 'leave') rooms.leave(conn);
      } catch (error) {
        console.error('[duel]', error); // never let one bad message take the dev server down
        conn.send({ type: 'error', message: 'The duel server could not handle that.' });
      }
    });
    ws.on('close', () => rooms.leave(conn));
  });
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    rooms.tick(now - last);
    last = now;
  }, TICK_MS);
  server.on('close', () => { clearInterval(timer); wss.close(); });
}

export function duelServer(): Plugin {
  return {
    name: 'baybay-duel',
    configureServer: server => attach(server.httpServer as HttpServer | null),
    configurePreviewServer: server => attach(server.httpServer as HttpServer),
  };
}
