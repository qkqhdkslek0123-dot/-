import pino from "pino";
import { mkdirSync } from "node:fs";

mkdirSync("./logs", { recursive: true });

export const logger = pino(
  { level: process.env.LOG_LEVEL ?? "info" },
  pino.transport({
    targets: [
      { target: "pino-pretty", options: { colorize: true }, level: "info" },
      { target: "pino/file", options: { destination: "./logs/bot.log", mkdir: true }, level: "debug" },
    ],
  })
);
