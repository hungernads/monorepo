/**
 * HUNGERNADS - WebSocket Client
 *
 * Connects to the Cloudflare Worker's Durable Object WebSocket endpoint
 * for real-time battle event streaming. Includes automatic reconnection
 * with exponential backoff.
 *
 * Event protocol matches the server-side BattleEvent union type defined
 * in src/api/websocket.ts.
 *
 * Usage:
 *   const ws = new BattleWebSocket('battle-1');
 *   ws.onEvent((event) => console.log(event));
 *   ws.connect();
 *   // later:
 *   ws.disconnect();
 */

import { WS_BASE_URL } from './wallet';

// ─── Event Types (mirror server-side BattleEvent) ────────────────────

export interface EpochStartEvent {
  type: 'epoch_start';
  data: {
    epochNumber: number;
    marketData: {
      prices: Record<string, number>;
      timestamp: number;
    };
  };
}

export interface AgentActionEvent {
  type: 'agent_action';
  data: {
    agentId: string;
    agentName: string;
    prediction: {
      asset: string;
      direction: 'UP' | 'DOWN';
      stake: number;
    };
    attack?: {
      target: string;
      stake: number;
    };
    defend: boolean;
    reasoning: string;
  };
}

export interface PredictionResultEvent {
  type: 'prediction_result';
  data: {
    agentId: string;
    correct: boolean;
    hpChange: number;
    hpAfter: number;
  };
}

export interface CombatResultEvent {
  type: 'combat_result';
  data: {
    attackerId: string;
    defenderId: string;
    damage: number;
    blocked: boolean;
    attackerHpAfter: number;
    defenderHpAfter: number;
    /** True if the attacker betrayed their ally (2x damage). */
    betrayal?: boolean;
  };
}

export interface AgentDeathEvent {
  type: 'agent_death';
  data: {
    agentId: string;
    agentName: string;
    killedBy?: string;
    cause: string;
    epochNumber: number;
  };
}

export interface EpochEndEvent {
  type: 'epoch_end';
  data: {
    agentStates: {
      id: string;
      name: string;
      class: string;
      hp: number;
      isAlive: boolean;
    }[];
    battleComplete: boolean;
  };
}

export interface BattleEndEvent {
  type: 'battle_end';
  data: {
    winnerId: string;
    winnerName: string;
    totalEpochs: number;
  };
}

export interface OddsUpdateEvent {
  type: 'odds_update';
  data: {
    odds: Record<string, number>;
  };
}

// ─── Token / Curve Events (nad.fun streaming) ────────────────────────

export interface TokenBuyEvent {
  type: 'token_buy';
  data: {
    sender: string;
    token: string;
    amountIn: string;
    amountOut: string;
    txHash: string;
    blockNumber: string;
  };
}

export interface TokenSellEvent {
  type: 'token_sell';
  data: {
    sender: string;
    token: string;
    amountIn: string;
    amountOut: string;
    txHash: string;
    blockNumber: string;
  };
}

/** Agent-initiated token trade during a battle (buy-only, per-agent wallet). */
export interface AgentTokenTradeEvent {
  type: 'agent_token_trade';
  data: {
    agentId: string;
    agentName: string;
    action: 'buy' | 'sell';
    /** MON amount (human-readable string, e.g. "0.001") */
    amount: string;
    /** Trigger reason: prediction win, kill trophy, etc. */
    reason: string;
    /** On-chain tx hash (empty string if tx failed) */
    txHash: string;
    epochNumber: number;
    /** Agent's ephemeral wallet address that sent the transaction. */
    agentWallet?: string;
  };
}

export interface CurveUpdateEvent {
  type: 'curve_update';
  data: {
    eventKind: 'Create' | 'Sync' | 'Graduate' | 'TokenLocked';
    token: string;
    txHash: string;
    blockNumber: string;
    details: Record<string, string>;
  };
}

export interface AllianceEventWS {
  type: 'alliance_event';
  data: {
    eventType: 'PROPOSED' | 'FORMED' | 'EXPIRED' | 'BROKEN' | 'BETRAYED';
    agentId: string;
    agentName: string;
    partnerId: string;
    partnerName: string;
    description: string;
    epochsRemaining?: number;
  };
}

// ─── Grid / Item Events ────────────────────────────────────────────

/** Tile type classification from the backend hex grid system. */
export type TileType = 'NORMAL' | 'CORNUCOPIA' | 'EDGE';

/** Item types from the arena system. */
export type ItemType = 'RATION' | 'WEAPON' | 'SHIELD' | 'TRAP' | 'ORACLE';

/**
 * Full grid state snapshot. Sent on initial WebSocket connect and after
 * each epoch for a consistent view of the 37-tile arena.
 */
export interface GridStateEvent {
  type: 'grid_state';
  data: {
    tiles: {
      q: number;
      r: number;
      type: TileType;
      level: number;
      occupantId: string | null;
      items: { id: string; type: ItemType }[];
    }[];
    agentPositions: Record<string, { q: number; r: number }>;
    /** Positions of dead agents at their last known tile (for ghost rendering). */
    deadAgentPositions?: Record<string, { q: number; r: number }>;
    /** Storm tiles for the current phase. Empty/undefined during LOOT. */
    stormTiles?: { q: number; r: number }[];
  };
}

/** Agent moved to a new hex during the movement phase. */
export interface AgentMovedEvent {
  type: 'agent_moved';
  data: {
    agentId: string;
    agentName: string;
    from: { q: number; r: number };
    to: { q: number; r: number };
    success: boolean;
    reason?: string;
    epochNumber: number;
  };
}

/** New item spawned on the grid. */
export interface ItemSpawnedEvent {
  type: 'item_spawned';
  data: {
    itemId: string;
    itemType: ItemType;
    coord: { q: number; r: number };
    epochNumber: number;
    isCornucopia: boolean;
  };
}

/** Agent picked up an item from a tile. */
export interface ItemPickedUpEvent {
  type: 'item_picked_up';
  data: {
    agentId: string;
    agentName: string;
    itemId: string;
    itemType: ItemType;
    coord: { q: number; r: number };
    effect: string;
    hpChange: number;
  };
}

/** Agent triggered a TRAP on a hex tile. */
export interface TrapTriggeredEvent {
  type: 'trap_triggered';
  data: {
    agentId: string;
    agentName: string;
    coord: { q: number; r: number };
    damage: number;
    itemId: string;
  };
}

export interface SponsorBoostEvent {
  type: 'sponsor_boost';
  data: {
    agentId: string;
    tier: string;
    hpBoost: number;
    actualBoost: number;
    hpBefore: number;
    hpAfter: number;
    freeDefend: boolean;
    attackBoost: number;
    message: string;
    /** Sponsor wallet address (added by feed processor). */
    sponsorAddress?: string;
    /** Token amount burned. */
    amount?: number;
  };
}

// ─── Lobby Events ─────────────────────────────────────────────────────

/** Broadcast when an agent joins the lobby or countdown status changes. */
export interface LobbyUpdateEvent {
  type: 'lobby_update';
  data: {
    battleId: string;
    status: 'LOBBY' | 'COUNTDOWN';
    agents: Array<{
      id: string;
      name: string;
      class: string;
      imageUrl?: string;
      position: number;
    }>;
    playerCount: number;
    maxPlayers: number;
    countdownEndsAt?: string;
    feeAmount?: string;
  };
}

/** Emitted when countdown ends and the battle is about to begin. */
export interface BattleStartingEvent {
  type: 'battle_starting';
  data: {
    battleId: string;
    agents: Array<{
      id: string;
      name: string;
      class: string;
      position: { q: number; r: number };
      walletAddress?: string;
    }>;
    startsAt: number;
  };
}

// ─── Battle Phase Types ──────────────────────────────────────────────

/** Battle phase names matching the backend BattlePhase type. */
export type BattlePhase = 'LOOT' | 'HUNT' | 'BLOOD' | 'FINAL_STAND';

/**
 * Emitted when the battle transitions to a new phase.
 * Creates dramatic moments: "THE HUNT BEGINS!", "BLOOD PHASE!", "FINAL STAND!"
 */
export interface PhaseChangeEvent {
  type: 'phase_change';
  data: {
    /** The new phase that just started. */
    phase: BattlePhase;
    /** The previous phase that just ended. */
    previousPhase: BattlePhase;
    /** Storm ring level for the new phase (-1=none, 3=Lv1, 2=Lv1+Lv2, 1=Lv1+Lv2+Lv3). */
    stormRing: number;
    /** Epochs remaining in the new phase. */
    epochsRemaining: number;
    /** Whether combat is enabled in the new phase. */
    combatEnabled: boolean;
    /** Epoch number when this transition occurred. */
    epochNumber: number;
  };
}

/**
 * Emitted when an agent takes storm damage from standing on a dangerous tile.
 * Storm damage increases as phases progress and escalates within each phase.
 */
export interface StormDamageEvent {
  type: 'storm_damage';
  data: {
    agentId: string;
    agentName: string;
    /** Damage dealt by the storm this epoch. */
    damage: number;
    /** The tile coordinate where the agent was standing. */
    tile: { q: number; r: number };
    /** The battle phase during which the damage was dealt. */
    phase: BattlePhase;
    /** Agent's HP after storm damage. */
    hpAfter: number;
  };
}

export type BattleEvent =
  | EpochStartEvent
  | AgentActionEvent
  | PredictionResultEvent
  | CombatResultEvent
  | AgentDeathEvent
  | EpochEndEvent
  | BattleEndEvent
  | OddsUpdateEvent
  | TokenBuyEvent
  | TokenSellEvent
  | CurveUpdateEvent
  | SponsorBoostEvent
  | AllianceEventWS
  | GridStateEvent
  | AgentMovedEvent
  | ItemSpawnedEvent
  | ItemPickedUpEvent
  | TrapTriggeredEvent
  | LobbyUpdateEvent
  | BattleStartingEvent
  | PhaseChangeEvent
  | StormDamageEvent
  | AgentTokenTradeEvent;

export type BattleEventHandler = (event: BattleEvent) => void;
export type ConnectionHandler = (connected: boolean) => void;

// ─── WebSocket Client ────────────────────────────────────────────────

const INITIAL_RECONNECT_DELAY = 1_000;
const MAX_RECONNECT_DELAY = 30_000;
const BACKOFF_MULTIPLIER = 2;

export class BattleWebSocket {
  private battleId: string;
  private ws: WebSocket | null = null;
  private eventHandlers: BattleEventHandler[] = [];
  private connectionHandlers: ConnectionHandler[] = [];
  private reconnectDelay = INITIAL_RECONNECT_DELAY;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private _connected = false;

  constructor(battleId: string) {
    this.battleId = battleId;
  }

  /** Whether the socket is currently open. */
  get connected(): boolean {
    return this._connected;
  }

  /** Open (or re-open) the WebSocket connection. */
  connect(): void {
    this.intentionalClose = false;
    this.clearReconnectTimer();

    // Clean up any existing socket
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }

    const url = `${WS_BASE_URL}/battle/${this.battleId}/stream`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this._connected = true;
      this.reconnectDelay = INITIAL_RECONNECT_DELAY;
      this.notifyConnection(true);
    };

    this.ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data as string) as BattleEvent;
        for (const handler of this.eventHandlers) {
          handler(parsed);
        }
      } catch (err) {
        console.warn('[ws] Failed to parse event:', err);
      }
    };

    this.ws.onclose = (event) => {
      this._connected = false;
      this.notifyConnection(false);
      // Don't reconnect if we closed intentionally or if the server
      // closed with 1000 "Battle completed" (no point reconnecting)
      if (!this.intentionalClose && event.code !== 1000) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (err) => {
      console.warn('[ws] Error:', err);
      // onclose will fire after onerror, which handles reconnection
    };
  }

  /** Gracefully disconnect. Will NOT attempt to reconnect. */
  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
    this.notifyConnection(false);
  }

  /** Register a handler for incoming BattleEvents. Returns an unsubscribe function. */
  onEvent(handler: BattleEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
    };
  }

  /** Register a handler for connection state changes. Returns an unsubscribe function. */
  onConnectionChange(handler: ConnectionHandler): () => void {
    this.connectionHandlers.push(handler);
    return () => {
      this.connectionHandlers = this.connectionHandlers.filter((h) => h !== handler);
    };
  }

  // ─── Private ────────────────────────────────────────────────────────

  private notifyConnection(connected: boolean): void {
    for (const handler of this.connectionHandlers) {
      handler(connected);
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    console.log(
      `[ws] Reconnecting in ${this.reconnectDelay}ms...`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);

    // Exponential backoff with cap
    this.reconnectDelay = Math.min(
      this.reconnectDelay * BACKOFF_MULTIPLIER,
      MAX_RECONNECT_DELAY,
    );
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
