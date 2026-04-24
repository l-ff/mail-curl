import WebSocket from "ws";
import { JSDOM } from "jsdom";
import { UpstreamError } from "../errors.js";
import { HttpClient } from "../http-client.js";
import { RandomUtils } from "../random-utils.js";
import { getDomains } from "./twenty-four-email-domains.js";

const WS_HEADERS = {
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Sec-Fetch-Dest": "websocket",
  "Sec-Fetch-Mode": "websocket",
  "Sec-Fetch-Site": "same-origin",
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseSender(sender) {
  const value = typeof sender === "string" ? sender.trim() : "";
  const match = value.match(/^(?:"?([^"]+)"?\s*)?<([^>]+)>$/);

  return match
    ? { name: (match[1] || "").trim(), address: (match[2] || "").trim() }
    : { name: value, address: value.includes("@") ? value : "" };
}

async function frameToText(data) {
  if (typeof data === "string") {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }
  if (data instanceof Blob) {
    return data.text();
  }
  return String(data);
}

function extractEmails(payload, mailboxId) {
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload)) {
    return payload.flatMap((item) => extractEmails(item, mailboxId));
  }
  if (payload.email && typeof payload.email === "object") {
    return [{ ...payload.email, recipient: payload.email.recipient || mailboxId }];
  }
  if (Array.isArray(payload.emails)) {
    return payload.emails
      .filter((item) => item && typeof item === "object")
      .map((email) => ({ ...email, recipient: email.recipient || mailboxId }));
  }
  if (payload.type === "new" && payload.id) {
    return [{ ...payload, recipient: payload.recipient || mailboxId }];
  }
  return [];
}

function collectEmails(messages, mailboxId) {
  const emails = new Map();

  for (const message of messages) {
    for (const email of extractEmails(parseJson(message), mailboxId)) {
      if (email?.id) {
        emails.set(email.id, email);
      }
    }
  }

  return [...emails.values()].sort(
    (left, right) => (Date.parse(right.received_at || 0) || 0) - (Date.parse(left.received_at || 0) || 0),
  );
}

export class TwentyFourEmailProvider {
  constructor(options) {
    this.name = "twenty_four_email";
    this.options = options;
    this.client = new HttpClient({
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
    });
    this.origin = options.origin || options.baseUrl;
    this.referer = options.referer || `${options.baseUrl}/ru/`;
    this.mailboxIdleMs = clamp(options.mailboxIdleMs || 1200, 500, 5000);
    this.mailboxConnectTimeoutMs = Math.max(
      this.mailboxIdleMs + 1000,
      clamp(options.timeoutMs || 15000, 0, 20000),
    );
  }

  capabilities() {
    return {
      createMailbox: true,
      listInbox: true,
      getMail: true,
      implementation: "websocket",
      transport: "websocket+html",
    };
  }

  async createMailbox() {
    const domains = await getDomains();
    if (domains.length === 0) {
      throw new UpstreamError("No domains available from twenty_four_email");
    }

    const domain = domains[Math.floor(Math.random() * domains.length)].name;
    const email = `${RandomUtils.letters(10)}-lf-${RandomUtils.digits(5)}@${domain}`;

    return {
      id: email,
      email,
      provider: this.name,
    };
  }

  async listInbox({ mailboxId }) {
    const messages = await this.#readMailboxEvents(mailboxId);
    return collectEmails(messages, mailboxId).map((email) => ({
      mail_id: email.body || "",
      sender_name: parseSender(email.sender).name || email.sender || "",
      subject: email.subject || "",
      received_at: email.received_at || null,
    }));
  }

  async getMail({ id }) {
    const html = await this.client.getText(this.options.baseUrl + id, {
      method: "GET",
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    const document = new JSDOM(html).window.document;
    document.querySelectorAll("script, style").forEach((el) => el.remove());

    return {
      id,
      subject: document.title || "",
      content: document.body.textContent.replace(/\s+/g, " ").trim() || "",
      html: "",
      from: {},
      received_at: null,
    };
  }

  async #readMailboxEvents(mailboxId) {
    const wsUrl = this.#buildWsUrl(mailboxId);

    return new Promise((resolve, reject) => {
      const messages = [];
      let settled = false;
      let idleTimer;
      let hardTimer;
      let socket;

      const finish = (callback) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(idleTimer);
        clearTimeout(hardTimer);
        socket?.close(1000, "done");
        callback();
      };

      const resolveMessages = () => finish(() => resolve(messages));
      const resetIdleTimer = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(resolveMessages, this.mailboxIdleMs);
      };
      const rejectWithUpstream = (message, details = {}) => {
        finish(() => reject(new UpstreamError(message, details)));
      };

      try {
        socket = new WebSocket(wsUrl, {
          headers: {
            ...WS_HEADERS,
            Origin: this.origin,
            Referer: this.referer,
          },
        });
      } catch (error) {
        rejectWithUpstream("Failed to create twenty_four_email websocket", {
          cause: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      hardTimer = setTimeout(resolveMessages, this.mailboxConnectTimeoutMs);
      socket.on("open", resetIdleTimer);
      socket.on("close", resolveMessages);
      socket.on("error", (event) => {
        rejectWithUpstream("twenty_four_email websocket request failed", {
          cause: event?.message || event?.type || "websocket_error",
          wsUrl,
        });
      });
      socket.on("message", async (data) => {
        try {
          const frame = await frameToText(data);
          messages.push(frame);

          if (extractEmails(parseJson(frame), mailboxId).length > 0) {
            resolveMessages();
            return;
          }

          resetIdleTimer();
        } catch (error) {
          rejectWithUpstream("Failed to parse twenty_four_email websocket payload", {
            cause: error instanceof Error ? error.message : String(error),
          });
        }
      });
    });
  }

  #buildWsUrl(mailboxId) {
    const base = new URL(this.options.baseUrl);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    base.pathname = "/ws/emails";
    base.search = `email=${encodeURIComponent(mailboxId)}`;
    return base.toString();
  }
}
