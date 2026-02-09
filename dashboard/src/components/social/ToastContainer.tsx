"use client";

import type { Toast, ToastType } from "@/hooks/useToast";

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

const TYPE_STYLES: Record<
  ToastType,
  { border: string; bg: string; text: string; icon: string }
> = {
  info: {
    border: "border-gray-600",
    bg: "bg-colosseum-surface",
    text: "text-gray-300",
    icon: "INFO",
  },
  success: {
    border: "border-green-600",
    bg: "bg-green-900/30",
    text: "text-green-300",
    icon: "WIN",
  },
  danger: {
    border: "border-blood",
    bg: "bg-blood/10",
    text: "text-blood-light",
    icon: "REKT",
  },
  gold: {
    border: "border-gold",
    bg: "bg-gold/10",
    text: "text-gold",
    icon: "HYPE",
  },
};

/**
 * Fixed-position toast notification container.
 * Renders in the top-right corner of the viewport.
 */
export default function ToastContainer({
  toasts,
  onDismiss,
}: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed right-4 top-20 z-50 flex w-80 flex-col gap-2">
      {toasts.map((toast) => {
        const style = TYPE_STYLES[toast.type];
        return (
          <div
            key={toast.id}
            className={`animate-feed-enter rounded-lg border ${style.border} ${style.bg} px-4 py-3 shadow-lg backdrop-blur-sm`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={`text-[9px] font-bold uppercase tracking-widest ${style.text}`}
                >
                  {style.icon}
                </span>
                <p className={`text-xs leading-relaxed ${style.text}`}>
                  {toast.message}
                </p>
              </div>
              <button
                onClick={() => onDismiss(toast.id)}
                className="shrink-0 text-gray-600 transition-colors hover:text-gray-400"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-3.5 w-3.5"
                >
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
