import fs from "fs";
import path from "path";

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function stripWrappingQuotes(value) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseDotEnv(content) {
  const entries = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = stripWrappingQuotes(line.slice(separatorIndex + 1).trim());
    if (key) {
      entries[key] = value;
    }
  }

  return entries;
}

export function loadEnvFiles(cwd = process.cwd()) {
  const protectedKeys = new Set(Object.keys(process.env));

  for (const filename of [".env", ".env.local"]) {
    const filePath = path.join(cwd, filename);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const parsed = parseDotEnv(fs.readFileSync(filePath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (!protectedKeys.has(key)) {
        process.env[key] = value;
      }
    }
  }
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
        enabled: Boolean(process.env.CHATGPT_MAIL_API_KEY),
        baseUrl: process.env.CHATGPT_MAIL_BASE_URL || "https://mail.chatgpt.org.uk",
        apiKey: process.env.CHATGPT_MAIL_API_KEY || "",
        timeoutMs: toNumber(process.env.CHATGPT_MAIL_TIMEOUT_MS, 15000),
      },
      twentyFourEmail: {
        enabled: process.env.TWENTY_FOUR_EMAIL_ENABLED === "1",
        baseUrl: process.env.TWENTY_FOUR_EMAIL_BASE_URL || "https://24.email",
        timeoutMs: toNumber(process.env.TWENTY_FOUR_EMAIL_TIMEOUT_MS, 15000),
      },
      generatorEmail: {
        enabled: process.env.GENERATOR_EMAIL_ENABLED === "1",
        baseUrl: process.env.GENERATOR_EMAIL_BASE_URL || "https://generator.email",
        timeoutMs: toNumber(process.env.GENERATOR_EMAIL_TIMEOUT_MS, 15000),
      },
      twentyTwoDo: {
        enabled: process.env.TWENTY_TWO_DO_ENABLED === "1",
        baseUrl: process.env.TWENTY_TWO_DO_BASE_URL || "https://22.do",
        timeoutMs: toNumber(process.env.TWENTY_TWO_DO_TIMEOUT_MS, 20000),
        language: process.env.TWENTY_TWO_DO_LANGUAGE || "en-US",
      },
      priyoEmail: {
        enabled: process.env.PRIYO_EMAIL_ENABLED === "1",
        baseUrl: process.env.PRIYO_EMAIL_BASE_URL || "https://priyo.email",
        timeoutMs: toNumber(process.env.PRIYO_EMAIL_TIMEOUT_MS, 20000),
      },
    },
  };
}
