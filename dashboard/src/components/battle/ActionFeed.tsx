"use client";

import { useEffect, useRef } from "react";
import { CLASS_CONFIG, type FeedEntry } from "./mock-data";

interface ActionFeedProps {
  entries: FeedEntry[];
}

/** Color and icon per event type */
const EVENT_STYLE: Record<
  FeedEntry["type"],
  { icon: string; color: string }
> = {
  PREDICTION: { icon: "\uD83D\uDD2E", color: "text-blue-400" },
  ATTACK: { icon: "\u2694\uFE0F", color: "text-blood" },
  DEFEND: { icon: "\uD83D\uDEE1\uFE0F", color: "text-green-400" },
  DEATH: { icon: "\uD83D\uDC80", color: "text-blood-light" },
  SPONSOR: { icon: "\uD83C\uDF81", color: "text-gold" },
  MARKET: { icon: "\uD83D\uDCC8", color: "text-gray-500" },
  STORM: { icon: "\u26A1", color: "text-purple-400" },
  PHASE_CHANGE: { icon: "\uD83C\uDFFA", color: "text-amber-400" },
  TOKEN_TRADE: { icon: "\uD83D\uDCB0", color: "text-green-300" },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export default function ActionFeed({ entries }: ActionFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">
          Battle Log
        </h2>
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blood" />
          <span className="text-[10px] uppercase tracking-wider text-gray-600">
            Live
          </span>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="max-h-64 space-y-1 overflow-y-auto pr-1 scrollbar-thin"
      >
        {entries.map((entry) => {
          const style = EVENT_STYLE[entry.type];
          const agentCfg = entry.agentClass
            ? CLASS_CONFIG[entry.agentClass]
            : null;

          return (
            <div
              key={entry.id}
              className={`feed-entry group flex items-start gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-colosseum-surface-light/30 ${
                entry.type === "DEATH"
                  ? "bg-blood/5 border-l-2 border-blood/30"
                  : entry.type === "ATTACK"
                    ? "border-l-2 border-blood/20"
                    : entry.type === "SPONSOR"
                      ? "border-l-2 border-gold/20"
                      : entry.type === "STORM"
                        ? "bg-purple-500/5 border-l-2 border-purple-500/40"
                        : entry.type === "PHASE_CHANGE"
                          ? "bg-amber-500/10 border-l-2 border-amber-500/40"
                          : entry.type === "TOKEN_TRADE"
                            ? "bg-green-500/5 border-l-2 border-green-500/30"
                            : ""
              }`}
            >
              {/* Timestamp -- suppressHydrationWarning because locale-formatted
                  times can differ between server and client renders */}
              <span
                className="mt-px shrink-0 text-[10px] text-gray-700"
                suppressHydrationWarning
              >
                {formatTime(entry.timestamp)}
              </span>

              {/* Event icon */}
              <span className="mt-px shrink-0">{style.icon}</span>

              {/* Message */}
              <span className={`leading-relaxed ${style.color}`}>
                {entry.agentName && agentCfg ? (
                  <>
                    <span className={`font-bold ${agentCfg.color}`}>
                      {entry.agentName}
                    </span>{" "}
                    <span className="text-gray-400">
                      {entry.message.replace(entry.agentName, "").trim()}
                    </span>
                  </>
                ) : (
                  <span className="text-gray-400">{entry.message}</span>
                )}
              </span>
            </div>
          );
        })}

        {/* Bottom gradient fade for scroll hint */}
      </div>
    </div>
  );
}
