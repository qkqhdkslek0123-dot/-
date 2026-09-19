import { existsSync, readFileSync } from "node:fs";
import { strategy } from "./config.js";
import { logger } from "./logger.js";
import type { Candidate } from "./types.js";

function loadBlacklist(): Set<string> {
  const path = strategy.screening.dev_blacklist_file;
  if (!existsSync(path)) return new Set();
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    logger.warn({ path }, "블랙리스트 파일 파싱 실패, 빈 목록으로 처리");
    return new Set();
  }
}

export function passesScreening(c: Candidate): { pass: boolean; reason?: string } {
  const s = strategy.screening;

  const blacklist = loadBlacklist();
  if (blacklist.has(c.creator)) {
    return { pass: false, reason: "블랙리스트 개발자 지갑" };
  }

  if (
    c.bondingCurveProgressPct < s.min_bonding_curve_progress_pct ||
    c.bondingCurveProgressPct > s.max_bonding_curve_progress_pct
  ) {
    return { pass: false, reason: `본딩커브 진행률 범위 벗어남 (${c.bondingCurveProgressPct.toFixed(1)}%)` };
  }

  const cap = c.marketCapSol ?? 0;
  if (cap < s.min_market_cap_sol || cap > s.max_market_cap_sol) {
    return { pass: false, reason: `시가총액 범위 벗어남 (${cap.toFixed(2)} SOL)` };
  }

  if (c.uniqueBuyers < s.min_unique_buyers) {
    return { pass: false, reason: `초기 매수자 수 부족 (${c.uniqueBuyers})` };
  }

  if (c.topHolderPct > s.max_single_holder_pct) {
    return { pass: false, reason: `단일 지갑 매집 비율 초과 (${c.topHolderPct.toFixed(1)}%)` };
  }

  if (c.devHoldingPct > s.max_dev_holding_pct) {
    return { pass: false, reason: `개발자 보유 비율 초과 (${c.devHoldingPct.toFixed(1)}%)` };
  }

  return { pass: true };
}
