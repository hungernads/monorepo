"use client";

import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "hnads-favorite-agents";

function readFromStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeToStorage(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

export interface UseFavoriteAgentsResult {
  /** Set of favorited agent IDs. */
  favorites: Set<string>;
  /** Toggle favorite status for an agent. Returns the new state (true = favorited). */
  toggle: (agentId: string) => boolean;
  /** Check if a specific agent is favorited. */
  isFavorite: (agentId: string) => boolean;
}

export function useFavoriteAgents(): UseFavoriteAgentsResult {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  // Hydrate from localStorage on mount
  useEffect(() => {
    setFavorites(new Set(readFromStorage()));
  }, []);

  const toggle = useCallback((agentId: string): boolean => {
    let added = false;
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
        added = false;
      } else {
        next.add(agentId);
        added = true;
      }
      writeToStorage(Array.from(next));
      return next;
    });
    return added;
  }, []);

  const isFavorite = useCallback(
    (agentId: string): boolean => favorites.has(agentId),
    [favorites],
  );

  return { favorites, toggle, isFavorite };
}

export default useFavoriteAgents;
