"use client";

import { useState, useCallback } from "react";
import type { AgentClass } from "@/types";
import { CLASS_CONFIG } from "@/components/battle/mock-data";
import AgentPortrait from "@/components/battle/AgentPortrait";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JoinFormProps {
  battleId: string;
  onJoined: (agentId: string) => void;
  disabled?: boolean; // true when lobby is full or user already joined
}

/** Short class descriptions shown under each class button */
const CLASS_DESCRIPTIONS: Record<AgentClass, string> = {
  WARRIOR: "Aggressive, high-risk stakes. Kills or dies trying.",
  TRADER: "TA-based prediction. Ignores combat.",
  SURVIVOR: "Tiny stakes, outlast everyone. Turtles to victory.",
  PARASITE: "Copies the best performer. Needs hosts alive.",
  GAMBLER: "Random everything. Wildcard chaos.",
};

const AGENT_CLASSES: AgentClass[] = [
  "WARRIOR",
  "TRADER",
  "SURVIVOR",
  "PARASITE",
  "GAMBLER",
];

const NAME_REGEX = /^[a-zA-Z0-9_]{1,12}$/;
const MAX_NAME_LENGTH = 12;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function JoinForm({
  battleId,
  onJoined,
  disabled = false,
}: JoinFormProps) {
  const [selectedClass, setSelectedClass] = useState<AgentClass | null>(null);
  const [agentName, setAgentName] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imagePreviewFailed, setImagePreviewFailed] = useState(false);
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);

  // ---- Derived state ----
  const nameIsValid = agentName.length > 0 && NAME_REGEX.test(agentName);
  const nameHasInvalidChars =
    agentName.length > 0 && !NAME_REGEX.test(agentName);
  const canSubmit =
    !disabled && !isPending && selectedClass !== null && nameIsValid;

  // ---- Handlers ----
  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value.slice(0, MAX_NAME_LENGTH);
      setAgentName(value);
      setError("");
    },
    [],
  );

  const handleImageUrlChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setImageUrl(e.target.value);
      setImagePreviewFailed(false);
    },
    [],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !selectedClass) return;

    setError("");
    setIsPending(true);

    const API_BASE =
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

    try {
      const body: Record<string, string> = {
        agentClass: selectedClass,
        agentName,
      };
      if (imageUrl.trim()) {
        body.imageUrl = imageUrl.trim();
      }

      const res = await fetch(`${API_BASE}/battle/${battleId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        const serverError =
          (payload as Record<string, string>).error ?? `HTTP ${res.status}`;

        // Map known 409 variants to user-friendly messages
        if (res.status === 409) {
          const lower = serverError.toLowerCase();
          if (lower.includes("full")) {
            throw new Error("Arena is full!");
          }
          if (lower.includes("name") || lower.includes("duplicate")) {
            throw new Error("Name already taken!");
          }
        }

        throw new Error(serverError);
      }

      const data = (await res.json()) as { agentId: string };
      onJoined(data.agentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsPending(false);
    }
  }

  // ---- Render ----
  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ---- Class Picker ---- */}
      <div>
        <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-400">
          Choose Your Class
        </label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
          {AGENT_CLASSES.map((cls) => {
            const cfg = CLASS_CONFIG[cls];
            const isSelected = selectedClass === cls;
            return (
              <button
                key={cls}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setSelectedClass(cls);
                  setError("");
                }}
                className={`group relative flex flex-col items-center gap-1.5 rounded-lg border-2 px-2 py-3 transition-all ${
                  isSelected
                    ? "scale-[1.03] border-gold bg-gold/10 shadow-[0_0_12px_rgba(245,158,11,0.25)]"
                    : "border-colosseum-surface-light bg-colosseum-surface hover:border-gray-500"
                } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                title={CLASS_DESCRIPTIONS[cls]}
              >
                <AgentPortrait
                  image={cfg.image}
                  emoji={cfg.emoji}
                  alt={cls}
                  size={isSelected ? "w-12 h-12" : "w-10 h-10"}
                  className="transition-all"
                />
                <span
                  className={`text-[11px] font-bold tracking-wider ${
                    isSelected ? "text-gold" : "text-gray-300"
                  }`}
                >
                  {cls}
                </span>
                <span className="hidden text-[9px] leading-tight text-gray-500 sm:block">
                  {CLASS_DESCRIPTIONS[cls].split(".")[0]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- Name Input ---- */}
      <div>
        <label
          htmlFor="agent-name"
          className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-400"
        >
          Gladiator Name
        </label>
        <div className="relative">
          <input
            id="agent-name"
            type="text"
            value={agentName}
            onChange={handleNameChange}
            disabled={disabled}
            maxLength={MAX_NAME_LENGTH}
            placeholder="BLOODFANG"
            autoComplete="off"
            className={`w-full rounded-lg border-2 bg-colosseum-surface px-3 py-2.5 font-mono text-sm uppercase text-gray-100 placeholder-gray-600 outline-none transition-colors ${
              nameHasInvalidChars
                ? "border-blood focus:border-blood"
                : "border-colosseum-surface-light focus:border-gold/60"
            } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-gray-500">
            {agentName.length}/{MAX_NAME_LENGTH}
          </span>
        </div>
        {nameHasInvalidChars && (
          <p className="mt-1 text-[11px] text-blood-light">
            Letters, numbers, and underscores only
          </p>
        )}
      </div>

      {/* ---- Optional Image URL ---- */}
      <div>
        <label
          htmlFor="agent-image"
          className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-400"
        >
          Portrait URL{" "}
          <span className="font-normal normal-case text-gray-600">
            (optional)
          </span>
        </label>
        <div className="flex items-center gap-3">
          <input
            id="agent-image"
            type="url"
            value={imageUrl}
            onChange={handleImageUrlChange}
            disabled={disabled}
            placeholder="https://your-portrait.png"
            className={`flex-1 rounded-lg border-2 border-colosseum-surface-light bg-colosseum-surface px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 outline-none transition-colors focus:border-gold/60 ${
              disabled ? "cursor-not-allowed opacity-50" : ""
            }`}
          />
          {/* Preview thumbnail */}
          {imageUrl.trim() && (
            <div className="flex-shrink-0">
              {imagePreviewFailed ? (
                // Fallback to class portrait or placeholder
                selectedClass ? (
                  <AgentPortrait
                    image={CLASS_CONFIG[selectedClass].image}
                    emoji={CLASS_CONFIG[selectedClass].emoji}
                    alt="Fallback"
                    size="w-12 h-12"
                    className="rounded border border-colosseum-surface-light"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded border border-blood/40 bg-blood/10 text-[10px] text-blood-light">
                    Error
                  </div>
                )
              ) : (
                <img
                  src={imageUrl.trim()}
                  alt="Preview"
                  className="h-12 w-12 rounded border border-colosseum-surface-light object-cover"
                  onError={() => setImagePreviewFailed(true)}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---- Error message ---- */}
      {error && (
        <div className="rounded-lg border border-blood/30 bg-blood/10 px-4 py-2.5 text-sm text-blood-light">
          {error}
        </div>
      )}

      {/* ---- Submit ---- */}
      <button
        type="submit"
        disabled={!canSubmit}
        className={`w-full rounded-lg px-6 py-3 text-sm font-bold uppercase tracking-widest transition-all ${
          canSubmit
            ? "bg-gradient-to-r from-gold-dark via-gold to-gold-light text-colosseum-bg shadow-lg shadow-gold/20 hover:shadow-gold/40 active:scale-[0.98]"
            : "cursor-not-allowed border border-colosseum-surface-light bg-colosseum-surface text-gray-600"
        }`}
      >
        {isPending ? (
          <span className="flex items-center justify-center gap-2">
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Entering Arena...
          </span>
        ) : (
          "Enter the Arena"
        )}
      </button>
    </form>
  );
}
