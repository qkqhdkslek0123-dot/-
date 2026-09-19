import { strategy } from "./config.js";
import { getOpenPositions, getTodayPnlSol } from "./db.js";
import { logger } from "./logger.js";
import { notify } from "./notifier.js";

let killSwitchActive = false;

export function isKillSwitchActive(): boolean {
  return killSwitchActive;
}

export function checkDailyLossLimit(): void {
  if (killSwitchActive) return;

  const todayPnl = getTodayPnlSol();
  const limit = strategy.capital.total_sol * strategy.capital.daily_loss_limit_pct;

  if (todayPnl <= -limit) {
    killSwitchActive = true;
    logger.error({ todayPnl, limit }, "일일 손실 한도 도달 - 킬스위치 작동, 신규 매수 중단");
    void notify(
      "kill_switch",
      `일일 손실 한도(-${limit.toFixed(4)} SOL) 도달. 오늘 손익: ${todayPnl.toFixed(4)} SOL. 신규 매수를 중단합니다.`
    );
  }
}

export function canOpenNewPosition(): { allowed: boolean; reason?: string } {
  if (killSwitchActive) return { allowed: false, reason: "일일 손실 한도로 인한 킬스위치 작동 중" };

  const open = getOpenPositions();
  if (open.length >= strategy.capital.max_concurrent_positions) {
    return { allowed: false, reason: `최대 동시 포지션 수(${strategy.capital.max_concurrent_positions}) 도달` };
  }

  return { allowed: true };
}

export function getPositionSizeSol(): number {
  return strategy.capital.total_sol * strategy.capital.position_size_pct;
}
