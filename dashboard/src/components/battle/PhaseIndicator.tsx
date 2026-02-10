"use client";

import { useEffect, useState } from "react";
import type { BattlePhase } from "@/lib/websocket";

// ---------------------------------------------------------------------------
// Phase visual config
// ---------------------------------------------------------------------------

interface PhaseVisual {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  glowColor: string;
  icon: string;
  description: string;
}

const PHASE_VISUALS: Record<BattlePhase, PhaseVisual> = {
  LOOT: {
    label: "LOOT PHASE",
    color: "#22c55e",
    bgColor: "rgba(34, 197, 94, 0.1)",
    borderColor: "rgba(34, 197, 94, 0.3)",
    glowColor: "rgba(34, 197, 94, 0.15)",
    icon: "\u{1F4E6}",
    description: "Race for cornucopia loot. No combat.",
  },
  HUNT: {
    label: "HUNT PHASE",
    color: "#f59e0b",
    bgColor: "rgba(245, 158, 11, 0.1)",
    borderColor: "rgba(245, 158, 11, 0.3)",
    glowColor: "rgba(245, 158, 11, 0.15)",
    icon: "\u{1F3AF}",
    description: "Combat enabled. Outer ring is storm.",
  },
  BLOOD: {
    label: "BLOOD PHASE",
    color: "#dc2626",
    bgColor: "rgba(220, 38, 38, 0.1)",
    borderColor: "rgba(220, 38, 38, 0.3)",
    glowColor: "rgba(220, 38, 38, 0.15)",
    icon: "\u2694\uFE0F",
    description: "Storm tightens. Forced fights.",
  },
  FINAL_STAND: {
    label: "FINAL STAND",
    color: "#a855f7",
    bgColor: "rgba(168, 85, 247, 0.1)",
    borderColor: "rgba(168, 85, 247, 0.3)",
    glowColor: "rgba(168, 85, 247, 0.15)",
    icon: "\u{1F480}",
    description: "Only center safe. Kill or die.",
  },
};

/** Ordered phase list for the progress stepper. */
const PHASE_ORDER: BattlePhase[] = ["LOOT", "HUNT", "BLOOD", "FINAL_STAND"];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PhaseIndicatorProps {
  /** Current battle phase (null if no phase data yet). */
  currentPhase: BattlePhase | null;
  /** Epochs remaining in the current phase. */
  epochsRemaining: number;
  /** Total epochs allocated to the current phase. */
  phaseTotalEpochs: number;
  /** Whether the battle is finished. */
  isComplete: boolean;
  /** Current epoch number (for display). */
  currentEpoch: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PhaseIndicator({
  currentPhase,
  epochsRemaining,
  phaseTotalEpochs,
  isComplete,
  currentEpoch,
}: PhaseIndicatorProps) {
  const [stormWarningVisible, setStormWarningVisible] = useState(false);
  const [phaseTransitionFlash, setPhaseTransitionFlash] = useState(false);

  // Detect storm warning: 1 epoch remaining means next epoch transitions
  const isStormWarning =
    !isComplete &&
    currentPhase !== null &&
    currentPhase !== "FINAL_STAND" &&
    epochsRemaining === 1;

  // Flash animation when phase changes
  useEffect(() => {
    if (!currentPhase) return;
    setPhaseTransitionFlash(true);
    const timer = setTimeout(() => setPhaseTransitionFlash(false), 1200);
    return () => clearTimeout(timer);
  }, [currentPhase]);

  // Pulse storm warning
  useEffect(() => {
    if (!isStormWarning) {
      setStormWarningVisible(false);
      return;
    }
    setStormWarningVisible(true);
  }, [isStormWarning]);

  if (!currentPhase) return null;

  const visual = PHASE_VISUALS[currentPhase];
  const phaseIndex = PHASE_ORDER.indexOf(currentPhase);

  // Epoch progress within current phase
  const epochsElapsedInPhase =
    phaseTotalEpochs > 0 ? phaseTotalEpochs - epochsRemaining : 0;
  const progressPct =
    phaseTotalEpochs > 0
      ? Math.min(100, (epochsElapsedInPhase / phaseTotalEpochs) * 100)
      : 0;

  // Next phase name for storm warning
  const nextPhase =
    phaseIndex < PHASE_ORDER.length - 1
      ? PHASE_VISUALS[PHASE_ORDER[phaseIndex + 1]]
      : null;

  if (isComplete) {
    return (
      <div
        className="flex items-center justify-center gap-2 rounded-lg border px-3 py-2"
        style={{
          backgroundColor: "rgba(245, 158, 11, 0.08)",
          borderColor: "rgba(245, 158, 11, 0.2)",
        }}
      >
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70">
          Battle concluded after {currentEpoch} epochs
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Phase name + progress */}
      <div
        className="rounded-lg border transition-all duration-500"
        style={{
          backgroundColor: visual.bgColor,
          borderColor: phaseTransitionFlash ? visual.color : visual.borderColor,
          boxShadow: phaseTransitionFlash
            ? `0 0 20px ${visual.glowColor}, 0 0 40px ${visual.glowColor}`
            : `0 0 8px ${visual.glowColor}`,
        }}
      >
        <div className="flex items-center justify-between px-3 py-2 sm:px-4">
          {/* Phase name */}
          <div className="flex items-center gap-2">
            <span
              className="font-cinzel text-xs font-black tracking-[0.15em] transition-colors duration-500 sm:text-sm"
              style={{ color: visual.color }}
            >
              {visual.label}
            </span>
            <span
              className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider sm:text-[10px]"
              style={{
                backgroundColor: `${visual.color}15`,
                color: visual.color,
                border: `1px solid ${visual.color}30`,
              }}
            >
              {visual.description}
            </span>
          </div>

          {/* Epoch within phase */}
          <div className="flex items-center gap-1.5">
            <span
              className="text-[10px] font-bold uppercase tracking-wider sm:text-xs"
              style={{ color: `${visual.color}90` }}
            >
              Epoch {epochsElapsedInPhase}/{phaseTotalEpochs}
            </span>
          </div>
        </div>

        {/* Phase progress bar */}
        <div className="px-3 pb-2 sm:px-4">
          <div
            className="h-1 w-full overflow-hidden rounded-full"
            style={{ backgroundColor: `${visual.color}15` }}
          >
            <div
              className="h-full rounded-full transition-all duration-1000 ease-out"
              style={{
                width: `${progressPct}%`,
                backgroundColor: visual.color,
                boxShadow: `0 0 6px ${visual.color}`,
              }}
            />
          </div>
        </div>

        {/* Phase stepper (mini) */}
        <div className="flex items-center justify-center gap-0.5 pb-2">
          {PHASE_ORDER.map((phase, i) => {
            const isCurrentPhase = i === phaseIndex;
            const isPast = i < phaseIndex;
            const pv = PHASE_VISUALS[phase];

            return (
              <div key={phase} className="flex items-center gap-0.5">
                {i > 0 && (
                  <div
                    className="h-px w-3 sm:w-5"
                    style={{
                      backgroundColor:
                        isPast || isCurrentPhase ? pv.color : "#252540",
                    }}
                  />
                )}
                <div
                  className="rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider transition-all duration-300 sm:px-1.5 sm:text-[9px]"
                  style={{
                    backgroundColor: isCurrentPhase ? `${pv.color}20` : "transparent",
                    color: isCurrentPhase
                      ? pv.color
                      : isPast
                        ? `${pv.color}60`
                        : "#3a3a5c",
                    border: isCurrentPhase
                      ? `1px solid ${pv.color}50`
                      : "1px solid transparent",
                  }}
                >
                  {phase === "FINAL_STAND" ? "FINAL" : phase}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Storm warning banner */}
      {stormWarningVisible && nextPhase && (
        <div
          className="flex items-center justify-center gap-2 rounded-lg border px-3 py-2 animate-pulse"
          style={{
            backgroundColor: "rgba(245, 158, 11, 0.08)",
            borderColor: "rgba(245, 158, 11, 0.4)",
            boxShadow: "0 0 12px rgba(245, 158, 11, 0.15)",
          }}
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-amber-400 sm:text-xs">
            Storm closing in 1 epoch! {nextPhase.label} incoming
          </span>
        </div>
      )}
    </div>
  );
}
