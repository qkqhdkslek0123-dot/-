import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { env } from "./config.js";
import { logger } from "./logger.js";

export const connection = new Connection(env.rpcUrl, "confirmed");

let keypair: Keypair | null = null;

export function getKeypair(): Keypair {
  if (keypair) return keypair;
  if (!env.walletPrivateKey) {
    throw new Error("WALLET_PRIVATE_KEY가 설정되지 않았습니다.");
  }
  keypair = Keypair.fromSecretKey(bs58.decode(env.walletPrivateKey));
  return keypair;
}

export function getPublicKey(): PublicKey {
  return getKeypair().publicKey;
}

export async function getSolBalance(): Promise<number> {
  const balance = await connection.getBalance(getPublicKey());
  return balance / LAMPORTS_PER_SOL;
}

export async function assertSufficientBalance(minSol: number): Promise<void> {
  const balance = await getSolBalance();
  if (balance < minSol) {
    logger.error({ balance, minSol }, "지갑 잔고 부족");
    throw new Error(`지갑 잔고 부족: ${balance} SOL < 필요 최소 ${minSol} SOL`);
  }
}
