import "dotenv/config";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { StrategyConfig } from "./types.js";

function requireEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`환경변수 ${name} 가 설정되지 않았습니다 (.env 확인)`);
  return v;
}

export const strategy: StrategyConfig = parse(readFileSync("./config.yaml", "utf-8"));

export const env = {
  dryRun: (process.env.DRY_RUN ?? "true").toLowerCase() !== "false",
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY ?? "",
  rpcUrl: requireEnv("RPC_URL", "https://api.mainnet-beta.solana.com"),
  pumpPortalApiKey: process.env.PUMPPORTAL_API_KEY ?? "",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
};

export function assertLiveTradeReady(): void {
  if (env.dryRun) return;
  if (!env.walletPrivateKey) {
    throw new Error(
      "DRY_RUN=false 인데 WALLET_PRIVATE_KEY 가 없습니다. 실거래 전 반드시 지갑 키를 설정하세요."
    );
  }
}
