import { JSDOM } from "jsdom";
import { UpstreamError } from "../errors.js";
import { HttpClient } from "../http-client.js";

const DEFAULT_HEADERS = {
  Accept: "*/*",
  "Application-Name": "web",
  "Application-Version": "4.0.0",
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  "X-CORS-Header": "1",
};

const EMAIL_PATTERN = /^([a-z0-9._+-]+)@([a-z0-9.-]+\.[a-z0-9-]+)$/i;
const MAIL_ID_SEPARATOR = "::";

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseMailboxId(mailboxId) {
  const email = normalizeText(mailboxId).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new UpstreamError("Invalid temp_mail_io mailbox id", { mailboxId });
  }
  return email;
}

function formatMailId(email, messageId) {
  return `${email}${MAIL_ID_SEPARATOR}${messageId}`;
}

function parseMailId(id) {
  const value = normalizeText(id);
  const separatorIndex = value.lastIndexOf(MAIL_ID_SEPARATOR);
  if (separatorIndex <= 0) {
    throw new UpstreamError("Invalid temp_mail_io mail id", { id });
  }

  const email = parseMailboxId(value.slice(0, separatorIndex));
  const messageId = normalizeText(value.slice(separatorIndex + MAIL_ID_SEPARATOR.length));
  if (!messageId) {
    throw new UpstreamError("Invalid temp_mail_io mail id", { id });
  }
  return { email, messageId };
}

function senderName(from) {
  const sender = normalizeText(from);
  const match = sender.match(/^(?:"?([^"]+)"?\s*)?<[^>]+>$/);
  return normalizeText(match?.[1] || sender);
}

function textFromHtml(html) {
  const document = new JSDOM(html || "").window.document;
  document.querySelectorAll("script, style").forEach((element) => element.remove());
  return normalizeText(document.body?.textContent || document.documentElement?.textContent);
}

function messageContent(message) {
  return normalizeText(message.body_text) || textFromHtml(message.body_html);
}

export class TempMailIoProvider {
  constructor(options) {
    this.name = "temp_mail_io";
    this.options = options;
    const siteUrl = options.siteUrl || "https://temp-mail.io";
    this.client = new HttpClient({
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
      defaultHeaders: {
        ...DEFAULT_HEADERS,
        "X-CORS-Header": options.corsHeader || DEFAULT_HEADERS["X-CORS-Header"],
        Origin: siteUrl,
        Referer: `${siteUrl}/`,
      },
    });
  }

  capabilities() {
    return {
      createMailbox: true,
      listInbox: true,
      getMail: true,
      transport: "json",
    };
  }

  async createMailbox() {
    const data = await this.client.getJson("/api/v3/email/new", {
      method: "POST",
      body: JSON.stringify({
        min_name_length: 10,
        max_name_length: 10,
      }),
    });
    const email = parseMailboxId(data?.email);

    return {
      id: email,
      email,
      provider: this.name,
    };
  }

  async listInbox({ mailboxId }) {
    const email = parseMailboxId(mailboxId);
    const messages = await this.#messages(email);

    return messages.map((message) => ({
      mail_id: formatMailId(email, message.id),
      sender_name: senderName(message.from),
      subject: normalizeText(message.subject),
      received_at: message.created_at || null,
    }));
  }

  async getMail({ id }) {
    const { email, messageId } = parseMailId(id);
    const message = (await this.#messages(email)).find((item) => item.id === messageId);
    if (!message) {
      throw new UpstreamError("temp_mail_io message was not found", { id, mailboxId: email });
    }

    return {
      id: formatMailId(email, message.id),
      subject: normalizeText(message.subject),
      content: messageContent(message),
      html: message.body_html || "",
      from: message.from || "",
      received_at: message.created_at || null,
    };
  }

  async #messages(email) {
    const messages = await this.client.getJson(`/api/v3/email/${email}/messages`, {
      method: "GET",
    });

    return Array.isArray(messages) ? messages.filter((message) => message?.id) : [];
  }
}
