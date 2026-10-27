import type { WebSocket } from 'ws';
import { NO_INPUT, type InputState, type Looks } from '../../shared';
import { MessageGovernor } from './limits';
import { metrics } from './metrics';

/** Skip state frames for clients whose socket buffer is backed up. */
const MAX_BUFFERED_BYTES = 256 * 1024;

/**
 * What a Room needs from a connected player. The WebSocket `Client` is one implementation; a plugin can seat
 * a virtual one (a bot running inside the server) by implementing it.
 */
export interface RoomClient {
  /** connection id; becomes the member id when the client re-attaches to a seat */
  id: string;
  name: string;
  /** storage id of the player's persistent profile (null = guest) */
  profileId: string | null;
  /** looks by character model, from the profile (empty for a guest: every model's default) */
  looks: Looks;
  /** the model the player is shown with outside games */
  avatar?: string;
  /** preferred palette index from the profile (null = none) */
  preferredColor: number | null;
  roomCode: string | null;
  /** peer address (used for the password attempt limit; '' for a virtual client) */
  ip: string;
  /** `droppable` frames (state snapshots) may be skipped under backpressure */
  send(json: string, droppable?: boolean): void;
  close(code?: number, reason?: string): void;
}

export class Client implements RoomClient {
  name = 'Player';
  /** storage id of the player's persistent profile (null = guest) */
  profileId: string | null = null;
  looks: Looks = {};
  avatar: string | undefined = undefined;
  /** preferred palette index from the profile (null = none) */
  preferredColor: number | null = null;
  /** a JOIN_ROOM is waiting for the profile lookup */
  joining = false;
  roomCode: string | null = null;
  /** peer address (X-Forwarded-For when the proxy is trusted); set by the server on connect */
  ip = '';
  input: InputState = NO_INPUT;
  /** Rate buckets + decaying strike counter for inbound messages. */
  readonly governor = new MessageGovernor();

  constructor(
    /** connection id; becomes the member id when the client re-attaches to a seat */
    public id: string,
    private readonly ws: WebSocket,
  ) {}

  /** `droppable` frames (state snapshots) are skipped under backpressure. */
  send(json: string, droppable = false): void {
    if (this.ws.readyState !== this.ws.OPEN) return;
    if (droppable && this.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      metrics.droppedFrames++;
      return;
    }
    this.ws.send(json);
    metrics.msgsOut++;
    metrics.bytesOut += json.length;
  }

  close(code = 1000, reason = ''): void {
    try {
      this.ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }
}
