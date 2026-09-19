import { assertLiveTradeReady, env, strategy } from "./config.js";
import { logger } from "./logger.js";
import { passesScreening } from "./filters.js";
import { bus, startMonitor } from "./monitor.js";
import { notify } from "./notifier.js";
import { getOpenPositionCount, loadPositionsFromDb, openPosition, watchPositionPrices } from "./positionManager.js";
import { canOpenNewPosition, checkDailyLossLimit, getPositionSizeSol, isKillSwitchActive } from "./riskManager.js";
import { getTodayPnlSol } from "./db.js";
import { assertSufficientBalance, getSolBalance } from "./wallet.js";
import type { Candidate } from "./types.js";

async function main(): Promise<void> {
  assertLiveTradeReady();

  logger.info(
    { dryRun: env.dryRun, totalCapitalSol: strategy.capital.total_sol },
    env.dryRun
      ? "=== DRY_RUN 모드로 시작 (실제 트랜잭션 없음) ==="
      : "=== 실거래 모드로 시작 - 실제 자금이 사용됩니다 ==="
  );

  if (!env.dryRun) {
    await assertSufficientBalance(getPositionSizeSol());
    const balance = await getSolBalance();
    logger.warn({ balance }, "실거래 모드 확인: 현재 지갑 잔고");
  }

  loadPositionsFromDb();
  watchPositionPrices();
  startMonitor();

  bus.on("candidate", (candidate: Candidate) => {
    void handleCandidate(candidate);
  });

  setInterval(checkDailyLossLimit, 15_000);
  setInterval(logDailySummaryIfMidnight, 60_000);

  logger.info("모니터링 중... (Ctrl+C로 종료)");
}

async function handleCandidate(candidate: Candidate): Promise<void> {
  const screening = passesScreening(candidate);
  if (!screening.pass) {
    logger.debug({ mint: candidate.mint, reason: screening.reason }, "후보 탈락");
    return;
  }

  checkDailyLossLimit();
  const riskCheck = canOpenNewPosition();
  if (!riskCheck.allowed) {
    logger.info({ mint: candidate.mint, reason: riskCheck.reason }, "리스크 관리로 매수 보류");
    return;
  }

  logger.info(
    { mint: candidate.mint, symbol: candidate.symbol, progress: candidate.bondingCurveProgressPct },
    "스크리닝 통과 - 매수 시도"
  );

  await openPosition(candidate);
}

let lastSummaryDate = "";
function logDailySummaryIfMidnight(): void {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  if (now.getHours() === 23 && now.getMinutes() >= 59 && lastSummaryDate !== dateStr) {
    lastSummaryDate = dateStr;
    const pnl = getTodayPnlSol();
    void notify(
      "daily_summary",
      `오늘의 손익: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} SOL\n킬스위치: ${isKillSwitchActive() ? "작동중" : "정상"}\n오픈 포지션: ${getOpenPositionCount()}개`
    );
  }
}

process.on("unhandledRejection", (err) => {
  logger.error({ err }, "처리되지 않은 Promise 오류");
});

process.on("SIGINT", () => {
  logger.info("종료 신호 수신, 봇을 정상 종료합니다.");
  process.exit(0);
});

main().catch((err) => {
  logger.error({ err }, "봇 시작 실패");
  process.exit(1);
});
