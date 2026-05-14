import WebSocket from "ws";
import { JSDOM } from "jsdom";
import { UpstreamError } from "../errors.js";
import { HttpClient } from "../http-client.js";
import { RandomUtils } from "../random-utils.js";
import { getDomains } from "./twenty-four-email-domains.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MEDIA_PATH = "/media/emails/";

function assertEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new UpstreamError("Invalid twenty_four_email mailbox id", { mailboxId: value });
  }
  return email;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function senderName(value) {
  const match = normalizeText(value).match(/^(?:"?([^"]+)"?\s*)?<[^>]+>$/);
  return normalizeText(match?.[1] || value);
}

function mailPath(id, baseUrl) {
  const url = new URL(String(id || "").trim(), baseUrl);
  const base = new URL(baseUrl);
  if (url.origin !== base.origin || !url.pathname.startsWith(MEDIA_PATH)) {
    throw new UpstreamError("Invalid twenty_four_email mail id", { id });
  }
  return `${url.pathname}${url.search}`;
}

function parseBody(html) {
  const document = new JSDOM(html).window.document;
  document.querySelectorAll("script, style").forEach((element) => element.remove());
  const title = normalizeText(document.title);
  const lines = (document.body?.textContent || "").split(/\r?\n/).map(normalizeText).filter(Boolean);

  return {
    subject: title === "Saved HTML" ? normalizeText(document.querySelector("h1,h2,h3")?.textContent) || lines[0] || "" : title,
    content: normalizeText(document.body?.textContent || ""),
    html: '' //document.body?.innerHTML || "",
  };
}

function wsUrl(baseUrl, email) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/emails";
  url.searchParams.set("email", email);
  return url.toString();
}

function readInbox(baseUrl, timeoutMs, email) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl(baseUrl, email), {
      headers: {
        Origin: baseUrl,
        Referer: `${baseUrl}/en/`,
      },
    });
    const timer = setTimeout(() => {
      socket.close();
      resolve([]);
    }, timeoutMs);

    socket.on("open", () => socket.send(JSON.stringify({ type: "init" })));
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(new UpstreamError("twenty_four_email websocket request failed", { cause: error.message }));
    });
    socket.on("message", (data) => {
      const payload = parseJson(data.toString("utf8"));
      if (Array.isArray(payload.emails)) {
        clearTimeout(timer);
        socket.close();
        resolve(payload.emails);
      }
    });
  });
}

export class TwentyFourEmailProvider {
  constructor(options) {
    this.name = "twenty_four_email";
    this.options = options;
    this.client = new HttpClient({
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
    });
  }

  capabilities() {
    return {
      createMailbox: true,
      listInbox: true,
      getMail: true,
      transport: "websocket+html",
    };
  }

  async createMailbox() {
    const domains = await getDomains();
    const domain = domains[Math.floor(Math.random() * domains.length)]?.name;
    if (!domain) {
      throw new UpstreamError("No domains available from twenty_four_email");
    }

    const a = RandomUtils.lettersAndDigits(RandomUtils.intBetween(5, 10));
    const b = RandomUtils.symbols();
    const c = RandomUtils.lettersAndDigits(RandomUtils.intBetween(5, 10));
    const email = `${a}${b}${c}@${domain}`;
    return { id: email, email, provider: this.name };
  }

  async listInbox({ mailboxId }) {
    const email = assertEmail(mailboxId);
    const emails = await readInbox(this.options.baseUrl, this.options.timeoutMs || 15000, email);

    return emails
      .filter((item) => item?.body)
      .sort((left, right) => Date.parse(right.received_at || 0) - Date.parse(left.received_at || 0))
      .map((item) => ({
        mail_id: mailPath(item.body, this.options.baseUrl),
        sender_name: senderName(item.sender),
        subject: item.subject || "",
        received_at: item.received_at || null,
      }));
  }

  async getMail({ id }) {
    const path = mailPath(id, this.options.baseUrl);
    const detail = parseBody(
      await this.client.getText(path, {
        method: "GET",
        headers: { Referer: `${this.options.baseUrl}/en/inbox` },
      }),
    );

    return {
      id: path,
      subject: detail.subject,
      content: detail.content,
      html: detail.html,
      from: {},
      received_at: null,
    };
  }
}
