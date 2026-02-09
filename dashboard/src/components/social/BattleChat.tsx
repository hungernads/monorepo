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
// Mock messages for demo
// ---------------------------------------------------------------------------

const now = new Date("2026-02-08T12:00:00Z").getTime();

const MOCK_MESSAGES: ChatMessage[] = [
  {
    id: "cm-1",
    sender: "0xdead...beef",
    text: "BLOODFANG is unstoppable rn",
    timestamp: now - 120_000,
  },
  {
    id: "cm-2",
    sender: "0xfade...1337",
    text: "MADLAD all in on MON DOWN lmaooo",
    timestamp: now - 95_000,
  },
  {
    id: "cm-3",
    sender: "0xcafe...babe",
    text: "IRONSHELL just vibing with shields up",
    timestamp: now - 72_000,
  },
  {
    id: "cm-4",
    sender: "0xaaaa...2222",
    text: "rip COPYCAT. never had a chance",
    timestamp: now - 45_000,
  },
  {
    id: "cm-5",
    sender: "0xdead...beef",
    text: "May the nads be ever in your favor",
    timestamp: now - 20_000,
  },
];

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
  const [messages, setMessages] = useState<ChatMessage[]>(MOCK_MESSAGES);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
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
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">
          Chat
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-gray-600">
          {messages.length} msgs
        </span>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin"
        style={{ maxHeight: "300px" }}
      >
        {messages.map((msg) => (
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
        ))}
      </div>

      {/* Input */}
      <div className="mt-3 flex gap-2">
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
