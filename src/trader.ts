import fetch from "node-fetch";
import { Connection, VersionedTransaction } from "@solana/web3.js";
import { env, strategy } from "./config.js";
import { connection, getKeypair, getPublicKey } from "./wallet.js";
import { logger } from "./logger.js";

export interface TradeParams {
  mint: string;
  action: "buy" | "sell";
  amount: number; // buy: SOL 수량, sell: 토큰 수량 또는 보유비율(%)
  denominatedInSol: boolean; // sell 시 amount가 토큰수량이면 false
  slippagePct: number;
  priorityFeeSol: number;
}

export interface TradeResult {
  success: boolean;
  txSig: string | null;
  dryRun: boolean;
  error?: string;
}

/**
 * PumpPortal Local Trading API(비수탁형)를 사용해 미서명 트랜잭션을 받아온 뒤
 * 로컬 키페어로 직접 서명하고 전송한다. 개인키는 이 프로세스 밖으로 나가지 않는다.
 */
export async function executeTrade(params: TradeParams): Promise<TradeResult> {
  if (env.dryRun) {
    logger.info({ params }, "[DRY_RUN] 실제 전송 생략, 시뮬레이션 매매로 기록");
    return { success: true, txSig: `DRYRUN-${Date.now()}`, dryRun: true };
  }

  try {
    const body = {
      publicKey: getPublicKey().toBase58(),
      action: params.action,
      mint: params.mint,
      amount: params.amount,
      denominatedInSol: String(params.denominatedInSol),
      slippage: params.slippagePct,
      priorityFee: params.priorityFeeSol,
      pool: strategy.trading_api.pool,
    };

    const url = env.pumpPortalApiKey
      ? `${strategy.trading_api.local_trade_url}?api-key=${env.pumpPortalApiKey}`
      : strategy.trading_api.local_trade_url;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Local Trading API 오류 (${res.status}): ${text}`);
    }

    const txBytes = new Uint8Array(await res.arrayBuffer());
    const tx = VersionedTransaction.deserialize(txBytes);
    tx.sign([getKeypair()]);

    const txSig = await sendWithTimeout(connection, tx, strategy.buy.timeout_ms);
    return { success: true, txSig, dryRun: false };
  } catch (err: any) {
    logger.error({ err, params }, "매매 트랜잭션 실패");
    return { success: false, txSig: null, dryRun: false, error: err.message ?? String(err) };
  }
}

async function sendWithTimeout(
  conn: Connection,
  tx: VersionedTransaction,
  timeoutMs: number
): Promise<string> {
  const sigPromise = (async () => {
    const sig = await conn.sendTransaction(tx, { maxRetries: 3, skipPreflight: false });
    const latestBlockhash = await conn.getLatestBlockhash();
    await conn.confirmTransaction({ signature: sig, ...latestBlockhash }, "confirmed");
    return sig;
  })();

  const timeoutPromise = new Promise<string>((_, reject) =>
    setTimeout(() => reject(new Error("트랜잭션 확정 타임아웃")), timeoutMs)
  );

  return Promise.race([sigPromise, timeoutPromise]);
}
