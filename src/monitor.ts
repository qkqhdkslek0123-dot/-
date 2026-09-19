import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { strategy } from "./config.js";
import { logger } from "./logger.js";
import type { Candidate, NewTokenEvent } from "./types.js";

interface TrackedToken {
  event: NewTokenEvent;
  buyers: Set<string>;
  holderVolume: Map<string, number>;
  totalBuyVolume: number;
  lastMarketCapSol: number;
  lastVSol: number;
  lastVTokens: number;
}

export interface PriceUpdate {
  mint: string;
  priceSol: number;
  marketCapSol: number;
}

export const bus = new EventEmitter();

const tracked = new Map<string, TrackedToken>();
// 포지션을 보유 중이라 가격 구독을 계속 유지해야 하는 mint 목록 (후보 관찰 만료와 무관)
const positionSubs = new Set<string>();

let socket: WebSocket | null = null;

export function startMonitor(): WebSocket {
  const ws = new WebSocket(strategy.monitor.websocket_url);
  socket = ws;

  ws.on("open", () => {
    logger.info("PumpPortal WebSocket 연결됨 - 신규 토큰 구독 시작");
    ws.send(JSON.stringify({ method: "subscribeNewToken" }));
    // 재연결 시 보유 포지션 가격 구독 복원
    if (positionSubs.size > 0) {
      ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: Array.from(positionSubs) }));
    }
  });

  ws.on("message", (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    handleMessage(msg, ws);
  });

  ws.on("error", (err) => logger.error({ err }, "WebSocket 오류"));
  ws.on("close", () => {
    logger.warn("WebSocket 연결 종료, 5초 후 재연결 시도");
    setTimeout(() => startMonitor(), 5000);
  });

  setInterval(() => cleanupStaleTracked(ws), 10_000);

  return ws;
}

export function subscribeMintForPosition(mint: string): void {
  positionSubs.add(mint);
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] }));
  }
}

export function unsubscribeMintForPosition(mint: string): void {
  positionSubs.delete(mint);
  if (!tracked.has(mint) && socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: [mint] }));
  }
}

function handleMessage(msg: any, ws: WebSocket): void {
  if (msg.txType === "create" || (msg.mint && msg.name && !tracked.has(msg.mint))) {
    const event: NewTokenEvent = {
      mint: msg.mint,
      name: msg.name ?? "",
      symbol: msg.symbol ?? "",
      creator: msg.traderPublicKey ?? msg.creator ?? "",
      createdAt: Date.now(),
      initialBuySol: msg.solAmount ?? 0,
      marketCapSol: msg.marketCapSol ?? 0,
      bondingCurveKey: msg.bondingCurveKey,
      vSolInBondingCurve: msg.vSolInBondingCurve,
      vTokensInBondingCurve: msg.vTokensInBondingCurve,
    };

    tracked.set(event.mint, {
      event,
      buyers: new Set(event.creator ? [event.creator] : []),
      holderVolume: new Map(event.creator ? [[event.creator, event.initialBuySol ?? 0]] : []),
      totalBuyVolume: event.initialBuySol ?? 0,
      lastMarketCapSol: event.marketCapSol ?? 0,
      lastVSol: event.vSolInBondingCurve ?? 0,
      lastVTokens: event.vTokensInBondingCurve ?? 0,
    });

    ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [event.mint] }));
    logger.debug({ mint: event.mint, symbol: event.symbol }, "신규 토큰 감지, 관찰 시작");
    return;
  }

  if (msg.mint && (msg.txType === "buy" || msg.txType === "sell")) {
    const mint = msg.mint as string;
    const t = tracked.get(mint);

    if (t) {
      const trader: string = msg.traderPublicKey ?? "unknown";
      const solAmount: number = msg.solAmount ?? 0;

      if (msg.txType === "buy") {
        t.buyers.add(trader);
        t.totalBuyVolume += solAmount;
        t.holderVolume.set(trader, (t.holderVolume.get(trader) ?? 0) + solAmount);
      } else {
        t.holderVolume.set(trader, (t.holderVolume.get(trader) ?? 0) - solAmount);
      }

      t.lastMarketCapSol = msg.marketCapSol ?? t.lastMarketCapSol;
      t.lastVSol = msg.vSolInBondingCurve ?? t.lastVSol;
      t.lastVTokens = msg.vTokensInBondingCurve ?? t.lastVTokens;

      evaluateCandidate(mint);
    }

    if (t || positionSubs.has(mint)) {
      const vSol = msg.vSolInBondingCurve ?? t?.lastVSol;
      const vTokens = msg.vTokensInBondingCurve ?? t?.lastVTokens;
      if (vSol && vTokens) {
        const priceSol = vSol / vTokens;
        const update: PriceUpdate = { mint, priceSol, marketCapSol: msg.marketCapSol ?? 0 };
        bus.emit("price", update);
      }
    }
  }
}

function evaluateCandidate(mint: string): void {
  const t = tracked.get(mint);
  if (!t) return;

  const ageSeconds = (Date.now() - t.event.createdAt) / 1000;
  if (ageSeconds > strategy.screening.max_token_age_seconds) return;

  const graduationCap = strategy.screening.graduation_market_cap_sol;
  const progressPct = graduationCap > 0 ? (t.lastMarketCapSol / graduationCap) * 100 : 0;

  const topHolderVolume = Math.max(0, ...Array.from(t.holderVolume.values()));
  const topHolderPct = t.totalBuyVolume > 0 ? (topHolderVolume / t.totalBuyVolume) * 100 : 0;

  const devVolume = Math.max(0, t.holderVolume.get(t.event.creator) ?? 0);
  const devHoldingPct = t.totalBuyVolume > 0 ? (devVolume / t.totalBuyVolume) * 100 : 0;

  const candidate: Candidate = {
    ...t.event,
    marketCapSol: t.lastMarketCapSol,
    vSolInBondingCurve: t.lastVSol,
    vTokensInBondingCurve: t.lastVTokens,
    bondingCurveProgressPct: progressPct,
    uniqueBuyers: t.buyers.size,
    topHolderPct,
    devHoldingPct,
  };

  bus.emit("candidate", candidate);
}

function cleanupStaleTracked(ws: WebSocket): void {
  const maxAgeMs = (strategy.screening.max_token_age_seconds + 60) * 1000;
  for (const [mint, t] of tracked.entries()) {
    if (Date.now() - t.event.createdAt > maxAgeMs) {
      tracked.delete(mint);
      if (!positionSubs.has(mint) && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: [mint] }));
      }
    }
  }
}
