import { JSDOM } from "jsdom";
import { UpstreamError } from "../errors.js";
import { HttpClient } from "../http-client.js";
import { RandomUtils } from "../random-utils.js";

const DEFAULT_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
};

const EMAIL_PATTERN = /^([^\s@]+)@([^\s@]+\.[^\s@]+)$/;
const DOMAINS = [
  "bjorwi.cfd",
  "alightmotion.top",
  "ahrixthinh.net",
  "jagomail.com",
  "checkotpmail.com",
  "linkbm365.com",
  "681mail.com",
  "americancivichub.com",
  "chaocosen.com",
  "care-breath.com",
  "iclou1d.kr",
  "linksparkclick.com",
  "annd.us",
  "kajaib.social",
  "xboxppshua.top",
];

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function mailbox(mailboxId) {
  const match = normalizeText(mailboxId).toLowerCase().match(EMAIL_PATTERN);
  if (!match) {
    throw new UpstreamError("Invalid generator_email mailbox id", { mailboxId });
  }
  return { email: `${match[1]}@${match[2]}`, user: match[1], domain: match[2] };
}

function mailboxPath({ user, domain }) {
  return `/${encodeURIComponent(user)}@${encodeURIComponent(domain)}`;
}

function messagePrefix({ user, domain }) {
  return `/${domain}/${user}`;
}

function surlCookie(path) {
  return `surl=${encodeURIComponent(path.replace(/^\/+/, ""))}`;
}

function sameOriginPath(id, baseUrl) {
  const url = new URL(String(id || "").trim(), baseUrl);
  if (url.origin !== new URL(baseUrl).origin) {
    throw new UpstreamError("Invalid generator_email mail id", { id });
  }
  return `${url.pathname}${url.search}`;
}

function rowSummary(row) {
  return {
    sender_name: normalizeText(row?.querySelector(".from_div_45g45gg")?.textContent),
    subject: normalizeText(row?.querySelector(".subj_div_45g45gg")?.textContent) || normalizeText(row?.textContent),
    received_at: normalizeText(row?.querySelector(".time_div_45g45gg")?.textContent) || null,
  };
}

function parseInbox(html, box, baseUrl) {
  const document = new JSDOM(html).window.document;
  const prefix = messagePrefix(box).toLowerCase();

  const items = [...document.querySelectorAll("#email-table a[href]")]
    .map((anchor) => {
      let path;
      try {
        path = sameOriginPath(anchor.getAttribute("href"), baseUrl);
      } catch {
        return null;
      }

      const decodedPath = decodeURIComponent(path).toLowerCase();
      return decodedPath.startsWith(`${prefix}/`) ? { mail_id: path, ...rowSummary(anchor) } : null;
    })
    .filter((item) => item?.subject);

  if (items.length || !document.querySelector(".mess_bodiyy")) {
    return items;
  }

  const summary = rowSummary(document.querySelector("#email-table .list-group-item-info"));
  return summary.subject ? [{ mail_id: messagePrefix(box), ...summary }] : [];
}

function parseDetail(html, id) {
  const document = new JSDOM(html).window.document;
  const body = document.querySelector(".mess_bodiyy") || document.body;
  body.querySelectorAll("script, style").forEach((element) => element.remove());
  const summary = rowSummary(document.querySelector("#email-table #iddelet1, #email-table .list-group-item-info"));

  return {
    id,
    subject: summary.subject || normalizeText(document.title.replace(/ - Email Generator$/, "")),
    content: normalizeText(body.textContent),
    html: '', //body.innerHTML || "",
    from: summary.sender_name,
    received_at: summary.received_at,
  };
}

export class GeneratorEmailProvider {
  constructor(options) {
    this.name = "generator_email";
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
    const a = RandomUtils.lettersAndDigits(RandomUtils.intBetween(5, 10));
    const b = RandomUtils.symbols();
    const c = RandomUtils.lettersAndDigits(RandomUtils.intBetween(5, 10));
    const email = `${a}${b}${c}@${domain}`;
    return { id: email, email, provider: this.name };
  }

  async listInbox({ mailboxId }) {
    const box = mailbox(mailboxId);
    const html = await this.client.getText(mailboxPath(box), {
      method: "GET",
      headers: {
        Cookie: surlCookie(messagePrefix(box)),
        Referer: this.options.baseUrl,
      },
    });
    return parseInbox(html, box, this.options.baseUrl);
  }

  async getMail({ id }) {
    const path = sameOriginPath(id, this.options.baseUrl);
    const html = await this.client.getText(path, {
      method: "GET",
      headers: {
        Cookie: surlCookie(decodeURIComponent(path)),
        Referer: this.options.baseUrl,
      },
    });
    return parseDetail(html, path);
  }
}
