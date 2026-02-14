"use client";

import { useState, useRef, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
}

interface BattleChatProps {
  battleId: string;
  /** Whether the user's wallet is connected (enables sending). */
  isConnected?: boolean;
  /** Short display name for the connected wallet, e.g. "0xdead...beef". */
  userDisplayName?: string;
}


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function formatChatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function BattleChat({
  isConnected = false,
  userDisplayName = "anon",
}: BattleChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages using bottom sentinel
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const sendMessage = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || trimmed.length > 140) return;

    const msg: ChatMessage = {
      id: `cm-${Date.now()}-${Math.random()}`,
      sender: userDisplayName,
      text: trimmed,
      timestamp: Date.now(),
    };

    setMessages((prev) => {
      const next = [...prev, msg];
      // Cap at 200 messages
      return next.length > 200 ? next.slice(-200) : next;
    });
    setInput("");
  }, [input, userDisplayName]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex max-h-[420px] flex-col">
      {/* Messages */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-gray-600">
            No messages yet. Be the first to speak!
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className="animate-feed-enter rounded px-2 py-1 text-xs hover:bg-colosseum-surface-light/30"
            >
              <div className="flex items-baseline gap-1.5">
                <span
                  className="shrink-0 text-[10px] text-gray-700"
                  suppressHydrationWarning
                >
                  {formatChatTime(msg.timestamp)}
                </span>
                <span className="shrink-0 font-bold text-accent-light">
                  {msg.sender}
                </span>
                <span className="break-all text-gray-400">{msg.text}</span>
              </div>
            </div>
          ))
        )}
        {/* Scroll sentinel — auto-scroll target */}
        <div ref={bottomRef} />
      </div>

      {/* Input — pinned at bottom */}
      <div className="mt-3 flex shrink-0 gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isConnected ? "Send a message..." : "Connect wallet to chat"}
          disabled={!isConnected}
          maxLength={140}
          className="flex-1 rounded border border-colosseum-surface-light bg-colosseum-bg px-3 py-2 text-xs text-gray-300 placeholder-gray-700 outline-none transition-colors focus:border-gold/40 disabled:cursor-not-allowed disabled:opacity-40"
        />
        <button
          onClick={sendMessage}
          disabled={!isConnected || !input.trim()}
          className="rounded border border-colosseum-surface-light bg-colosseum-surface px-3 py-2 text-xs font-bold uppercase tracking-wider text-gray-500 transition-all hover:border-gold/30 hover:text-gold disabled:cursor-not-allowed disabled:opacity-30"
        >
          Send
        </button>
      </div>
    </div>
  );
}
