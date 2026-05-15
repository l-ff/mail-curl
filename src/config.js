import fs from "fs";
import path from "path";
import dotenv from "dotenv";

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isEnabled = (value, fallback = true) => {
  if (value === undefined) {
    return fallback;
  }

  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
};

export function loadEnvFiles(cwd = process.cwd()) {
  const parsedEnv = {};

  for (const filename of [".env", ".env.local"]) {
    const filePath = path.join(cwd, filename);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const parsed = dotenv.parse(fs.readFileSync(filePath, "utf8"));
    dotenv.populate(parsedEnv, parsed, { override: true });
  }

  dotenv.populate(process.env, parsedEnv);
}

export function loadConfig() {
  loadEnvFiles();

  return {
    app: {
      port: toNumber(process.env.PORT, 3100),
      host: process.env.HOST || "::",
      authKey: process.env.MC_KEY || "sk-test",
    },
    providers: {
      chatgptMail: {
        enabled:
          Boolean(process.env.CHATGPT_MAIL_API_KEY) && isEnabled(process.env.CHATGPT_MAIL_ENABLED),
        baseUrl: process.env.CHATGPT_MAIL_BASE_URL || "https://mail.chatgpt.org.uk",
        apiKey: process.env.CHATGPT_MAIL_API_KEY || "",
        timeoutMs: toNumber(process.env.CHATGPT_MAIL_TIMEOUT_MS, 10000),
      },
      twentyFourEmail: {
        enabled: isEnabled(process.env.TWENTY_FOUR_EMAIL_ENABLED),
        baseUrl: process.env.TWENTY_FOUR_EMAIL_BASE_URL || "https://24.email",
        timeoutMs: toNumber(process.env.TWENTY_FOUR_EMAIL_TIMEOUT_MS, 10000),
      },
      generatorEmail: {
        enabled: isEnabled(process.env.GENERATOR_EMAIL_ENABLED),
        baseUrl: process.env.GENERATOR_EMAIL_BASE_URL || "https://generator.email",
        timeoutMs: toNumber(process.env.GENERATOR_EMAIL_TIMEOUT_MS, 10000),
      },
      tempMailIo: {
        enabled: isEnabled(process.env.TEMP_MAIL_IO_ENABLED),
        baseUrl: process.env.TEMP_MAIL_IO_BASE_URL || "https://api.internal.temp-mail.io",
        siteUrl: process.env.TEMP_MAIL_IO_SITE_URL || "https://temp-mail.io",
        corsHeader: process.env.TEMP_MAIL_IO_CORS_HEADER || "1",
        timeoutMs: toNumber(process.env.TEMP_MAIL_IO_TIMEOUT_MS, 10000),
      },
      mailTm: {
        enabled: isEnabled(process.env.MAIL_TM_ENABLED),
        baseUrl: process.env.MAIL_TM_BASE_URL || "https://api.mail.tm",
        siteUrl: process.env.MAIL_TM_SITE_URL || "https://mail.tm",
        password: process.env.MAIL_TM_PASSWORD || "",
        timeoutMs: toNumber(process.env.MAIL_TM_TIMEOUT_MS, 10000),
      },
      priyoEmail: {
        enabled: isEnabled(process.env.PRIYO_EMAIL_ENABLED),
        baseUrl: process.env.PRIYO_EMAIL_BASE_URL || "https://priyo.email",
        timeoutMs: toNumber(process.env.PRIYO_EMAIL_TIMEOUT_MS, 20000),
      },
    },
  };
}
