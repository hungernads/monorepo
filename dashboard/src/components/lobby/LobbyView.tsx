"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  BattleWebSocket,
  type BattleEvent,
  type LobbyUpdateEvent,
  type BattleStartingEvent,
} from "@/lib/websocket";
import LobbyAgentSlot, { type LobbyAgentData } from "./LobbyAgentSlot";
import LobbyCountdown from "./LobbyCountdown";
import JoinForm from "./JoinForm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LobbyViewProps {
  battleId: string;
}

// Session key for tracking if user has joined this lobby
function getJoinedKey(battleId: string): string {
  return `hnads_joined_${battleId}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LobbyView({ battleId }: LobbyViewProps) {
  const router = useRouter();

  // ---- State ----
  const [connected, setConnected] = useState(false);
  const [agents, setAgents] = useState<LobbyAgentData[]>([]);
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [status, setStatus] = useState<"LOBBY" | "COUNTDOWN">("LOBBY");
  const [countdownEndsAt, setCountdownEndsAt] = useState<string | null>(null);
  const [feeAmount, setFeeAmount] = useState<string>('0');
  const [hasJoined, setHasJoined] = useState(false);
  const [battleStarting, setBattleStarting] = useState(false);

  const [copied, setCopied] = useState<'id' | 'link' | null>(null);
  const wsRef = useRef<BattleWebSocket | null>(null);

  const lobbyUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/lobby/${battleId}`;
  }, [battleId]);

  // Check if user already joined (from localStorage)
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(getJoinedKey(battleId));
      if (stored) setHasJoined(true);
    } catch {
      // sessionStorage unavailable (SSR)
    }
  }, [battleId]);

  // ---- WS Event Handler ----
  const handleEvent = useCallback(
    (event: BattleEvent) => {
      // lobby_update
      if (event.type === "lobby_update") {
        const e = event as LobbyUpdateEvent;
        setAgents(e.data.agents as LobbyAgentData[]);
        setMaxPlayers(e.data.maxPlayers);
        setStatus(e.data.status);
        setCountdownEndsAt(e.data.countdownEndsAt ?? null);
        if (e.data.feeAmount) setFeeAmount(e.data.feeAmount);
        return;
      }

      // battle_starting -> redirect to live battle
      if (event.type === "battle_starting") {
        const e = event as BattleStartingEvent;
        setBattleStarting(true);
        // Short delay for dramatic effect before redirect
        setTimeout(() => {
          router.push(`/battle/${e.data.battleId}`);
        }, 1500);
        return;
      }
    },
    [router],
  );

  // ---- WebSocket Connection ----
  useEffect(() => {
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

  // ---- Handlers ----
  const handleJoined = useCallback(
    (agentId: string) => {
      setHasJoined(true);
      try {
        sessionStorage.setItem(getJoinedKey(battleId), agentId);
      } catch {
        // sessionStorage unavailable
      }
    },
    [battleId],
  );

  const copyToClipboard = useCallback(async (text: string, type: 'id' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // fallback
    }
  }, []);

  // ---- Derived State ----
  const slots = Array.from({ length: maxPlayers }, (_, i) => {
    const agent = agents.find((a) => a.position === i + 1) ?? null;
    return { slotNumber: i + 1, agent };
  });

  const isFull = agents.length >= maxPlayers;
  const showJoinForm = !hasJoined && !isFull && !battleStarting;

  // ---- Render: Battle Starting Transition ----
  if (battleStarting) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center">
        <div className="mb-6 animate-winner-glow rounded-lg border-2 border-gold bg-colosseum-surface px-8 py-6 text-center">
          <div className="mb-2 font-cinzel text-3xl font-black uppercase tracking-widest text-gold">
            Battle Begins!
          </div>
          <div className="text-sm text-gray-400">
            The gates are opening... entering the arena.
          </div>
        </div>
      </div>
    );
  }

  // ---- Render: Main Lobby ----
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="mb-2 font-cinzel text-2xl font-black uppercase tracking-widest text-gold sm:text-3xl">
          The Arena Awaits
        </h1>
        <p className="text-sm text-gray-500">
          Arena #{battleId.slice(0, 8)} &mdash;{" "}
          {agents.length}/{maxPlayers} gladiators
        </p>
        {feeAmount !== '0' && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-gold/30 bg-gold/10 px-3 py-1">
            <span className="text-xs font-bold text-gold">
              Entry Fee: {feeAmount} MON
            </span>
          </div>
        )}

        {/* Connection indicator */}
        <div className="mt-2 flex items-center justify-center gap-1.5">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              connected ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]" : "bg-red-500"
            }`}
          />
          <span className="text-[10px] uppercase tracking-wider text-gray-600">
            {connected ? "Live" : "Connecting..."}
          </span>
        </div>
      </div>

      {/* Share / Copy Battle ID */}
      <div className="mb-6 mx-auto max-w-md">
        <div className="rounded-lg border border-colosseum-surface-light bg-colosseum-surface p-3">
          <div className="mb-2 text-center text-[10px] font-bold uppercase tracking-widest text-gray-500">
            Share this arena
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 truncate rounded border border-colosseum-surface-light bg-colosseum-bg px-3 py-1.5 font-mono text-xs text-gray-300">
              {battleId}
            </div>
            <button
              onClick={() => copyToClipboard(battleId, 'id')}
              className="shrink-0 rounded border border-gold/30 bg-gold/10 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gold transition-colors hover:bg-gold/20"
            >
              {copied === 'id' ? 'Copied!' : 'Copy ID'}
            </button>
            <button
              onClick={() => copyToClipboard(lobbyUrl, 'link')}
              className="shrink-0 rounded border border-gold/30 bg-gold/10 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gold transition-colors hover:bg-gold/20"
            >
              {copied === 'link' ? 'Copied!' : 'Copy Link'}
            </button>
          </div>
        </div>
      </div>

      {/* Countdown (when active) */}
      {status === "COUNTDOWN" && countdownEndsAt && (
        <div className="mb-8 flex justify-center">
          <LobbyCountdown countdownEndsAt={countdownEndsAt} />
        </div>
      )}

      {/* Status banner */}
      {status === "LOBBY" && (
        <div className="mb-6 flex items-center justify-center">
          <div className="flex items-center gap-2 rounded-lg border border-gold/20 bg-gold/5 px-4 py-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-gold" />
            <span className="text-xs font-medium text-gold">
              {agents.length < 5
                ? `Need ${5 - agents.length} more gladiators to start countdown`
                : "Waiting for more gladiators..."}
            </span>
          </div>
        </div>
      )}

      {/* Agent Slots Grid — 2x4 */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {slots.map((slot) => (
          <LobbyAgentSlot
            key={slot.slotNumber}
            agent={slot.agent}
            slotNumber={slot.slotNumber}
          />
        ))}
      </div>

      {/* Arena Gate Divider */}
      <div className="relative mb-8">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-colosseum-surface-light" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-colosseum-bg px-4 text-xs font-bold uppercase tracking-widest text-gray-600">
            {hasJoined
              ? "You have entered"
              : isFull
                ? "Arena is full"
                : "Enter the Arena"}
          </span>
        </div>
      </div>

      {/* Join Form or Status */}
      {showJoinForm ? (
        <div className="mx-auto max-w-lg rounded-lg border border-colosseum-surface-light bg-colosseum-surface p-6">
          <JoinForm
            battleId={battleId}
            onJoined={handleJoined}
            disabled={false}
            feeAmount={feeAmount}
          />
        </div>
      ) : hasJoined ? (
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-5 py-3">
            <svg
              className="h-5 w-5 text-green-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span className="text-sm font-bold text-green-400">
              You&apos;re in! Waiting for battle to begin...
            </span>
          </div>
        </div>
      ) : isFull ? (
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-lg border border-blood/30 bg-blood/10 px-5 py-3">
            <span className="text-sm font-bold text-blood-light">
              Arena is full. Spectating only.
            </span>
          </div>
        </div>
      ) : null}

      {/* Footer — lore flavor */}
      <div className="mt-12 text-center text-[11px] text-gray-700">
        &ldquo;Those who enter the arena must fight. Those who watch must
        choose.&rdquo;
      </div>
    </div>
  );
}
