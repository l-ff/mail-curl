import { JSDOM } from "jsdom";
import { UpstreamError } from "../errors.js";
import { HttpClient } from "../http-client.js";
import { RandomUtils } from "../random-utils.js";

const DEFAULT_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
};

const JSON_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

const DOMAINS = [
  "linshiyou.com",
  "colabeta.com",
  "youxiang.dev",
  "colaname.com",
  "usdtbeta.com",
  "tnbeta.com",
  "fft.edu.do",
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function normalizeMailboxId(mailboxId) {
  const email = normalizeText(mailboxId).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new UpstreamError("Invalid twenty_two_do mailbox id", { mailboxId });
  }
  return email;
}

function normalizeMessageId(id) {
  const value = normalizeText(id);
  if (!value) {
    throw new UpstreamError("Invalid twenty_two_do message id", { id });
  }

  try {
    const url = new URL(value);
    const match = url.pathname.match(/\/content\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : value;
  } catch {
    return value.replace(/^\/?content\//, "").split(/[?#]/)[0];
  }
}

function setCookieValues(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const value = headers.get("set-cookie");
  return value ? value.split(/,(?=\s*[^;,=\s]+=[^;]+)/) : [];
}

function mergeCookies(cookieJar, response) {
  for (const cookie of setCookieValues(response.headers)) {
    const [pair] = cookie.split(";");
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex > 0) {
      cookieJar.set(pair.slice(0, separatorIndex).trim(), pair.slice(separatorIndex + 1).trim());
    }
  }
}

function cookieHeader(cookieJar) {
  return [...cookieJar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function parseTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000).toISOString() : null;
}

function messageIdFromOnclick(value) {
  const match = String(value || "").match(/viewEml\('([^']+)'\)/) || String(value || "").match(/'([^']+)'/);
  return match?.[1] || "";
}

function parseInbox(html) {
  const document = new JSDOM(html).window.document;
  const items = [];
  const seen = new Set();

  for (const row of document.querySelectorAll("#email-list-wrap .tr")) {
    const subjectElement = row.querySelector(".subject");
    const mailId = messageIdFromOnclick(subjectElement?.getAttribute("onclick"));
    if (!mailId || seen.has(mailId)) {
      continue;
    }

    seen.add(mailId);
    items.push({
      mail_id: mailId,
      sender_name: normalizeText(row.querySelector(".from")?.textContent),
      subject: normalizeText(subjectElement?.textContent),
      received_at: parseTimestamp(row.querySelector(".time")?.getAttribute("data-bs-time")),
    });
  }

  return items;
}

function parseDetailHeader(html, id) {
  const document = new JSDOM(html).window.document;
  const text = normalizeText(document.body.textContent);
  const summary = text.match(/Rubject[:：]\s*(.*?)\s+From[:：]\s*(.*?)\s+Sent Time[:：]\s*([0-9/:\-\s]+)/);
  const iframe = document.querySelector('iframe[src*="/view/"]');

  return {
    id,
    subject: normalizeText(summary?.[1]) || normalizeText(document.title.replace(/ – .*$/, "")),
    from: normalizeText(summary?.[2]),
    received_at: normalizeText(summary?.[3]) || null,
    iframeSrc: iframe?.getAttribute("src") || "",
  };
}

function parseMessageBody(html) {
  const document = new JSDOM(html).window.document;
  document.querySelectorAll("script, style").forEach((element) => element.remove());
  return {
    content: normalizeText(document.body.textContent),
    html: document.body.innerHTML,
  };
}

export class TwentyTwoDoProvider {
  constructor(options) {
    this.name = "twenty_two_do";
    this.options = options;
    this.client = new HttpClient({
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
      defaultHeaders: DEFAULT_HEADERS,
    });
  }

  capabilities() {
    return {
      createMailbox: true,
      listInbox: true,
      getMail: true,
      transport: "html",
    };
  }

  async createMailbox() {
    const domain = DOMAINS[RandomUtils.intBetween(0, DOMAINS.length - 1)];
    const email = `${RandomUtils.letters(8)}${RandomUtils.digits(5)}@${domain}`;

    return {
      id: email,
      email,
      provider: this.name,
    };
  }

  async listInbox({ mailboxId }) {
    const email = normalizeMailboxId(mailboxId);
    const session = await this.#login(email);
    const html = await this.client.getText("/inbox/", {
      method: "GET",
      headers: {
        Cookie: session.cookie,
        Referer: `${this.options.baseUrl}/`,
      },
    });

    return parseInbox(html);
  }

  async getMail({ id }) {
    const messageId = normalizeMessageId(id);
    const detailHtml = await this.client.getText(`/content/${encodeURIComponent(messageId)}`, {
      method: "GET",
      headers: {
        Referer: `${this.options.baseUrl}/inbox/`,
      },
    });
    const header = parseDetailHeader(detailHtml, messageId);
    const body = header.iframeSrc
      ? parseMessageBody(
        await this.client.getText(new URL(header.iframeSrc, this.options.baseUrl).toString(), {
          method: "GET",
          headers: {
            Referer: `${this.options.baseUrl}/content/${encodeURIComponent(messageId)}`,
          },
        }),
      )
      : { content: "", html: "" };

    return {
      id: messageId,
      subject: header.subject,
      content: body.content,
      html: body.html,
      from: header.from,
      received_at: header.received_at,
    };
  }

  async #login(email) {
    const cookieJar = new Map();
    const home = await this.client.request("/", { method: "GET" });
    mergeCookies(cookieJar, home);

    const response = await this.client.request("/action/mailbox/login", {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        Origin: this.options.baseUrl,
        Referer: `${this.options.baseUrl}/`,
        Cookie: cookieHeader(cookieJar),
      },
      body: JSON.stringify({ email, language: this.options.language || "en-US" }),
    });
    mergeCookies(cookieJar, response);

    const data = await response.json();
    if (!data?.status || !data.redirect) {
      throw new UpstreamError("twenty_two_do login failed", { response: data });
    }

    return {
      redirect: data.redirect,
      cookie: cookieHeader(cookieJar),
    };
  }
}
