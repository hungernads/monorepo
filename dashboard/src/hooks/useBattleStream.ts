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
  type BattlePhase,
  type EpochEndEvent,
  type EpochStartEvent,
  type BattleEndEvent,
  type GridStateEvent,
  type AgentMovedEvent,
  type PhaseChangeEvent,
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
  level: number;
  occupantId: string | null;
  items: { id: string; type: ItemType }[];
}

/** Current battle phase state derived from phase_change WS events. */
export interface StreamPhaseState {
  /** Current phase name. */
  phase: BattlePhase;
  /** Epochs remaining in the current phase (decremented on each epoch_start). */
  epochsRemaining: number;
  /** Whether combat is enabled in the current phase. */
  combatEnabled: boolean;
  /** Storm ring level for the current phase. */
  stormRing: number;
  /** Epoch number when this phase started. */
  phaseStartEpoch: number;
  /** Total epochs in this phase (computed: phaseStartEpoch + epochsRemaining - 1 at transition). */
  phaseTotalEpochs: number;
}

/** Recent agent movement from agent_moved events (cleared each epoch). */
export interface RecentMove {
  agentId: string;
  agentName: string;
  from: { q: number; r: number };
  to: { q: number; r: number };
  success: boolean;
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
  /** Recent movement events from the current epoch (cleared on epoch_start). */
  recentMoves: RecentMove[];
  /** Current battle phase state (null until first phase_change event or client-side computation). */
  phaseState: StreamPhaseState | null;
  /** Storm tile coordinates from the most recent grid_state event. Empty during LOOT. */
  stormTiles: { q: number; r: number }[];
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
  const [recentMoves, setRecentMoves] = useState<RecentMove[]>([]);
  const [phaseState, setPhaseState] = useState<StreamPhaseState | null>(null);
  const [stormTiles, setStormTiles] = useState<{ q: number; r: number }[]>([]);

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
        // Clear movement trails from previous epoch
        setRecentMoves([]);
        // Decrement epochs remaining in current phase (if tracked)
        setPhaseState((prev) => {
          if (!prev) return prev;
          const remaining = Math.max(0, prev.epochsRemaining - 1);
          return { ...prev, epochsRemaining: remaining };
        });
        break;
      }

      case 'epoch_end': {
        const e = event as EpochEndEvent;
        setAgentStates(e.data.agentStates);
        // If battle is complete but we haven't received battle_end yet,
        // derive winner from the sole surviving agent as a fallback
        if (e.data.battleComplete) {
          setWinner((prev) => {
            if (prev) return prev; // already have winner from battle_end
            const alive = e.data.agentStates.filter((a) => a.isAlive);
            if (alive.length === 1) {
              return {
                winnerId: alive[0].id,
                winnerName: alive[0].name,
                totalEpochs: 0, // unknown from epoch_end alone
              };
            }
            return prev;
          });
        }
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
        setStormTiles(e.data.stormTiles ?? []);
        break;
      }

      case 'agent_moved': {
        const e = event as AgentMovedEvent;
        setRecentMoves((prev) => [
          ...prev,
          {
            agentId: e.data.agentId,
            agentName: e.data.agentName,
            from: e.data.from,
            to: e.data.to,
            success: e.data.success,
          },
        ]);
        break;
      }

      case 'phase_change': {
        const e = event as PhaseChangeEvent;
        setPhaseState({
          phase: e.data.phase,
          epochsRemaining: e.data.epochsRemaining,
          combatEnabled: e.data.combatEnabled,
          stormRing: e.data.stormRing,
          phaseStartEpoch: e.data.epochNumber,
          phaseTotalEpochs: e.data.epochsRemaining,
        });
        break;
      }

      // Other event types (agent_action, prediction_result, combat_result,
      // agent_death, odds_update, item_spawned, item_picked_up,
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
    recentMoves,
    phaseState,
    stormTiles,
  };
}

export default useBattleStream;
