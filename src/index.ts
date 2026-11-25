import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

// ==========================================
// TYPE DATA
// ==========================================

type Bar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

// ==========================================
// DAFTAR SYMBOL
// ==========================================

const SYMBOLS: Record<string, string> = {
  XAUUSD: "GC=F",
  GOLD: "GC=F",
  XAGUSD: "SI=F",
  SILVER: "SI=F",

  EURUSD: "EURUSD=X",
  GBPUSD: "GBPUSD=X",
  USDJPY: "JPY=X",
  AUDUSD: "AUDUSD=X",
  USDCAD: "CAD=X",
  USDCHF: "CHF=X",
  NZDUSD: "NZDUSD=X",

  BTCUSD: "BTC-USD",
  BTCUSDT: "BTC-USD",
  ETHUSD: "ETH-USD",
  ETHUSDT: "ETH-USD",

  USOIL: "CL=F",
  WTI: "CL=F",

  NAS100: "NQ=F",
  US100: "NQ=F",

  US500: "ES=F",
  SPX500: "ES=F",

  US30: "YM=F",
  DOW: "YM=F"
};

// ==========================================
// TIMEFRAME
// ==========================================

const INTERVALS: Record<
  string,
  { interval: string; range: string }
> = {
  M1: { interval: "1m", range: "1d" },
  M5: { interval: "5m", range: "5d" },
  M15: { interval: "15m", range: "5d" },
  M30: { interval: "30m", range: "1mo" },
  H1: { interval: "1h", range: "1mo" },
  H4: { interval: "1h", range: "3mo" },
  D1: { interval: "1d", range: "1y" }
};

// ==========================================
// RESOLVE SYMBOL
// ==========================================

function resolveSymbol(input: string): string {
  const key = input.toUpperCase().replace(/[^A-Z0-9]/g, "");

  const symbol = SYMBOLS[key];

  if (!symbol) {
    throw new Error(
      `Simbol ${input} belum didukung. Contoh: XAUUSD, EURUSD, BTCUSD, USOIL, NAS100.`
    );
  }

  return symbol;
}

// ==========================================
// PEMBENTUKAN CANDLE H4
// ==========================================

function convertToH4(bars: Bar[]): Bar[] {
  const groups = new Map<number, Bar[]>();

  for (const bar of bars) {
    const timestamp = new Date(bar.time).getTime();

    // Kelompokkan berdasarkan interval 4 jam UTC
    const bucket = Math.floor(
      timestamp / (4 * 60 * 60 * 1000)
    );

    if (!groups.has(bucket)) {
      groups.set(bucket, []);
    }

    groups.get(bucket)!.push(bar);
  }

  const result: Bar[] = [];

  for (const [bucket, items] of groups) {
    if (items.length === 0) continue;

    const sorted = items.sort(
      (a, b) =>
        new Date(a.time).getTime() -
        new Date(b.time).getTime()
    );

    result.push({
      time: new Date(
        bucket * 4 * 60 * 60 * 1000
      ).toISOString(),

      open: sorted[0].open,

      high: Math.max(
        ...sorted.map(b => b.high)
      ),

      low: Math.min(
        ...sorted.map(b => b.low)
      ),

      close: sorted[sorted.length - 1].close,

      volume: sorted.reduce(
        (sum, b) => sum + b.volume,
        0
      )
    });
  }

  return result;
}

// ==========================================
// AMBIL DATA CANDLE
// ==========================================

async function candles(
  symbolInput: string,
  timeframe = "H1",
  limit = 100
): Promise<Bar[]> {

  const symbol = resolveSymbol(symbolInput);

  const tf = timeframe.toUpperCase();

  const cfg = INTERVALS[tf];

  if (!cfg) {
    throw new Error(
      "Timeframe harus M1, M5, M15, M30, H1, H4, atau D1."
    );
  }

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(symbol)}` +
    `?range=${cfg.range}&interval=${cfg.interval}&events=history`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(
      `Penyedia data pasar mengembalikan HTTP ${response.status}. Coba lagi nanti.`
    );
  }

  const json: any = await response.json();

  const result = json?.chart?.result?.[0];

  if (!result) {
    throw new Error(
      json?.chart?.error?.description ||
      "Data candle tidak tersedia untuk simbol/timeframe ini."
    );
  }

  const q = result.indicators?.quote?.[0];

  const ts: number[] = result.timestamp || [];

  const rows: Bar[] = [];

  for (let i = 0; i < ts.length; i++) {

    const o = q?.open?.[i];
    const h = q?.high?.[i];
    const l = q?.low?.[i];
    const c = q?.close
