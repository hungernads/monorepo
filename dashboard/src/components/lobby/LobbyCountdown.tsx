"use client";

import { useState, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LobbyCountdownProps {
  /** ISO timestamp when the countdown ends and battle starts. */
  countdownEndsAt: string;
  /** Called when the countdown reaches zero. */
  onComplete?: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CIRCLE_RADIUS = 54;
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LobbyCountdown({
  countdownEndsAt,
  onComplete,
}: LobbyCountdownProps) {
  const [secondsLeft, setSecondsLeft] = useState<number>(() => {
    const diff = new Date(countdownEndsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / 1000));
  });

  const totalDurationRef = useRef<number>(
    Math.max(1, Math.ceil((new Date(countdownEndsAt).getTime() - Date.now()) / 1000)),
  );

  // Compute total duration once on mount / when countdownEndsAt changes
  useEffect(() => {
    const diff = new Date(countdownEndsAt).getTime() - Date.now();
    const total = Math.max(1, Math.ceil(diff / 1000));
    totalDurationRef.current = total;
    setSecondsLeft(Math.max(0, total));
  }, [countdownEndsAt]);

  // Tick every second
  useEffect(() => {
    const interval = setInterval(() => {
      const diff = new Date(countdownEndsAt).getTime() - Date.now();
      const remaining = Math.max(0, Math.ceil(diff / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        onComplete?.();
      }
    }, 200); // Update slightly faster than 1s for smoother UX

    return () => clearInterval(interval);
  }, [countdownEndsAt, onComplete]);

  // Progress: 1.0 = full, 0.0 = done
  const totalDuration =
    typeof totalDurationRef.current === "number"
      ? totalDurationRef.current
      : 60;
  const progress = totalDuration > 0 ? secondsLeft / totalDuration : 0;
  const strokeDashoffset = CIRCLE_CIRCUMFERENCE * (1 - progress);

  const isUrgent = secondsLeft <= 10;

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Title */}
      <div className="text-xs font-bold uppercase tracking-widest text-blood-light">
        Battle Starts In
      </div>

      {/* Circular countdown */}
      <div className="relative flex items-center justify-center">
        <svg
          width="140"
          height="140"
          viewBox="0 0 120 120"
          className="drop-shadow-lg"
        >
          {/* Background ring */}
          <circle
            cx="60"
            cy="60"
            r={CIRCLE_RADIUS}
            fill="none"
            stroke="rgba(37,37,64,0.8)"
            strokeWidth="6"
          />
          {/* Progress ring */}
          <circle
            cx="60"
            cy="60"
            r={CIRCLE_RADIUS}
            fill="none"
            stroke={isUrgent ? "#dc2626" : "#f59e0b"}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={CIRCLE_CIRCUMFERENCE}
            strokeDashoffset={strokeDashoffset}
            transform="rotate(-90 60 60)"
            className="transition-all duration-200"
            style={{
              filter: isUrgent
                ? "drop-shadow(0 0 8px rgba(220,38,38,0.6))"
                : "drop-shadow(0 0 6px rgba(245,158,11,0.4))",
            }}
          />
        </svg>

        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={`font-mono text-3xl font-black tabular-nums ${
              isUrgent
                ? "animate-countdown-urgent text-blood"
                : "text-gold"
            }`}
          >
            {secondsLeft}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-gray-500">
            seconds
          </span>
        </div>
      </div>

      {/* Sub-text */}
      <div
        className={`text-center text-[11px] ${
          isUrgent ? "font-bold text-blood-light" : "text-gray-500"
        }`}
      >
        {isUrgent
          ? "Prepare for battle!"
          : "Waiting for more gladiators to join..."}
      </div>
    </div>
  );
}
