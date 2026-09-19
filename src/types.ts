export interface StrategyConfig {
  capital: {
    total_sol: number;
    position_size_pct: number;
    max_concurrent_positions: number;
    daily_loss_limit_pct: number;
  };
  screening: {
    graduation_market_cap_sol: number;
    min_bonding_curve_progress_pct: number;
    max_bonding_curve_progress_pct: number;
    min_market_cap_sol: number;
    max_market_cap_sol: number;
    max_token_age_seconds: number;
    min_unique_buyers: number;
    max_single_holder_pct: number;
    max_dev_holding_pct: number;
    dev_blacklist_file: string;
  };
  buy: {
    slippage_pct: number;
    priority_fee_sol: number;
    timeout_ms: number;
  };
  sell: {
    take_profit_ladder: { gain_pct: number; sell_pct: number }[];
    stop_loss_pct: number;
    trailing_stop_pct: number;
    max_hold_seconds: number;
    slippage_pct: number;
    priority_fee_sol: number;
  };
  monitor: {
    websocket_url: string;
  };
  trading_api: {
    local_trade_url: string;
    pool: string;
  };
  notifications: {
    enabled: boolean;
    notify_on: string[];
  };
}

export interface NewTokenEvent {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  createdAt: number;
  initialBuySol?: number;
  marketCapSol?: number;
  bondingCurveKey?: string;
  vSolInBondingCurve?: number;
  vTokensInBondingCurve?: number;
}

export interface Candidate extends NewTokenEvent {
  bondingCurveProgressPct: number;
  uniqueBuyers: number;
  topHolderPct: number;
  devHoldingPct: number;
}

export interface Position {
  id: string;
  mint: string;
  symbol: string;
  entryPriceSol: number;
  entryAmountSol: number;
  tokenAmount: number;
  remainingTokenAmount: number;
  highWaterMarkPriceSol: number;
  openedAt: number;
  filledTpStages: number[];
  status: "open" | "closed";
}

export interface TradeRecord {
  id: string;
  mint: string;
  symbol: string;
  side: "buy" | "sell";
  amountSol: number;
  priceSol: number;
  reason: string;
  txSig: string | null;
  dryRun: boolean;
  timestamp: number;
  pnlSol?: number;
}
