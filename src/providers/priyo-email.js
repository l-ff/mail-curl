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
  Accept: "*/*",
  "Content-Type": "application/json",
  "X-Livewire": "1",
};

const FALLBACK_DOMAINS = [
  "mailp.org",
  "priyo-mail.com",
  "priyomail.top",
  "priyomail.in",
  "kanonmail.com",
  "lottery-sambad.site",
  "priyomail.site",
  "ytpremium.store",
  "oky.ovh",
  "priyomail.us",
  "dpl.ovh",
  "iplv.ovh",
  "kpl.ovh",
  "mpk.ovh",
  "idf.ovh",
  "frm.ovh",
  "bdm.ovh",
  "priyo.ovh",
  "dv2.host",
  "ukm.ovh",
  "sgm.ovh",
  "usm.ovh",
  "oku.ovh",
  "bpl.ovh",
  "en.priyomail.ovh",
  "en.priyomail.org",
  "en.priyomail.nl",
  "en.priyodown.com",
  "en.priyo.edu.pl",
  "en.kpl.ovh",
  "en.iplv.ovh",
  "en.dpl.ovh",
  "en.bpltv.com",
  "en.bpl.ovh",
  "en.auth2fa.com",
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_PATTERN = /^[a-z0-9.-]+\.[a-z0-9-]+$/i;
const MAIL_ID_SEPARATOR = "::";

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function parseMailboxId(mailboxId) {
  const email = normalizeText(mailboxId).toLowerCase();
  const match = email.match(/^([a-z0-9_.-]+)@([a-z0-9.-]+\.[a-z0-9-]+)$/i);
  if (!match) {
    throw new UpstreamError("Invalid priyo_email mailbox id", { mailboxId });
  }

  return { email, username: match[1], domain: match[2] };
}

function formatMailId(mailbox, messageId) {
  return `${mailbox.email}${MAIL_ID_SEPARATOR}${messageId}`;
}

function parseMailId(id) {
  const value = normalizeText(id);
  const separatorIndex = value.lastIndexOf(MAIL_ID_SEPARATOR);
  if (separatorIndex > 0) {
    const mailbox = parseMailboxId(value.slice(0, separatorIndex));
    const messageId = normalizeText(value.slice(separatorIndex + MAIL_ID_SEPARATOR.length));
    if (messageId) {
      return { mailbox, messageId };
    }
  }

  throw new UpstreamError("Invalid priyo_email mail id", { id });
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

function livewireComponent(document, name) {
  const element = [...document.querySelectorAll("*")].find((node) => node.getAttribute("wire:name") === name);
  const snapshot = element?.getAttribute("wire:snapshot");

  if (!snapshot) {
    throw new UpstreamError("Priyo Livewire component not found", { name });
  }

  return snapshot;
}

function livewireToken(document) {
  const token =
    document.querySelector("script[data-csrf]")?.getAttribute("data-csrf") ||
    document.querySelector('meta[name="csrf-token"]')?.getAttribute("content");

  if (!token) {
    throw new UpstreamError("Priyo Livewire CSRF token not found");
  }

  return token;
}

function parseLivewireData(snapshot) {
  try {
    return JSON.parse(snapshot).data || {};
  } catch {
    return {};
  }
}

function randomDomainsFromSnapshot(document) {
  const data = parseLivewireData(livewireComponent(document, "themes.components.change-account"));
  const domainTuples = Array.isArray(data.domains?.[0]) ? data.domains[0] : [];
  const domains = domainTuples
    .map((tuple) => tuple?.[0])
    .filter((domain) => domain?.active_status && domain.status === "random" && DOMAIN_PATTERN.test(domain.domain))
    .map((domain) => domain.domain);

  return domains.length > 0 ? domains : FALLBACK_DOMAINS;
}

function parseSender(value) {
  const sender = normalizeText(value);
  const match = sender.match(/^(?:"?([^"]+)"?\s*)?<([^>]+)>$/);
  return match
    ? { name: normalizeText(match[1]), address: normalizeText(match[2]) }
    : { name: sender, address: sender.includes("@") ? sender : "" };
}

function parseRawMessage(raw) {
  const value = String(raw || "");
  const separator = value.match(/\r?\n\r?\n/);
  const headerText = separator ? value.slice(0, separator.index) : "";
  const body = separator ? value.slice(separator.index + separator[0].length) : value;
  const headers = {};

  for (const line of headerText.split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      headers[match[1].toLowerCase()] = match[2];
    }
  }

  return {
    subject: normalizeText(headers.subject),
    from: parseSender(headers.from),
    html: body,
  };
}

function bodyContent(html) {
  const document = new JSDOM(html || "").window.document;
  document.querySelectorAll("script, style").forEach((element) => element.remove());

  return {
    content: normalizeText(document.body?.textContent || document.documentElement.textContent),
    html: document.body?.innerHTML || html || "",
  };
}

function detailTime(document, messageId) {
  const detail = document.getElementById(`message-${messageId}`);
  const candidates = [...(detail?.querySelectorAll(".text-base") || [])].map((element) => normalizeText(element.textContent));
  return candidates.find(Boolean) || null;
}

function messageContentSource(document, messageId) {
  const content = document.getElementById(`content-${messageId}`);
  const iframe = content?.matches?.("iframe") ? content : content?.querySelector?.("iframe");

  return iframe?.getAttribute("srcdoc") || content?.value || "";
}

function parseInbox(html, mailbox) {
  const document = new JSDOM(html).window.document;
  const items = [];
  const seen = new Set();

  for (const row of document.querySelectorAll(".inbox-list[data-id]")) {
    const messageId = row.getAttribute("data-id");
    if (!messageId || seen.has(messageId)) {
      continue;
    }

    seen.add(messageId);
    const raw = messageContentSource(document, messageId);
    const parsed = parseRawMessage(raw);

    items.push({
      mail_id: formatMailId(mailbox, messageId),
      sender_name: normalizeText(row.querySelector("h2")?.textContent) || parsed.from.name || parsed.from.address,
      subject: normalizeText(row.querySelector("p")?.textContent) || parsed.subject,
      received_at: detailTime(document, messageId) || normalizeText(row.querySelector("span")?.textContent) || null,
    });
  }

  return items;
}

function parseDetail(html, mailbox, messageId) {
  const document = new JSDOM(html).window.document;
  const raw = messageContentSource(document, messageId);
  if (!raw) {
    throw new UpstreamError("Priyo message was not found", { messageId, mailboxId: mailbox.email });
  }
  // const parsed = parseRawMessage(raw);
  // const body = bodyContent(parsed.html);

  const document2 = new JSDOM(raw).window.document;
  document2.querySelectorAll("script, style").forEach((el) => el.remove());

  return {
    id: formatMailId(mailbox, messageId),
    subject: document2.title || "",
    content: document2.body.textContent.replace(/\s+/g, " ").trim() || "",
    html: "",//raw,
    from: "",//parsed.from,
    received_at: detailTime(document, messageId),
  };
}

export class PriyoEmailProvider {
  constructor(options) {
    this.name = "priyo_email";
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
      transport: "livewire+html",
    };
  }

  async createMailbox() {
    const session = await this.#loadHome(new Map());
    const domains = randomDomainsFromSnapshot(session.document);
    const domain = domains[RandomUtils.intBetween(0, domains.length - 1)];
    const email = `${RandomUtils.letters(8)}${RandomUtils.digits(4)}@${domain}`;

    return {
      id: email,
      email,
      provider: this.name,
    };
  }

  async listInbox({ mailboxId }) {
    const mailbox = parseMailboxId(mailboxId);
    const html = await this.#loadMailbox(mailbox);
    return parseInbox(html, mailbox);
  }

  async getMail({ id }) {
    const { mailbox, messageId } = parseMailId(id);
    const html = await this.#loadMailbox(mailbox);
    return parseDetail(html, mailbox, messageId);
  }

  async #loadMailbox(mailbox) {
    const cookieJar = new Map();
    const home = await this.#loadHome(cookieJar);
    await this.#changeMailbox(home.document, cookieJar, mailbox);
    return (await this.#loadHome(cookieJar)).html;
  }

  async #loadHome(cookieJar) {
    const response = await this.client.request("/", {
      method: "GET",
      headers: cookieHeader(cookieJar) ? { Cookie: cookieHeader(cookieJar) } : {},
    });
    mergeCookies(cookieJar, response);

    const html = await response.text();
    return {
      html,
      document: new JSDOM(html).window.document,
    };
  }

  async #changeMailbox(document, cookieJar, mailbox) {
    const response = await this.client.request("/livewire/update", {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        Origin: this.options.baseUrl,
        Referer: `${this.options.baseUrl}/`,
        Cookie: cookieHeader(cookieJar),
      },
      body: JSON.stringify({
        _token: livewireToken(document),
        components: [
          {
            snapshot: livewireComponent(document, "themes.components.change-account"),
            updates: {
              username: mailbox.username,
              domain: mailbox.domain,
            },
            calls: [{ method: "changeEmailAddress", params: [], metadata: {} }],
          },
        ],
      }),
    });
    mergeCookies(cookieJar, response);

    const data = await response.json();
    const dispatches = data?.components?.flatMap((component) => component.effects?.dispatches || []) || [];
    const syncedEmail = dispatches.find((dispatch) => dispatch.name === "syncEmail")?.params?.email;
    if (syncedEmail !== mailbox.email) {
      throw new UpstreamError("Priyo mailbox change failed", { mailboxId: mailbox.email, response: data });
    }
  }
}
