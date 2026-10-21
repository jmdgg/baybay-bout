// "Duel a friend" on the big screen: hosts a room on the duel server, shows the lobby (code, phone address,
// who has joined), and forwards the server's state, battle events and cast attempts to the game.
import { DuelClient } from '../net/DuelClient';
import type { Attempt, NetEvent, RoomState, ServerMessage } from '../net/protocol';

export interface VersusHandlers {
  onState(state: RoomState): void;
  onEvents(events: NetEvent[]): void;
  onAttempt(attempt: Attempt): void;
  onClosed(message: string): void;
}

const $ = (id: string) => document.getElementById(id)!;

export class Versus {
  state: RoomState | null = null;
  code = '';
  private readonly client: DuelClient;
  private hostedResolvers: (() => void)[] = [];

  constructor(private readonly handlers: VersusHandlers) {
    $('room-code').textContent = '····';
    $('lobby-status').textContent = 'Connecting to the duel server…';
    // the room lives as long as this screen's connection; after a drop, host a fresh room
    this.client = new DuelClient(msg => this.onMessage(msg), () => this.client.send({ type: 'host' }),
      connected => { if (!connected) $('lobby-status').textContent = 'Lost the duel server. Reconnecting…'; });
  }

  /** Resolves once the server has given this screen a room code. */
  hosted(): Promise<void> {
    return this.code ? Promise.resolve() : new Promise(resolve => this.hostedResolvers.push(resolve));
  }

  rematch(): void { this.client.send({ type: 'rematch' }); }
  close(): void { this.client.close(); }

  private onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'hosted':
        this.code = msg.code;
        $('room-code').textContent = msg.code;
        $('pad-url').textContent = msg.padUrl || `${location.origin}/pad.html`;
        $('lan-hint').hidden = !!msg.padUrl; // phones can only reach this computer when started with dev:lan
        $('pad-alternates').textContent = msg.alternates?.length ? `If that doesn't open on the phone, try ${msg.alternates.join(' or ')}.` : '';
        this.hostedResolvers.splice(0).forEach(r => r());
        break;
      case 'state':
        this.state = msg;
        this.renderLobby(msg);
        this.handlers.onState(msg);
        break;
      case 'events': this.handlers.onEvents(msg.events); break;
      case 'attempt': this.handlers.onAttempt(msg); break;
      case 'closed': case 'error': this.handlers.onClosed(msg.message); break;
    }
  }

  private renderLobby(s: RoomState): void {
    const slots = [0, 1].map(i => {
      const p = s.players[i];
      const li = document.createElement('li');
      li.className = p ? (p.connected ? 'in' : 'away') : 'open';
      li.textContent = p ? `P${i + 1} · ${p.name}${p.connected ? '' : ' (reconnecting…)'}` : `P${i + 1} · waiting…`;
      return li;
    });
    $('lobby-players').replaceChildren(...slots);
    $('lobby-status').textContent = s.phase === 'countdown' ? `The duel begins in ${Math.ceil(s.countdownMs / 1000)}…`
      : s.players.length < 2 ? 'Waiting for players to join with the code…' : 'Waiting for both players to connect…';
  }
}
