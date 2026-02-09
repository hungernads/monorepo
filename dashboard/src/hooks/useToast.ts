"use client";

import { useState, useCallback, useRef } from "react";

export type ToastType = "info" | "success" | "danger" | "gold";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  createdAt: number;
}

const TOAST_DURATION = 4000; // 4 seconds
const MAX_TOASTS = 5;

export interface UseToastResult {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
}

export function useToast(): UseToastResult {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType = "info") => {
      const id = `toast-${++counterRef.current}-${Date.now()}`;
      const toast: Toast = { id, message, type, createdAt: Date.now() };

      setToasts((prev) => {
        const next = [...prev, toast];
        // Cap at MAX_TOASTS
        return next.length > MAX_TOASTS ? next.slice(-MAX_TOASTS) : next;
      });

      // Auto-dismiss
      setTimeout(() => {
        removeToast(id);
      }, TOAST_DURATION);
    },
    [removeToast],
  );

  return { toasts, addToast, removeToast };
}

export default useToast;
