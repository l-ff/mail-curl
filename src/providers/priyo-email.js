import { JSDOM } from "jsdom";
import { UpstreamError } from "../errors.js";
import { HttpClient } from "../http-client.js";
import { RandomUtils } from "../random-utils.js";

const DEFAULT_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
};

const JSON_HEADERS = {
  Accept: "*/*",
  "Content-Type": "application/json",
  "X-Livewire": "1",
};

const FALLBACK_DOMAINS = [
  "mailp.org priyo-mail.com priyomail.top priyomail.in kanonmail.com lottery-sambad.site priyomail.site",
  "ytpremium.store oky.ovh priyomail.us dpl.ovh iplv.ovh kpl.ovh mpk.ovh idf.ovh frm.ovh bdm.ovh",
  "priyo.ovh dv2.host ukm.ovh sgm.ovh usm.ovh oku.ovh bpl.ovh en.priyomail.ovh en.priyomail.org",
  "en.priyomail.nl en.priyodown.com en.priyo.edu.pl en.kpl.ovh en.iplv.ovh en.dpl.ovh en.bpltv.com en.bpl.ovh en.auth2fa.com",
].join(" ").split(" ");

const DOMAIN_PATTERN = /^[a-z0-9.-]+\.[a-z0-9-]+$/i;
const MAIL_ID_SEPARATOR = "::";
const WIRE = {
  changeAccount: "themes.components.change-account",
  inbox: "themes.components.inbox-message",
};

const text = (value) => (value || "").replace(/\s+/g, " ").trim();
const dom = (html) => new JSDOM(html || "").window.document;
const call = (method, params = []) => ({ method, params, metadata: {} });

function parseMailboxId(mailboxId) {
  const email = text(mailboxId).toLowerCase();
  const match = email.match(/^([a-z0-9_.-]+)@([a-z0-9.-]+\.[a-z0-9-]+)$/i);
  if (!match) {
    throw new UpstreamError("Invalid priyo_email mailbox id", { mailboxId });
  }
  return { email, username: match[1], domain: match[2] };
}

function parseMailId(id) {
  const value = text(id);
  const separatorIndex = value.lastIndexOf(MAIL_ID_SEPARATOR);
  if (separatorIndex <= 0) {
    throw new UpstreamError("Invalid priyo_email mail id", { id });
  }

  const mailbox = parseMailboxId(value.slice(0, separatorIndex));
  const messageId = text(value.slice(separatorIndex + MAIL_ID_SEPARATOR.length));
  if (!messageId) {
    throw new UpstreamError("Invalid priyo_email mail id", { id });
  }
  return { mailbox, messageId };
}

function formatMailId(mailbox, messageId) {
  return `${mailbox.email}${MAIL_ID_SEPARATOR}${messageId}`;
}

function mergeCookies(cookieJar, response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : (response.headers.get("set-cookie") || "").split(/,(?=\s*[^;,=\s]+=[^;]+)/);

  for (const value of values) {
    const [pair] = value.split(";");
    const separatorIndex = pair?.indexOf("=") ?? -1;
    if (separatorIndex > 0) {
      cookieJar.set(pair.slice(0, separatorIndex).trim(), pair.slice(separatorIndex + 1).trim());
    }
  }
}

function cookieHeader(cookieJar) {
  return [...cookieJar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function livewireSnapshot(document, name) {
  const snapshot = [...document.querySelectorAll("*")]
    .find((element) => element.getAttribute("wire:name") === name)
    ?.getAttribute("wire:snapshot");
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

function randomDomainsFromSnapshot(document) {
  try {
    const data = JSON.parse(livewireSnapshot(document, WIRE.changeAccount)).data || {};
    const domains = (Array.isArray(data.domains?.[0]) ? data.domains[0] : [])
      .map((tuple) => tuple?.[0])
      .filter((domain) => domain?.active_status && domain.status === "random" && DOMAIN_PATTERN.test(domain.domain))
      .map((domain) => domain.domain);

    return domains.length > 0 ? domains : FALLBACK_DOMAINS;
  } catch {
    return FALLBACK_DOMAINS;
  }
}

function detailTime(document, messageId, row) {
  const detail = document.getElementById(`message-${messageId}`);
  return text(detail?.querySelector(".text-base")?.textContent) || text(row?.querySelector("span")?.textContent) || null;
}

function messageSource(document, messageId) {
  const content = document.getElementById(`content-${messageId}`);
  const iframe = content?.matches?.("iframe") ? content : content?.querySelector?.("iframe");
  return iframe?.getAttribute("srcdoc") || content?.value || content?.innerHTML || "";
}

function cleanBody(html) {
  const document = dom(html);
  document.querySelectorAll("script, style").forEach((element) => element.remove());
  return {
    subject: text(document.title),
    content: text(document.body?.textContent || document.documentElement?.textContent),
  };
}

function parseInbox(html, mailbox) {
  const document = dom(html);
  const seen = new Set();

  return [...document.querySelectorAll(".inbox-list[data-id]")].flatMap((row) => {
    const messageId = row.getAttribute("data-id");
    if (!messageId || seen.has(messageId)) {
      return [];
    }

    seen.add(messageId);
    const body = cleanBody(messageSource(document, messageId));
    return [{
      mail_id: formatMailId(mailbox, messageId),
      sender_name: text(row.querySelector("h2")?.textContent),
      subject: text(row.querySelector("p")?.textContent) || body.subject,
      received_at: detailTime(document, messageId, row),
    }];
  });
}

function parseDetail(html, mailbox, messageId) {
  const document = dom(html);
  const raw = messageSource(document, messageId);
  if (!raw) {
    throw new UpstreamError("Priyo message was not found", { messageId, mailboxId: mailbox.email });
  }

  const body = cleanBody(raw);
  return {
    id: formatMailId(mailbox, messageId),
    subject: body.subject,
    content: body.content,
    html: "",
    from: "",
    received_at: detailTime(document, messageId),
  };
}

function dispatchedEmail(data) {
  return data?.components
    ?.flatMap((component) => component.effects?.dispatches || [])
    .find((dispatch) => dispatch.name === "syncEmail")
    ?.params?.email;
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
    const page = await this.#loadHome(new Map());
    const domains = randomDomainsFromSnapshot(page.document);
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
    return parseInbox(await this.#loadMailbox(mailbox), mailbox);
  }

  async getMail({ id }) {
    const { mailbox, messageId } = parseMailId(id);
    return parseDetail(await this.#loadMailbox(mailbox), mailbox, messageId);
  }

  async #loadMailbox(mailbox) {
    const cookieJar = new Map();
    const home = await this.#loadHome(cookieJar);
    const changed = await this.#livewire(home.document, cookieJar, WIRE.changeAccount, {
      updates: {
        username: mailbox.username,
        domain: mailbox.domain,
      },
      calls: [call("changeEmailAddress")],
    });

    if (dispatchedEmail(changed) !== mailbox.email) {
      throw new UpstreamError("Priyo mailbox change failed", { mailboxId: mailbox.email, response: changed });
    }

    const mailboxHome = await this.#loadHome(cookieJar);
    const inbox = await this.#livewire(mailboxHome.document, cookieJar, WIRE.inbox, {
      calls: [call("__dispatch", ["fetchMessages", {}])],
    });

    return inbox?.components?.[0]?.effects?.html || mailboxHome.html;
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
      document: dom(html),
    };
  }

  async #livewire(document, cookieJar, name, { updates = {}, calls = [] }) {
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
            snapshot: livewireSnapshot(document, name),
            updates,
            calls,
          },
        ],
      }),
    });
    mergeCookies(cookieJar, response);
    return response.json();
  }
}
