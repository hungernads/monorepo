"use client";

import { useState, useMemo } from "react";
import { useMarketPrices } from "@/hooks/useMarketPrices";
import type { MarketPrice } from "./mock-data";

// ─── Types ───────────────────────────────────────────────────────

type TimeFrame = "1h" | "24h" | "7d";

// ─── Constants ───────────────────────────────────────────────────

const ASSET_ICONS: Record<string, string> = {
  ETH: "\u039E",
  BTC: "\u20BF",
  SOL: "S",
  MON: "M",
};

const TIMEFRAME_LABELS: Record<TimeFrame, string> = {
  "1h": "1H",
  "24h": "24H",
  "7d": "7D",
};

// ─── Helpers ─────────────────────────────────────────────────────

function formatPrice(price: number): string {
  if (price >= 10_000)
    return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (price >= 100)
    return price.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return price.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function getChange(p: MarketPrice, tf: TimeFrame): number {
  switch (tf) {
    case "1h":
      return p.change1h;
    case "24h":
      return p.change24h;
    case "7d":
      return p.change7d;
  }
}

// ─── Sparkline Component ─────────────────────────────────────────

interface SparklineProps {
  data: number[];
  positive: boolean;
  width?: number;
  height?: number;
}

function Sparkline({ data, positive, width = 60, height = 24 }: SparklineProps) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  // Build SVG polyline points
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 2) - 1; // 1px padding
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  // Gradient fill area under the line
  const lastX = width;
  const areaPoints = `0,${height} ${points} ${lastX},${height}`;

  const color = positive ? "#22c55e" : "#dc2626";
  const gradientId = `sparkline-grad-${positive ? "up" : "down"}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="flex-shrink-0"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#${gradientId})`} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Loading Skeleton ────────────────────────────────────────────

function TickerSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="h-4 w-16 animate-pulse rounded bg-colosseum-surface" />
        <div className="h-4 w-24 animate-pulse rounded bg-colosseum-surface" />
      </div>
      <div className="grid grid-cols-1 gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-md border border-colosseum-surface-light bg-colosseum-bg px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 animate-pulse rounded bg-colosseum-surface" />
              <div className="space-y-1">
                <div className="h-3 w-8 animate-pulse rounded bg-colosseum-surface" />
                <div className="h-3 w-14 animate-pulse rounded bg-colosseum-surface" />
              </div>
            </div>
            <div className="h-4 w-12 animate-pulse rounded bg-colosseum-surface" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────

export default function MarketTicker() {
  const { prices, loading, error, updatedAt, flashDirection } =
    useMarketPrices();
  const [timeFrame, setTimeFrame] = useState<TimeFrame>("24h");

  // Format the "last updated" timestamp
  const lastUpdatedLabel = useMemo(() => {
    if (!updatedAt) return null;
    const d = new Date(updatedAt);
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }, [updatedAt]);

  if (loading && prices.length === 0) {
    return <TickerSkeleton />;
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Header row: title + timeframe toggles */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">
            Markets
          </h2>
          {!error && prices.length > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-green-900/30 px-1.5 py-0.5 text-[9px] font-bold uppercase text-green-400">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
              Live
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {(Object.keys(TIMEFRAME_LABELS) as TimeFrame[]).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeFrame(tf)}
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                timeFrame === tf
                  ? "bg-gold/20 text-gold"
                  : "text-gray-600 hover:text-gray-400"
              }`}
            >
              {TIMEFRAME_LABELS[tf]}
            </button>
          ))}
        </div>
      </div>

      {/* Error banner (non-blocking — shows stale data below) */}
      {error && prices.length > 0 && (
        <div className="rounded border border-gray-700/30 bg-gray-800/30 px-2 py-1 text-[10px] text-gray-500">
          Showing cached prices. Reconnecting...
        </div>
      )}

      {/* Error state (no data at all) */}
      {error && prices.length === 0 && (
        <div className="rounded-md border border-blood-dark/30 bg-blood-dark/10 px-3 py-4 text-center text-xs text-blood-light">
          Failed to load market data
          <div className="mt-1 text-[10px] text-gray-600">{error}</div>
        </div>
      )}

      {/* Price cards */}
      <div className="grid grid-cols-1 gap-2">
        {prices.map((p) => {
          const change = getChange(p, timeFrame);
          const isPositive = change >= 0;
          const flash = flashDirection[p.asset];

          return (
            <div
              key={p.asset}
              className={`flex items-center justify-between rounded-md border border-colosseum-surface-light bg-colosseum-bg px-3 py-2 transition-colors ${
                flash === "up"
                  ? "animate-price-flash-up"
                  : flash === "down"
                    ? "animate-price-flash-down"
                    : ""
              }`}
            >
              {/* Left: icon + name + price */}
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded bg-colosseum-surface text-[10px] font-bold text-gray-400">
                  {ASSET_ICONS[p.asset] ?? p.asset[0]}
                </span>
                <div>
                  <div className="text-xs font-bold text-white">{p.asset}</div>
                  <div className="text-[10px] text-gray-500">
                    ${formatPrice(p.price)}
                  </div>
                </div>
              </div>

              {/* Center: sparkline */}
              <Sparkline data={p.sparkline} positive={isPositive} />

              {/* Right: change percentage */}
              <span
                className={`min-w-[52px] text-right text-xs font-medium ${
                  isPositive ? "text-green-400" : "text-blood"
                }`}
              >
                {isPositive ? "+" : ""}
                {change.toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>

      {/* Footer: last updated timestamp */}
      {lastUpdatedLabel && (
        <div className="text-right text-[9px] text-gray-700">
          Updated {lastUpdatedLabel}
        </div>
      )}
    </div>
  );
}
