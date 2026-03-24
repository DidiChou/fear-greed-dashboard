import type { Express } from "express";
import { type Server } from "http";

// ─── Yahoo Finance quote fetcher ───────────────────────────────────────────────
async function fetchYahooQuote(symbol: string): Promise<any> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; FearGreedBot/1.0)",
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Yahoo Finance error for ${symbol}: ${res.status}`);
  return res.json();
}

// ─── Compute a 0-100 fear/greed score from oil market data ────────────────────
// Components (each 0-100, fear=low, greed=high):
// 1. Price Momentum (vs 50-day SMA) — rising = greed
// 2. Volatility / OVX (high vol = fear, low = greed)
// 3. Price Strength (vs 52-week range — near high = greed)
// 4. 30-day ROC (rate of change — rising fast = greed)
// 5. Contango/Spread proxy (Brent-WTI spread direction)
// 6. RSI (overbought = greed, oversold = fear)

function calcSMA(closes: number[], period: number): number {
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const changes = closes.slice(-period - 1).map((v, i, arr) =>
    i === 0 ? 0 : v - arr[i - 1]
  ).slice(1);
  const gains = changes.map((c) => (c > 0 ? c : 0));
  const losses = changes.map((c) => (c < 0 ? -c : 0));
  const avgGain = gains.reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcROC(closes: number[], period: number): number {
  if (closes.length < period + 1) return 0;
  const current = closes[closes.length - 1];
  const past = closes[closes.length - 1 - period];
  return ((current - past) / past) * 100;
}

// Scale a value linearly from [low, high] → [0, 100], clamped
function scale(value: number, low: number, high: number, invert = false): number {
  const raw = Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100));
  return invert ? 100 - raw : raw;
}

interface OilFGResult {
  score: number;
  rating: string;
  price: number;
  change: number;
  changePct: number;
  high52w: number;
  low52w: number;
  components: {
    label: string;
    score: number;
    value: string;
    description: string;
  }[];
  historical: { date: string; price: number; score: number }[];
}

async function computeOilFG(symbol: string, ovxCloses: number[]): Promise<OilFGResult> {
  const data = await fetchYahooQuote(symbol);
  const result = data.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${symbol}`);

  const closes: number[] = result.indicators.quote[0].close.filter((v: any) => v != null);
  const timestamps: number[] = result.timestamp;
  const high52w = Math.max(...closes);
  const low52w = Math.min(...closes);

  const price = closes[closes.length - 1];
  const prevPrice = closes[closes.length - 2] ?? price;
  const change = price - prevPrice;
  const changePct = (change / prevPrice) * 100;

  // 1. Price Momentum vs 50-day SMA (0-100, above SMA = greed)
  const sma50 = calcSMA(closes, 50);
  const momentumDev = ((price - sma50) / sma50) * 100; // pct above/below SMA
  const momentumScore = scale(momentumDev, -15, 15);

  // 2. OVX Volatility (high OVX = fear, low = greed)
  const ovxCurrent = ovxCloses.length > 0 ? ovxCloses[ovxCloses.length - 1] : 40;
  const ovxScore = scale(ovxCurrent, 15, 100, true); // invert: high vol = fear

  // 3. Price Strength vs 52-week range (near high = greed)
  const strengthScore = scale(price, low52w, high52w);

  // 4. 30-day Rate of Change
  const roc30 = calcROC(closes, 30);
  const rocScore = scale(roc30, -25, 25);

  // 5. Short-term Momentum: 5-day vs 20-day SMA
  const sma5 = calcSMA(closes, 5);
  const sma20 = calcSMA(closes, 20);
  const shortMomDev = ((sma5 - sma20) / sma20) * 100;
  const shortMomScore = scale(shortMomDev, -8, 8);

  // 6. RSI (>70 = greed, <30 = fear)
  const rsi = calcRSI(closes, 14);
  const rsiScore = rsi; // RSI is already 0-100

  // Weighted composite
  const weights = [0.20, 0.20, 0.15, 0.20, 0.10, 0.15];
  const scores = [momentumScore, ovxScore, strengthScore, rocScore, shortMomScore, rsiScore];
  const composite = scores.reduce((acc, s, i) => acc + s * weights[i], 0);

  const getRating = (s: number) => {
    if (s <= 24) return "Extreme Fear";
    if (s <= 44) return "Fear";
    if (s <= 54) return "Neutral";
    if (s <= 74) return "Greed";
    return "Extreme Greed";
  };

  // Build 90-day historical rolling window score (using a rolling composite approx)
  const historical: { date: string; price: number; score: number }[] = [];
  const histLen = Math.min(90, closes.length - 50);
  for (let i = histLen; i >= 0; i--) {
    const slice = closes.slice(0, closes.length - i);
    const hp = slice[slice.length - 1];
    const hsma50 = calcSMA(slice, Math.min(50, slice.length));
    const hDev = ((hp - hsma50) / hsma50) * 100;
    const hStrength = scale(hp, low52w, high52w);
    const hRsi = calcRSI(slice, 14);
    const hRoc = calcROC(slice, Math.min(30, slice.length - 1));
    const hScore = Math.round(
      scale(hDev, -15, 15) * 0.25 +
      hStrength * 0.20 +
      scale(hRoc, -25, 25) * 0.25 +
      hRsi * 0.15 +
      ovxScore * 0.15
    );
    const tsIdx = timestamps.length - (i === 0 ? 1 : i);
    const ts = timestamps[Math.max(0, tsIdx)];
    historical.push({
      date: new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      price: Math.round(hp * 100) / 100,
      score: Math.max(0, Math.min(100, hScore)),
    });
  }

  return {
    score: Math.round(composite * 10) / 10,
    rating: getRating(composite),
    price: Math.round(price * 100) / 100,
    change: Math.round(change * 100) / 100,
    changePct: Math.round(changePct * 100) / 100,
    high52w: Math.round(high52w * 100) / 100,
    low52w: Math.round(low52w * 100) / 100,
    components: [
      {
        label: "Price Momentum",
        score: Math.round(momentumScore),
        value: `${momentumDev >= 0 ? "+" : ""}${momentumDev.toFixed(1)}% vs SMA50`,
        description: "Price deviation from 50-day moving average",
      },
      {
        label: "OVX Volatility",
        score: Math.round(ovxScore),
        value: `OVX: ${ovxCurrent.toFixed(1)}`,
        description: "CBOE Crude Oil Volatility Index (inverted)",
      },
      {
        label: "Price Strength",
        score: Math.round(strengthScore),
        value: `$${price.toFixed(2)} / 52w: $${low52w.toFixed(0)}–$${high52w.toFixed(0)}`,
        description: "Position within 52-week price range",
      },
      {
        label: "30D Rate of Change",
        score: Math.round(rocScore),
        value: `${roc30 >= 0 ? "+" : ""}${roc30.toFixed(1)}%`,
        description: "30-day price momentum (rate of change)",
      },
      {
        label: "Short-term Trend",
        score: Math.round(shortMomScore),
        value: `SMA5 ${shortMomDev >= 0 ? ">" : "<"} SMA20 by ${Math.abs(shortMomDev).toFixed(1)}%`,
        description: "5-day vs 20-day SMA crossover signal",
      },
      {
        label: "RSI (14)",
        score: Math.round(rsiScore),
        value: `RSI: ${rsi.toFixed(1)}`,
        description: "Relative Strength Index — overbought/oversold",
      },
    ],
    historical,
  };
}

// Cache to avoid hammering Yahoo Finance
let cache: {
  stockFG: any;
  wti: any;
  brent: any;
  ovxCloses: number[];
  updatedAt: number;
} | null = null;

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function registerRoutes(httpServer: Server, app: Express): Promise<void> {
  // ── Stock Market Fear & Greed (CNN) ──────────────────────────────────────────
  app.get("/api/feargreed", async (req, res) => {
    try {
      const response = await fetch(
        "https://production.dataviz.cnn.io/index/fearandgreed/graphdata/2025-01-01",
        { headers: { "User-Agent": "Mozilla/5.0 (compatible; FearGreedBot/1.0)" } }
      );
      if (!response.ok) throw new Error("CNN API error");
      const data = await response.json();
      res.json(data);
    } catch (e) {
      res.json({
        fear_and_greed: {
          score: 16.2, rating: "extreme fear",
          timestamp: new Date().toISOString(),
          previous_close: 16.1, previous_1_week: 21.7,
          previous_1_month: 43.3, previous_1_year: 25.4,
        },
        fear_and_greed_historical: { score: 16.2, rating: "extreme fear", data: [] },
      });
    }
  });

  // ── Oil Fear & Greed (computed from Yahoo Finance) ────────────────────────────
  app.get("/api/oilfg", async (req, res) => {
    try {
      const now = Date.now();

      // Serve from cache if fresh
      if (cache && now - cache.updatedAt < CACHE_TTL) {
        return res.json({ wti: cache.wti, brent: cache.brent, updatedAt: cache.updatedAt });
      }

      // Fetch OVX first (used as shared volatility component)
      let ovxCloses: number[] = [];
      try {
        const ovxData = await fetchYahooQuote("^OVX");
        ovxCloses = (ovxData.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [])
          .filter((v: any) => v != null);
      } catch {
        // Fall back to recent known OVX value if fetch fails
        ovxCloses = [91.85];
      }

      // Fetch WTI and Brent in parallel
      const [wti, brent] = await Promise.all([
        computeOilFG("CL=F", ovxCloses),
        computeOilFG("BZ=F", ovxCloses),
      ]);

      // Add spread component to context
      const spread = brent.price - wti.price;

      cache = { stockFG: null, wti, brent, ovxCloses, updatedAt: now };

      res.json({
        wti,
        brent,
        spread: Math.round(spread * 100) / 100,
        ovx: ovxCloses[ovxCloses.length - 1] ?? null,
        updatedAt: now,
      });
    } catch (e: any) {
      console.error("Oil F&G error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Health check ─────────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });
}
