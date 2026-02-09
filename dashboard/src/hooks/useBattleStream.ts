/**
 * HUNGERNADS - useBattleStream Hook
 *
 * React hook that wraps BattleWebSocket to provide reactive battle state.
 * Manages the WebSocket lifecycle (connect on mount, disconnect on unmount)
 * and reduces incoming events into usable React state.
 *
 * Usage:
 *   function BattlePage({ battleId }: { battleId: string }) {
 *     const { connected, events, agentStates, marketData, latestEpoch } =
 *       useBattleStream(battleId);
 *     // ...
 *   }
 */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  BattleWebSocket,
  type BattleEvent,
  type EpochEndEvent,
  type EpochStartEvent,
  type BattleEndEvent,
  type GridStateEvent,
  type ItemType,
  type TileType,
} from '@/lib/websocket';

// ─── Types ───────────────────────────────────────────────────────────

export interface StreamAgentState {
  id: string;
  name: string;
  class: string;
  hp: number;
  isAlive: boolean;
  thoughts?: string[];
}

export interface StreamMarketData {
  prices: Record<string, number>;
  timestamp: number;
}

/** Grid tile state from the grid_state WebSocket event. */
export interface StreamGridTile {
  q: number;
  r: number;
  type: TileType;
  occupantId: string | null;
  items: { id: string; type: ItemType }[];
}

/** Agent position from the grid_state event (agentId -> hex coord). */
export type StreamAgentPositions = Record<string, { q: number; r: number }>;

export interface UseBattleStreamResult {
  /** Whether the WebSocket is currently connected. */
  connected: boolean;
  /** Full history of received events (capped at 500). */
  events: BattleEvent[];
  /** Latest agent states from the most recent epoch_end event. */
  agentStates: StreamAgentState[];
  /** Market data from the most recent epoch_start event. */
  marketData: StreamMarketData | null;
  /** The latest epoch number observed. */
  latestEpoch: number;
  /** The winner info, if the battle has ended. */
  winner: BattleEndEvent['data'] | null;
  /** Latest grid tile states from the most recent grid_state event. */
  gridTiles: StreamGridTile[];
  /** Agent positions from the most recent grid_state event. */
  agentPositions: StreamAgentPositions;
}

// ─── Constants ───────────────────────────────────────────────────────

/** Cap event history to prevent unbounded memory growth. */
const MAX_EVENTS = 500;

// ─── Hook ────────────────────────────────────────────────────────────

export function useBattleStream(battleId: string): UseBattleStreamResult {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<BattleEvent[]>([]);
  const [agentStates, setAgentStates] = useState<StreamAgentState[]>([]);
  const [marketData, setMarketData] = useState<StreamMarketData | null>(null);
  const [latestEpoch, setLatestEpoch] = useState(0);
  const [winner, setWinner] = useState<BattleEndEvent['data'] | null>(null);
  const [gridTiles, setGridTiles] = useState<StreamGridTile[]>([]);
  const [agentPositions, setAgentPositions] = useState<StreamAgentPositions>({});

  const wsRef = useRef<BattleWebSocket | null>(null);

  // Process incoming events and update derived state
  const handleEvent = useCallback((event: BattleEvent) => {
    // Append to event history (with cap)
    setEvents((prev) => {
      const next = [...prev, event];
      return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
    });

    switch (event.type) {
      case 'epoch_start': {
        const e = event as EpochStartEvent;
        setLatestEpoch(e.data.epochNumber);
        setMarketData(e.data.marketData);
        break;
      }

      case 'epoch_end': {
        const e = event as EpochEndEvent;
        setAgentStates(e.data.agentStates);
        break;
      }

      case 'battle_end': {
        const e = event as BattleEndEvent;
        setWinner(e.data);
        break;
      }

      case 'grid_state': {
        const e = event as GridStateEvent;
        setGridTiles(e.data.tiles);
        setAgentPositions(e.data.agentPositions);
        break;
      }

      // Other event types (agent_action, prediction_result, combat_result,
      // agent_death, odds_update, agent_moved, item_spawned, item_picked_up,
      // trap_triggered) are stored in the events array for the ActionFeed
      // and BattleView components to consume. No derived state needed.
      default:
        break;
    }
  }, []);

  useEffect(() => {
    // Don't connect for empty battle IDs
    if (!battleId) return;

    const ws = new BattleWebSocket(battleId);
    wsRef.current = ws;

    const unsubEvent = ws.onEvent(handleEvent);
    const unsubConn = ws.onConnectionChange(setConnected);

    ws.connect();

    return () => {
      unsubEvent();
      unsubConn();
      ws.disconnect();
      wsRef.current = null;
    };
  }, [battleId, handleEvent]);

  return {
    connected,
    events,
    agentStates,
    marketData,
    latestEpoch,
    winner,
    gridTiles,
    agentPositions,
  };
}

export default useBattleStream;
