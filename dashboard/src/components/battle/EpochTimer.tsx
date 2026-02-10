"use client";

import { useEffect, useState } from "react";

interface EpochTimerProps {
  currentEpoch: number;
  /** Duration of one epoch in seconds (default 300 = 5 minutes) */
  epochDuration?: number;
  /** Whether the battle is complete (has a winner) */
  isComplete?: boolean;
  /** Name of the winning agent (shown when isComplete is true) */
  winnerName?: string;
}

export default function EpochTimer({
  currentEpoch,
  epochDuration = 300,
  isComplete = false,
  winnerName,
}: EpochTimerProps) {
  // Start the mock timer at a random offset so it feels "in progress"
  const [remaining, setRemaining] = useState(() =>
    Math.floor(epochDuration * 0.62)
  );

  useEffect(() => {
    if (isComplete) return;
    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 0) return epochDuration;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [epochDuration, isComplete]);

  // ── Battle complete state ──────────────────────────────────────────
  if (isComplete) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gold">
              Battle Complete
            </h2>
            <span className="rounded bg-gold/20 px-1.5 py-0.5 text-[10px] text-gold">
              {currentEpoch} epochs
            </span>
          </div>
          <div className="font-mono text-xl font-bold tracking-wider text-gold">
            GG
          </div>
        </div>

        {/* Full gold bar */}
        <div className="h-1 w-full overflow-hidden rounded-full bg-colosseum-bg">
          <div className="h-full w-full rounded-full bg-gold" />
        </div>

        {/* Winner line */}
        {winnerName && (
          <div className="text-center">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/80">
              {winnerName} is the last nad standing
            </span>
          </div>
        )}
      </div>
    );
  }

  // ── Active battle countdown ────────────────────────────────────────
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const pct = (remaining / epochDuration) * 100;

  // Urgency coloring
  const isUrgent = remaining <= 30;
  const isWarning = remaining <= 60 && remaining > 30;

  return (
    <div className={`flex flex-col gap-2 transition-all duration-500 ${isUrgent ? "rounded-lg" : ""}`}
      style={isUrgent ? { boxShadow: "inset 0 0 30px rgba(220,38,38,0.08)" } : undefined}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className={`text-sm font-bold uppercase tracking-wider transition-colors duration-500 ${
            isUrgent ? "text-blood" : "text-gray-500"
          }`}>
            Next Epoch
          </h2>
          <span className={`rounded px-1.5 py-0.5 text-[10px] transition-colors duration-500 ${
            isUrgent
              ? "bg-blood/20 text-blood"
              : "bg-colosseum-surface-light text-gray-500"
          }`}>
            #{currentEpoch + 1}
          </span>
        </div>
        <div
          className={`font-mono text-xl font-bold tabular-nums tracking-wider ${
            isUrgent
              ? "text-blood epoch-urgent"
              : isWarning
                ? "text-gold"
                : "text-white"
          }`}
        >
          {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
        </div>
      </div>

      {/* Progress bar */}
      <div className={`h-1 w-full overflow-hidden rounded-full bg-colosseum-bg transition-all duration-500 ${
        isUrgent ? "h-1.5" : ""
      }`}>
        <div
          className={`h-full rounded-full transition-all duration-1000 ease-linear ${
            isUrgent ? "bg-blood animate-pulse" : isWarning ? "bg-gold" : "bg-accent"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Urgency flash text */}
      {isUrgent && (
        <div className="text-center">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-blood/60 animate-pulse">
            Epoch resolution imminent
          </span>
        </div>
      )}
    </div>
  );
}
