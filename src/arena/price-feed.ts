/**
 * HUNGERNADS - Price Feed Integration (Pyth Network)
 *
 * Fetches real-time prices from Pyth Hermes API.
 * Supports ETH/USD, BTC/USD, SOL/USD, MON/USD.
 * Caches prices per epoch and computes epoch-over-epoch % changes.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Asset = 'ETH' | 'BTC' | 'SOL' | 'MON';

export const ASSETS: Asset[] = ['ETH', 'BTC', 'SOL', 'MON'];

export interface MarketData {
  prices: Record<Asset, number>;
  changes: Record<Asset, number>; // % change since last epoch
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Pyth feed IDs (mainnet, hex without leading 0x for URL param)
// ---------------------------------------------------------------------------

const PYTH_FEED_IDS: Record<Asset, string> = {
  ETH: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  BTC: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  SOL: '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  // MON/USD has no Pyth feed yet; handled via mock below.
  MON: '',
};

const HERMES_BASE_URL = 'https://hermes.pyth.network/v2/updates/price/latest';

// ---------------------------------------------------------------------------
// Pyth API response shape (subset we care about)
// ---------------------------------------------------------------------------

interface PythPriceComponent {
  price: string;
  conf: string;
  expo: number;
  publish_time: number;
}

interface PythParsedEntry {
  id: string;
  price: PythPriceComponent;
  ema_price: PythPriceComponent;
}

interface PythResponse {
  parsed: PythParsedEntry[];
}

// ---------------------------------------------------------------------------
// Mock MON/USD price generator
// ---------------------------------------------------------------------------

/** Simulated MON price: random walk around a base of $0.85 */
function mockMonPrice(lastPrice: number | null): number {
  const base = lastPrice ?? 0.85;
  // +/- 2% random walk
  const change = (Math.random() - 0.5) * 0.04;
  return Math.max(0.01, base * (1 + change));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert Pyth price + exponent to a human-readable number. */
function parsePythPrice(component: PythPriceComponent): number {
  return Number(component.price) * Math.pow(10, component.expo);
}

/** Build the Hermes URL to batch-fetch all feeds in a single request. */
function buildHermesUrl(): string {
  const params = new URLSearchParams();
  for (const asset of ASSETS) {
    const feedId = PYTH_FEED_IDS[asset];
    if (feedId) {
      params.append('ids[]', feedId);
    }
  }
  return `${HERMES_BASE_URL}?${params.toString()}`;
}

/** Map from Pyth feed id (no 0x prefix) -> Asset */
function buildFeedIdToAssetMap(): Map<string, Asset> {
  const map = new Map<string, Asset>();
  for (const asset of ASSETS) {
    const id = PYTH_FEED_IDS[asset];
    if (id) {
      // Pyth response ids come without the 0x prefix
      map.set(id.replace(/^0x/, ''), asset);
    }
  }
  return map;
}

const FEED_ID_TO_ASSET = buildFeedIdToAssetMap();

// ---------------------------------------------------------------------------
// PriceFeed class
// ---------------------------------------------------------------------------

export class PriceFeed {
  private lastPrices: Record<Asset, number> | null = null;
  private lastTimestamp: number = 0;

  /**
   * Fetch latest prices from Pyth Hermes, compute % changes vs. last call.
   * On failure, falls back to last known prices (changes = 0).
   */
  async fetchPrices(): Promise<MarketData> {
    const now = Date.now();
    let freshPrices: Record<Asset, number>;

    try {
      freshPrices = await this.fetchFromPyth();
    } catch (err) {
      console.error('[PriceFeed] Pyth fetch failed, using fallback:', err);
      return this.fallback(now);
    }

    // Fill MON with mock
    freshPrices.MON = mockMonPrice(this.lastPrices?.MON ?? null);

    const changes = this.computeChanges(freshPrices);

    this.lastPrices = freshPrices;
    this.lastTimestamp = now;

    return {
      prices: { ...freshPrices },
      changes,
      timestamp: now,
    };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async fetchFromPyth(): Promise<Record<Asset, number>> {
    const url = buildHermesUrl();
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`Pyth API returned ${res.status}: ${res.statusText}`);
    }

    const data: PythResponse = await res.json();

    if (!data.parsed || data.parsed.length === 0) {
      throw new Error('Pyth API returned empty parsed array');
    }

    // Start with zeros; fill from response
    const prices: Record<Asset, number> = { ETH: 0, BTC: 0, SOL: 0, MON: 0 };

    for (const entry of data.parsed) {
      const asset = FEED_ID_TO_ASSET.get(entry.id);
      if (asset) {
        const parsed = parsePythPrice(entry.price);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          console.warn(`[PriceFeed] Invalid price for ${asset}: ${parsed}`);
          continue;
        }
        prices[asset] = parsed;
      }
    }

    // Validate we got all real feeds
    for (const asset of ASSETS) {
      if (asset === 'MON') continue; // handled separately
      if (prices[asset] === 0) {
        throw new Error(`Missing Pyth price for ${asset}`);
      }
    }

    return prices;
  }

  /**
   * Compute epoch-over-epoch percentage changes.
   * Returns 0 for each asset if no previous data exists.
   */
  private computeChanges(current: Record<Asset, number>): Record<Asset, number> {
    const changes: Record<Asset, number> = { ETH: 0, BTC: 0, SOL: 0, MON: 0 };

    if (!this.lastPrices) {
      return changes;
    }

    for (const asset of ASSETS) {
      const prev = this.lastPrices[asset];
      const curr = current[asset];
      if (prev > 0 && curr > 0) {
        changes[asset] = ((curr - prev) / prev) * 100;
      }
    }

    return changes;
  }

  /**
   * Fallback when Pyth fetch fails:
   * - If we have previous prices, return them with 0% changes.
   * - If no previous data at all, return hardcoded sane defaults.
   */
  private fallback(now: number): MarketData {
    if (this.lastPrices) {
      console.warn('[PriceFeed] Using last known prices as fallback');
      return {
        prices: { ...this.lastPrices },
        changes: { ETH: 0, BTC: 0, SOL: 0, MON: 0 },
        timestamp: now,
      };
    }

    // Absolute last resort: hardcoded defaults so the game can still start.
    console.warn('[PriceFeed] No previous prices, using hardcoded defaults');
    return {
      prices: { ETH: 2000, BTC: 50000, SOL: 100, MON: 0.85 },
      changes: { ETH: 0, BTC: 0, SOL: 0, MON: 0 },
      timestamp: now,
    };
  }

  // -----------------------------------------------------------------------
  // Utilities
  // -----------------------------------------------------------------------

  /** Get last fetched prices (or null if never fetched). */
  getLastPrices(): Record<Asset, number> | null {
    return this.lastPrices ? { ...this.lastPrices } : null;
  }

  /** Get the simple flat format expected by the existing agent MarketData type. */
  toSimpleMarketData(): { eth: number; btc: number; sol: number; mon: number } | null {
    if (!this.lastPrices) return null;
    return {
      eth: this.lastPrices.ETH,
      btc: this.lastPrices.BTC,
      sol: this.lastPrices.SOL,
      mon: this.lastPrices.MON,
    };
  }
}
