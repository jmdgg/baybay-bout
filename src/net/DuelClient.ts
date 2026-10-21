// WebSocket client for the duel server on the same host as the page; reconnects after Wi-Fi blips.
import type { ClientMessage, ServerMessage } from './protocol';

export class DuelClient {
  private ws: WebSocket | null = null;
  private closed = false;
  private retryMs = 500;

  constructor(
    private readonly onMessage: (msg: ServerMessage) => void,
    /** Runs on every (re)connect: send host/join from here. */
    private readonly onOpen: () => void,
    private readonly onStatus: (connected: boolean) => void = () => undefined,
  ) {
    this.connect();
  }

  private connect(): void {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/duel`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => { this.retryMs = 500; this.onStatus(true); this.onOpen(); };
    ws.onmessage = e => {
      try { this.onMessage(JSON.parse(String(e.data)) as ServerMessage); } catch { /* ignore a malformed frame */ }
    };
    ws.onclose = () => {
      this.onStatus(false);
      if (this.closed) return;
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(5000, this.retryMs * 2);
    };
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.closed = true;
    this.send({ type: 'leave' });
    this.ws?.close();
  }
}
