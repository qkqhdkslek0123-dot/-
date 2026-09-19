import { randomUUID } from "node:crypto";
import { strategy } from "./config.js";
import { getOpenPositions, insertTrade, upsertPosition } from "./db.js";
import { logger } from "./logger.js";
import { subscribeMintForPosition, unsubscribeMintForPosition, bus, type PriceUpdate } from "./monitor.js";
import { notify } from "./notifier.js";
import { executeTrade } from "./trader.js";
import type { Candidate, Position } from "./types.js";
import { getPositionSizeSol } from "./riskManager.js";

const positions = new Map<string, Position>();

export function loadPositionsFromDb(): void {
  for (const p of getOpenPositions()) {
    positions.set(p.id, p);
    subscribeMintForPosition(p.mint);
  }
  logger.info({ count: positions.size }, "저장된 오픈 포지션 복원");
}

export async function openPosition(candidate: Candidate): Promise<void> {
  const amountSol = getPositionSizeSol();

  const result = await executeTrade({
    mint: candidate.mint,
    action: "buy",
    amount: amountSol,
    denominatedInSol: true,
    slippagePct: strategy.buy.slippage_pct,
    priorityFeeSol: strategy.buy.priority_fee_sol,
  });

  if (!result.success) {
    await notify("error", `매수 실패 (${candidate.symbol} / ${candidate.mint}): ${result.error}`);
    return;
  }

  const entryPriceSol =
    candidate.vTokensInBondingCurve && candidate.vTokensInBondingCurve > 0
      ? (candidate.vSolInBondingCurve ?? 0) / candidate.vTokensInBondingCurve
      : 0;

  if (entryPriceSol <= 0) {
    logger.warn({ mint: candidate.mint }, "진입가 계산 실패, 포지션 기록을 건너뜁니다 (매수는 이미 체결됨)");
    await notify("error", `매수는 체결됐지만 진입가 계산 실패 (${candidate.symbol}). 수동 확인 필요.`);
    return;
  }

  const tokenAmount = amountSol / entryPriceSol;

  const position: Position = {
    id: randomUUID(),
    mint: candidate.mint,
    symbol: candidate.symbol,
    entryPriceSol,
    entryAmountSol: amountSol,
    tokenAmount,
    remainingTokenAmount: tokenAmount,
    highWaterMarkPriceSol: entryPriceSol,
    openedAt: Date.now(),
    filledTpStages: [],
    status: "open",
  };

  positions.set(position.id, position);
  upsertPosition(position);
  subscribeMintForPosition(candidate.mint);

  insertTrade({
    id: randomUUID(),
    mint: candidate.mint,
    symbol: candidate.symbol,
    side: "buy",
    amountSol,
    priceSol: entryPriceSol,
    reason: "screening_pass",
    txSig: result.txSig,
    dryRun: result.dryRun,
    timestamp: Date.now(),
  });

  await notify(
    "buy",
    `매수: ${candidate.symbol} (${candidate.mint})\n금액: ${amountSol.toFixed(4)} SOL\n진행률: ${candidate.bondingCurveProgressPct.toFixed(1)}%\ntx: ${result.txSig}`
  );
}

export function watchPositionPrices(): void {
  bus.on("price", (update: PriceUpdate) => {
    for (const p of positions.values()) {
      if (p.mint === update.mint && p.status === "open") {
        void evaluateExit(p, update.priceSol);
      }
    }
  });
}

async function evaluateExit(position: Position, currentPriceSol: number): Promise<void> {
  if (currentPriceSol > position.highWaterMarkPriceSol) {
    position.highWaterMarkPriceSol = currentPriceSol;
  }

  const gainPct = ((currentPriceSol - position.entryPriceSol) / position.entryPriceSol) * 100;
  const drawdownFromHighPct =
    ((currentPriceSol - position.highWaterMarkPriceSol) / position.highWaterMarkPriceSol) * 100;
  const heldSeconds = (Date.now() - position.openedAt) / 1000;

  // 1. 손절
  if (gainPct <= strategy.sell.stop_loss_pct) {
    await closePosition(position, currentPriceSol, 100, "stop_loss");
    return;
  }

  // 2. 트레일링 스탑 (고점 대비 하락)
  if (
    position.highWaterMarkPriceSol > position.entryPriceSol &&
    drawdownFromHighPct <= strategy.sell.trailing_stop_pct
  ) {
    await closePosition(position, currentPriceSol, 100, "trailing_stop");
    return;
  }

  // 3. 시간 초과 강제 청산
  if (heldSeconds >= strategy.sell.max_hold_seconds) {
    await closePosition(position, currentPriceSol, 100, "timeout");
    return;
  }

  // 4. 단계별 분할 익절
  for (const stage of strategy.sell.take_profit_ladder) {
    if (gainPct >= stage.gain_pct && !position.filledTpStages.includes(stage.gain_pct)) {
      position.filledTpStages.push(stage.gain_pct);
      await closePosition(position, currentPriceSol, stage.sell_pct, `take_profit_${stage.gain_pct}`);
    }
  }
}

async function closePosition(
  position: Position,
  priceSol: number,
  sellPct: number,
  reason: string
): Promise<void> {
  const sellTokenAmount = position.remainingTokenAmount * (sellPct / 100);
  if (sellTokenAmount <= 0) return;

  const result = await executeTrade({
    mint: position.mint,
    action: "sell",
    amount: sellPct,
    denominatedInSol: false,
    slippagePct: strategy.sell.slippage_pct,
    priorityFeeSol: strategy.sell.priority_fee_sol,
  });

  if (!result.success) {
    await notify("error", `매도 실패 (${position.symbol}, 사유: ${reason}): ${result.error}`);
    return;
  }

  const proceedsSol = sellTokenAmount * priceSol;
  const costBasisSol = (position.entryAmountSol / position.tokenAmount) * sellTokenAmount;
  const pnlSol = proceedsSol - costBasisSol;

  position.remainingTokenAmount -= sellTokenAmount;
  if (position.remainingTokenAmount <= position.tokenAmount * 0.01) {
    position.status = "closed";
    unsubscribeMintForPosition(position.mint);
  }

  upsertPosition(position);
  insertTrade({
    id: randomUUID(),
    mint: position.mint,
    symbol: position.symbol,
    side: "sell",
    amountSol: proceedsSol,
    priceSol,
    reason,
    txSig: result.txSig,
    dryRun: result.dryRun,
    timestamp: Date.now(),
    pnlSol,
  });

  await notify(
    "sell",
    `매도: ${position.symbol} (${reason})\n비율: ${sellPct}%\n수익: ${pnlSol >= 0 ? "+" : ""}${pnlSol.toFixed(4)} SOL\ntx: ${result.txSig}`
  );
}

export function getOpenPositionCount(): number {
  return Array.from(positions.values()).filter((p) => p.status === "open").length;
}
