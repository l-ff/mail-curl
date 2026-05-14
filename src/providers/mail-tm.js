import { JSDOM } from "jsdom";
import { UpstreamError } from "../errors.js";
import { HttpClient } from "../http-client.js";
import { RandomUtils } from "../random-utils.js";

const DEFAULT_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
};

const EMAIL_PATTERN = /^([a-z0-9._+-]+)@([a-z0-9.-]+\.[a-z0-9-]+)$/i;
const MAIL_ID_SEPARATOR = "::";

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeEmail(value, field = "mailboxId") {
  const email = normalizeText(value).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new UpstreamError("Invalid mail_tm email", { [field]: value });
  }
  return email;
}

function encodePassword(password) {
  return encodeURIComponent(password);
}

function decodePassword(password) {
  try {
    return decodeURIComponent(password);
  } catch {
    return password;
  }
}

function formatMailboxId(email, password) {
  return `${email}${MAIL_ID_SEPARATOR}${encodePassword(password)}`;
}

function parseMailboxId(mailboxId, fallbackPassword = "") {
  const parts = normalizeText(mailboxId).split(MAIL_ID_SEPARATOR);
  if (parts.length > 2) {
    throw new UpstreamError("Invalid mail_tm mailbox id", { mailboxId });
  }

  const email = normalizeEmail(parts[0], "mailboxId");
  if (parts.length === 2 && !parts[1]) {
    throw new UpstreamError("Invalid mail_tm mailbox id", { mailboxId });
  }

  const passwordFromId = Boolean(parts[1]);
  const password = passwordFromId ? decodePassword(parts[1]) : fallbackPassword;
  if (!password) {
    throw new UpstreamError("mail_tm mailbox password is required", { mailboxId: email });
  }

  return { email, password, passwordFromId };
}

function formatMailId({ email, password, passwordFromId }, messageId) {
  return passwordFromId
    ? `${formatMailboxId(email, password)}${MAIL_ID_SEPARATOR}${messageId}`
    : `${email}${MAIL_ID_SEPARATOR}${messageId}`;
}

function parseMailId(id, fallbackPassword = "") {
  const parts = normalizeText(id).split(MAIL_ID_SEPARATOR);
  if (parts.length === 3) {
    return {
      mailbox: parseMailboxId(`${parts[0]}${MAIL_ID_SEPARATOR}${parts[1]}`),
      messageId: normalizeText(parts[2]),
    };
  }

  if (parts.length === 2 && fallbackPassword) {
    return {
      mailbox: parseMailboxId(parts[0], fallbackPassword),
      messageId: normalizeText(parts[1]),
    };
  }

  throw new UpstreamError("Invalid mail_tm mail id", { id });
}

function htmlBody(value) {
  return Array.isArray(value) ? value.join("\n") : String(value || "");
}

function contentFromHtml(html) {
  const document = new JSDOM(html || "").window.document;
  document.querySelectorAll("script, style").forEach((element) => element.remove());
  return normalizeText(document.body?.textContent || document.documentElement?.textContent);
}

function messageContent(message) {
  return normalizeText(message.text) || contentFromHtml(htmlBody(message.html));
}

function senderName(from) {
  return normalizeText(from?.name) || normalizeText(from?.address);
}

function senderAddress(from) {
  const name = normalizeText(from?.name);
  const address = normalizeText(from?.address);
  return name && address ? `${name} <${address}>` : address || name;
}

function collectionMembers(data) {
  if (Array.isArray(data)) {
    return data;
  }

  return Array.isArray(data?.["hydra:member"]) ? data["hydra:member"] : [];
}

export class MailTmProvider {
  constructor(options) {
    this.name = "mail_tm";
    this.options = options;
    const siteUrl = options.siteUrl || "https://mail.tm";
    this.client = new HttpClient({
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
      defaultHeaders: {
        ...DEFAULT_HEADERS,
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
      transport: "json+bearer",
    };
  }

  async createMailbox() {
    const domain = await this.#randomDomain();
    const password = this.options.password || RandomUtils.lettersAndDigits(12);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const email = `${RandomUtils.lettersAndDigits(10)}@${domain}`;
      try {
        await this.client.getJson("/accounts", {
          method: "POST",
          body: JSON.stringify({ address: email, password }),
        });

        return {
          id: this.options.password ? email : formatMailboxId(email, password),
          email,
          provider: this.name,
        };
      } catch (error) {
        const status = error.details?.status;
        if (![409, 422].includes(status) || attempt === 2) {
          throw error;
        }
      }
    }

    throw new UpstreamError("mail_tm mailbox creation failed");
  }

  async listInbox({ mailboxId }) {
    const mailbox = parseMailboxId(mailboxId, this.options.password);
    const messages = collectionMembers(await this.#authedJson(mailbox, "/messages"));

    return messages.map((message) => ({
      mail_id: formatMailId(mailbox, message.id),
      sender_name: senderName(message.from),
      subject: normalizeText(message.subject),
      received_at: message.createdAt || null,
    }));
  }

  async getMail({ id }) {
    const { mailbox, messageId } = parseMailId(id, this.options.password);
    if (!messageId) {
      throw new UpstreamError("Invalid mail_tm mail id", { id });
    }

    const message = await this.#authedJson(mailbox, `/messages/${messageId}`);
    if (!message?.id) {
      throw new UpstreamError("mail_tm message was not found", { id, mailboxId: mailbox.email });
    }

    const html = '';  //htmlBody(message.html);
    return {
      id: formatMailId(mailbox, message.id),
      subject: normalizeText(message.subject),
      content: messageContent(message),
      html,
      from: senderAddress(message.from),
      received_at: message.createdAt || null,
    };
  }

  async #randomDomain() {
    const domains = collectionMembers(await this.client.getJson("/domains", { method: "GET" }))
      .filter((domain) => domain?.isActive && !domain.isPrivate && domain.domain)
      .map((domain) => domain.domain);

    if (!domains.length) {
      throw new UpstreamError("No domains available from mail_tm");
    }

    return domains[RandomUtils.intBetween(0, domains.length - 1)];
  }

  async #token({ email, password }) {
    const data = await this.client.getJson("/token", {
      method: "POST",
      body: JSON.stringify({ address: email, password }),
    });

    if (!data?.token) {
      throw new UpstreamError("mail_tm token request failed", { mailboxId: email });
    }

    return data.token;
  }

  async #authedJson(mailbox, path) {
    return this.client.getJson(path, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${await this.#token(mailbox)}`,
      },
    });
  }
}
