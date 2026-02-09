"use client";

import { useState, useEffect, useRef } from "react";

interface WatcherCountProps {
  /** Base watcher count. Simulated fluctuation is layered on top. */
  baseCount?: number;
  /** Whether the battle is live (enables fluctuation). */
  isLive?: boolean;
}

/**
 * Displays "X nads watching" with a subtle live fluctuation.
 * For MVP this is simulated — in production the backend would provide real counts.
 */
export default function WatcherCount({
  baseCount = 42,
  isLive = true,
}: WatcherCountProps) {
  const [count, setCount] = useState(baseCount);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isLive) {
      setCount(baseCount);
      return;
    }

    // Fluctuate +/- 0-3 every 5-10 seconds
    intervalRef.current = setInterval(() => {
      setCount((prev) => {
        const delta = Math.floor(Math.random() * 7) - 3; // -3 to +3
        return Math.max(1, prev + delta);
      });
    }, 5000 + Math.random() * 5000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isLive, baseCount]);

  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-500">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="h-3.5 w-3.5 text-gray-600"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
      <span>
        <span className="text-white">{count}</span> nads watching
      </span>
      {isLive && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
      )}
    </div>
  );
}
