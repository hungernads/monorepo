"use client";

import { useEffect, useRef } from "react";
import { CLASS_CONFIG, type FeedEntry } from "@/components/battle/mock-data";

interface StreamActionFeedProps {
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
};

/**
 * Stream-optimized action feed.
 * Smaller, more compact than the main ActionFeed. Semi-transparent background.
 * Designed to overlay on a stream without being too intrusive.
 */
export default function StreamActionFeed({ entries }: StreamActionFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600">
            Battle Log
          </h3>
          <span className="flex items-center gap-1">
            <span className="h-1 w-1 animate-pulse rounded-full bg-blood" />
            <span className="text-[8px] uppercase tracking-wider text-gray-700">
              Live
            </span>
          </span>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-0.5 overflow-y-auto pr-1 scrollbar-thin"
      >
        {entries.map((entry) => {
          const style = EVENT_STYLE[entry.type];
          const agentCfg = entry.agentClass
            ? CLASS_CONFIG[entry.agentClass]
            : null;

          return (
            <div
              key={entry.id}
              className={`stream-feed-entry flex items-start gap-1.5 rounded px-2 py-1 text-[10px] ${
                entry.type === "DEATH"
                  ? "bg-blood/10 border-l-2 border-blood/40"
                  : entry.type === "ATTACK"
                    ? "border-l-2 border-blood/20 bg-colosseum-bg/30"
                    : entry.type === "SPONSOR"
                      ? "border-l-2 border-gold/20 bg-gold/5"
                      : "bg-colosseum-bg/20"
              }`}
            >
              <span className="mt-px shrink-0 text-[9px]">{style.icon}</span>
              <span className={`leading-relaxed ${style.color}`}>
                {entry.agentName && agentCfg ? (
                  <>
                    <span className={`font-bold ${agentCfg.color}`}>
                      {entry.agentName}
                    </span>{" "}
                    <span className="text-gray-500">
                      {entry.message.replace(entry.agentName, "").trim()}
                    </span>
                  </>
                ) : (
                  <span className="text-gray-500">{entry.message}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
