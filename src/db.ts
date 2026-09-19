import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import type { Position, TradeRecord } from "./types.js";

mkdirSync("./data", { recursive: true });

const db = new Database("./data/bot.sqlite");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL,
  symbol TEXT,
  side TEXT NOT NULL,
  amountSol REAL NOT NULL,
  priceSol REAL NOT NULL,
  reason TEXT,
  txSig TEXT,
  dryRun INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  pnlSol REAL
);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL,
  symbol TEXT,
  entryPriceSol REAL NOT NULL,
  entryAmountSol REAL NOT NULL,
  tokenAmount REAL NOT NULL,
  remainingTokenAmount REAL NOT NULL,
  highWaterMarkPriceSol REAL NOT NULL,
  openedAt INTEGER NOT NULL,
  filledTpStages TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL
);
`);

export function insertTrade(t: TradeRecord): void {
  db.prepare(
    `INSERT INTO trades (id, mint, symbol, side, amountSol, priceSol, reason, txSig, dryRun, timestamp, pnlSol)
     VALUES (@id, @mint, @symbol, @side, @amountSol, @priceSol, @reason, @txSig, @dryRun, @timestamp, @pnlSol)`
  ).run({ ...t, dryRun: t.dryRun ? 1 : 0, pnlSol: t.pnlSol ?? null });
}

export function upsertPosition(p: Position): void {
  db.prepare(
    `INSERT INTO positions (id, mint, symbol, entryPriceSol, entryAmountSol, tokenAmount, remainingTokenAmount, highWaterMarkPriceSol, openedAt, filledTpStages, status)
     VALUES (@id, @mint, @symbol, @entryPriceSol, @entryAmountSol, @tokenAmount, @remainingTokenAmount, @highWaterMarkPriceSol, @openedAt, @filledTpStages, @status)
     ON CONFLICT(id) DO UPDATE SET
       remainingTokenAmount=excluded.remainingTokenAmount,
       highWaterMarkPriceSol=excluded.highWaterMarkPriceSol,
       filledTpStages=excluded.filledTpStages,
       status=excluded.status`
  ).run({ ...p, filledTpStages: JSON.stringify(p.filledTpStages) });
}

export function getOpenPositions(): Position[] {
  const rows = db.prepare(`SELECT * FROM positions WHERE status = 'open'`).all() as any[];
  return rows.map((r) => ({ ...r, filledTpStages: JSON.parse(r.filledTpStages) }));
}

export function getTodayPnlSol(): number {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const row = db
    .prepare(`SELECT COALESCE(SUM(pnlSol), 0) as total FROM trades WHERE timestamp >= ? AND side = 'sell'`)
    .get(startOfDay.getTime()) as { total: number };
  return row.total;
}

export default db;
