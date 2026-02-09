"use client";

import { useEffect, useState } from "react";
import { CLASS_CONFIG } from "@/components/battle/mock-data";
import type { HighlightEvent } from "@/app/stream/[id]/StreamView";

interface StreamHighlightBannerProps {
  highlight: HighlightEvent;
}

/**
 * Full-width cinematic highlight banner that appears for key battle moments.
 * Slides in from top, holds for a few seconds, then fades out.
 * Used for: deaths, victories, clutch survivals, massive attacks.
 */
export default function StreamHighlightBanner({
  highlight,
}: StreamHighlightBannerProps) {
  const [phase, setPhase] = useState<"enter" | "hold" | "exit">("enter");

  useEffect(() => {
    // Enter animation
    const enterTimer = setTimeout(() => setPhase("hold"), 600);
    // Exit animation
    const exitTimer = setTimeout(() => setPhase("exit"), 4000);

    return () => {
      clearTimeout(enterTimer);
      clearTimeout(exitTimer);
    };
  }, [highlight.id]);

  // Determine styling based on highlight type
  let borderColor = "border-blood/60";
  let glowColor = "shadow-blood/20";
  let titleColor = "text-blood";
  let bgAccent = "bg-blood/5";
  let icon = "\uD83D\uDC80"; // skull

  switch (highlight.type) {
    case "VICTORY":
      borderColor = "border-gold/60";
      glowColor = "shadow-gold/30";
      titleColor = "text-gold";
      bgAccent = "bg-gold/5";
      icon = "\uD83D\uDC51"; // crown
      break;
    case "CLUTCH":
      borderColor = "border-green-500/60";
      glowColor = "shadow-green-500/20";
      titleColor = "text-green-400";
      bgAccent = "bg-green-500/5";
      icon = "\uD83D\uDD25"; // fire
      break;
    case "COMBAT":
      borderColor = "border-blood/60";
      glowColor = "shadow-blood/20";
      titleColor = "text-blood";
      bgAccent = "bg-blood/5";
      icon = "\u2694\uFE0F"; // swords
      break;
    case "DEATH":
    default:
      break;
  }

  // Agent class color override for the icon
  const classColor = highlight.agentClass
    ? CLASS_CONFIG[highlight.agentClass].color
    : "";

  return (
    <div
      className={`pointer-events-none absolute left-0 right-0 top-16 z-40 flex justify-center transition-all duration-500 ${
        phase === "enter"
          ? "translate-y-[-20px] opacity-0"
          : phase === "exit"
            ? "translate-y-[-10px] opacity-0"
            : "translate-y-0 opacity-100"
      }`}
    >
      <div
        className={`mx-8 max-w-2xl overflow-hidden rounded-xl border-2 ${borderColor} ${bgAccent} px-8 py-4 shadow-2xl ${glowColor} backdrop-blur-md`}
      >
        <div className="flex items-center gap-4">
          {/* Icon */}
          <span className="text-3xl">{icon}</span>

          {/* Content */}
          <div className="flex-1">
            <div
              className={`font-cinzel text-xl font-black uppercase tracking-[0.15em] ${titleColor}`}
            >
              {highlight.title}
            </div>
            <div className={`mt-0.5 text-xs text-gray-400 ${classColor}`}>
              {highlight.subtitle}
            </div>
          </div>

          {/* Agent class badge */}
          {highlight.agentClass && (
            <span className="text-2xl">
              {CLASS_CONFIG[highlight.agentClass].emoji}
            </span>
          )}
        </div>

        {/* Animated underline */}
        <div className="mt-3 h-0.5 w-full overflow-hidden rounded-full bg-colosseum-surface-light/30">
          <div
            className={`h-full rounded-full transition-all duration-[4000ms] ease-linear ${
              highlight.type === "VICTORY"
                ? "bg-gold"
                : highlight.type === "CLUTCH"
                  ? "bg-green-500"
                  : "bg-blood"
            }`}
            style={{
              width: phase === "enter" ? "0%" : phase === "hold" ? "100%" : "100%",
            }}
          />
        </div>
      </div>
    </div>
  );
}
