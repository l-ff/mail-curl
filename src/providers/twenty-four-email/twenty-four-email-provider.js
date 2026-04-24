import { UpstreamError, ValidationError } from "../../core/errors.js";
import { HttpEmailProvider } from "../base/http-email-provider.js";
import { RandomUtils } from '../../shared/random-utils.js'
import { getDomains } from './domains.js'
import WebSocket from "ws";
const { JSDOM } = await import("jsdom");

export class TwentyFourEmailProvider extends HttpEmailProvider {
  constructor(options) {
    super("twenty_four_email", {
      ...options,
      defaultHeaders: {},
    });

    this.origin = options.origin || this.options.baseUrl;
    this.referer = options.referer || this.options.baseUrl + "/ru/";
    this.mailboxIdleMs = Math.max(500, Math.min(options.mailboxIdleMs || 1200, 5000));
    this.mailboxConnectTimeoutMs = Math.max(
      this.mailboxIdleMs + 1000,
      Math.min(options.timeoutMs || 15000, 20000),
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
    const randomDomain = domains[Math.floor(Math.random() * domains.length)];
    const localPart = `${RandomUtils.letters(10)}-lf-${RandomUtils.digits(5)}`;
    const email = `${localPart}@${randomDomain.name}`;

    return {
      id: email,
      email,
      provider: this.name,
    };
  }

  async listInbox({ mailboxId }) {
    const messages = await this.#readMailboxEvents(mailboxId);
    const emails = this.#collectEmails(messages, mailboxId);
    return emails.map((email) => ({
      mail_id: email.body || "",
      sender_name: this.#parseSender(email.sender).name || email.sender || "",
      subject: email.subject || "",
      received_at: email.received_at || null,
    }));
  }

  async getMail({ id }) {
    const html = await this.getText(this.options.baseUrl + id, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
      },
    });

    const dom = new JSDOM(html);
    const document = dom.window.document;
    document.querySelectorAll("script, style").forEach(el => el.remove());
    const text = document.body.textContent
      .replace(/\s+/g, " ")
      .trim();

    return {
      id,
      subject: document.title || "",
      content: text || "",
      html: '',
      from: {},
      received_at: null,
    };
  }

  async #readMailboxEvents(mailboxId) {
    const wsUrl = this.#buildWsUrl(mailboxId);

    return new Promise((resolve, reject) => {
      const messages = [];
      let settled = false;
      let idleTimer = null;
      let hardTimer = null;
      let socket;

      const finish = (callback) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(idleTimer);
        clearTimeout(hardTimer);

        try {
          if (socket && socket.readyState < WebSocket.CLOSING) {
            socket.close(1000, "done");
          }
        } catch { }

        callback();
      };

      const armIdleTimer = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => finish(() => resolve(messages)), this.mailboxIdleMs);
      };

      try {
        socket = new WebSocket(wsUrl, {
          headers: {
            Origin: this.origin,
            Referer: this.referer,
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
            "Sec-Fetch-Dest": "websocket",
            "Sec-Fetch-Mode": "websocket",
            "Sec-Fetch-Site": "same-origin",
          },
        });
      } catch (error) {
        reject(
          new UpstreamError("Failed to create twenty_four_email websocket", {
            cause: error instanceof Error ? error.message : String(error),
          }),
        );
        return;
      }

      hardTimer = setTimeout(() => finish(() => resolve(messages)), this.mailboxConnectTimeoutMs);

      socket.on("open", () => {
        armIdleTimer();
      });

      socket.on("message", async (data) => {
        try {
          const frame = await this.#readFrameData(data);
          messages.push(frame);
          const parsed = this.#safeJsonParse(frame);
          const emails = this.#extractEmails(parsed, mailboxId);
          if (emails.length > 0) {
            finish(() => resolve(messages));
            return;
          }

          armIdleTimer();
        } catch (error) {
          finish(() =>
            reject(
              new UpstreamError("Failed to parse twenty_four_email websocket payload", {
                cause: error instanceof Error ? error.message : String(error),
              }),
            ),
          );
        }
      });

      socket.on("error", (event) => {
        finish(() =>
          reject(
            new UpstreamError("twenty_four_email websocket request failed", {
              cause: event?.message || event?.type || "websocket_error",
              wsUrl,
            }),
          ),
        );
      });

      socket.on("close", () => {
        finish(() => resolve(messages));
      });
    });
  }

  async #readFrameData(data) {
    if (typeof data === "string") {
      return data;
    }

    if (data instanceof Blob) {
      return data.text();
    }

    if (data instanceof ArrayBuffer) {
      return Buffer.from(data).toString("utf8");
    }

    if (Buffer.isBuffer(data)) {
      return data.toString("utf8");
    }

    if (ArrayBuffer.isView(data)) {
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
    }

    return String(data);
  }

  #collectEmails(messages, mailboxId) {
    const emails = new Map();

    for (const rawMessage of messages) {
      const parsed = this.#safeJsonParse(rawMessage);
      for (const email of this.#extractEmails(parsed, mailboxId)) {
        if (!email?.id) {
          continue;
        }
        emails.set(email.id, email);
      }
    }

    return [...emails.values()].sort((left, right) => {
      const leftTime = Date.parse(left.received_at || 0) || 0;
      const rightTime = Date.parse(right.received_at || 0) || 0;
      return rightTime - leftTime;
    });
  }

  #extractEmails(payload, mailboxId) {
    if (!payload) {
      return [];
    }

    if (Array.isArray(payload)) {
      return payload.flatMap((item) => this.#extractEmails(item, mailboxId));
    }

    if (payload.email && typeof payload.email === "object") {
      return [this.#normalizeEmail(payload.email, mailboxId)];
    }

    if (Array.isArray(payload.emails)) {
      return payload.emails
        .filter((item) => item && typeof item === "object")
        .map((item) => this.#normalizeEmail(item, mailboxId));
    }

    if (payload.type === "new" && payload.id) {
      return [this.#normalizeEmail(payload, mailboxId)];
    }

    return [];
  }

  #normalizeEmail(email, mailboxId) {
    return {
      ...email,
      recipient: email.recipient || mailboxId,
    };
  }

  #safeJsonParse(value) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  #buildWsUrl(mailboxId) {
    const base = new URL(this.options.baseUrl);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    base.pathname = "/ws/emails";
    base.search = `email=${encodeURIComponent(mailboxId)}`;
    return base.toString();
  }

  #resolveBodyUrl(bodyPath) {
    if (/^https?:\/\//.test(bodyPath)) {
      return bodyPath;
    }

    const base = this.options.baseUrl.endsWith("/") ? this.options.baseUrl : `${this.options.baseUrl}/`;
    return new URL(bodyPath.replace(/^\//, ""), base).toString();
  }

  #parseSender(sender) {
    const value = typeof sender === "string" ? sender.trim() : "";
    const match = value.match(/^(?:"?([^"]+)"?\s*)?<([^>]+)>$/);

    if (match) {
      return {
        name: (match[1] || "").trim(),
        address: (match[2] || "").trim(),
      };
    }

    return {
      name: value,
      address: value.includes("@") ? value : "",
    };
  }
}
