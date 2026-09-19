import fetch from "node-fetch";
import { env } from "./config.js";
import { strategy } from "./config.js";
import { logger } from "./logger.js";

type NotifyKind = "buy" | "sell" | "error" | "daily_summary" | "kill_switch";

export async function notify(kind: NotifyKind, message: string): Promise<void> {
  logger.info({ kind }, message);

  if (!strategy.notifications.enabled) return;
  if (!strategy.notifications.notify_on.includes(kind)) return;
  if (!env.telegramBotToken || !env.telegramChatId) return;

  try {
    const url = `https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.telegramChatId,
        text: `[pump.fun bot] ${message}`,
        parse_mode: "HTML",
      }),
    });
  } catch (err) {
    logger.warn({ err }, "텔레그램 알림 전송 실패");
  }
}
