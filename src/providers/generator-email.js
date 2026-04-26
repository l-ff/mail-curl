import { JSDOM } from 'jsdom';
import { UpstreamError } from '../errors.js';
import { HttpClient } from '../http-client.js';
import { RandomUtils } from '../random-utils.js';

const DEFAULT_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
};

const FORM_HEADERS = {
  Accept: '*/*',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'X-Requested-With': 'XMLHttpRequest'
};

const EMPTY_INBOX_TEXT = 'Email generator is ready to receive e-mail';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_PATTERN = /^[a-z0-9.-]+\.[a-z0-9-]+$/i;

const DOMAINS = [
  'bjorwi.cfd',
  'alightmotion.top',
  'ahrixthinh.net',
  'jagomail.com',
  'checkotpmail.com',
  'linkbm365.com',
  '681mail.com',
  'americancivichub.com',
  'chaocosen.com',
  'care-breath.com',
  'iclou1d.kr',
  'linksparkclick.com',
  'annd.us',
  'kajaib.social',
  'xboxppshua.top'
];

function normalizeText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function parseMailboxId(mailboxId) {
  const email = normalizeText(mailboxId).toLowerCase();
  const match = email.match(/^([a-z0-9_.-]+)@([a-z0-9.-]+\.[a-z0-9-]+)$/i);

  if (!match) {
    throw new UpstreamError('Invalid generator_email mailbox id', { mailboxId });
  }

  return { email, user: match[1], domain: match[2] };
}

function mailboxPath({ user, domain }) {
  return `/${encodeURIComponent(user)}@${encodeURIComponent(domain)}`;
}

function messagePath({ user, domain }) {
  return `/${domain}/${user}`;
}

function surlCookie(value) {
  return `surl=${encodeURIComponent(value.replace(/^\/+/, ''))}`;
}

function mailboxCookie(mailbox) {
  return surlCookie(messagePath(mailbox));
}

function messageCookie(pathname) {
  return surlCookie(decodeURIComponent(pathname));
}

function rowSummary(row) {
  return {
    sender_name: normalizeText(row?.querySelector('.from_div_45g45gg')?.textContent),
    subject: normalizeText(row?.querySelector('.subj_div_45g45gg')?.textContent) || normalizeText(row?.textContent),
    received_at: normalizeText(row?.querySelector('.time_div_45g45gg')?.textContent) || null
  };
}

function inboxItem(mailId, row) {
  const summary = rowSummary(row);
  return summary.subject ? { mail_id: mailId, ...summary } : null;
}

function randomEmail(document) {
  const domain = DOMAINS[RandomUtils.intBetween(0, DOMAINS.length - 1)];
  return `${RandomUtils.letters(8)}-lf-${RandomUtils.digits(6)}@${domain}`;
}

function parseInbox(html, mailbox, baseUrl) {
  const document = new JSDOM(html).window.document;
  if (document.body.textContent.includes(EMPTY_INBOX_TEXT)) {
    return [];
  }

  const items = [];
  const seen = new Set();
  const baseOrigin = new URL(baseUrl).origin;
  const mailboxPrefix = messagePath(mailbox).toLowerCase();

  for (const anchor of document.querySelectorAll('#email-table a[href]')) {
    let url;
    try {
      url = new URL(anchor.getAttribute('href'), baseUrl);
    } catch {
      continue;
    }

    const path = decodeURIComponent(url.pathname).toLowerCase();
    if (url.origin !== baseOrigin || !path.startsWith(`${mailboxPrefix}/`)) {
      continue;
    }

    const mailId = `${url.pathname}${url.search}`;
    const item = inboxItem(mailId, anchor);
    if (item && !seen.has(mailId)) {
      seen.add(mailId);
      items.push(item);
    }
  }

  if (items.length > 0) {
    return items;
  }

  const currentRow = document.querySelector('.mess_bodiyy')
    ? inboxItem(messagePath(mailbox), document.querySelector('#email-table .list-group-item-info'))
    : null;
  return currentRow ? [currentRow] : [];
}

function inferMailboxFromPath(pathname) {
  const segments = pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment).toLowerCase());
  if (segments.length >= 2 && DOMAIN_PATTERN.test(segments[0])) {
    return { domain: segments[0], user: segments[1], email: `${segments[1]}@${segments[0]}` };
  }
  return segments[0] && EMAIL_PATTERN.test(segments[0]) ? parseMailboxId(segments[0]) : null;
}

function parseDetail(html, id) {
  const document = new JSDOM(html).window.document;
  const contentElement = document.querySelector('.mess_bodiyy') || document.body;
  contentElement.querySelectorAll('script, style').forEach((element) => element.remove());
  const summary = rowSummary(document.querySelector('#email-table #iddelet1, #email-table .list-group-item-info'));
  return {
    id,
    subject:
      summary.subject ||
      normalizeText(document.querySelector('#message h1')?.textContent) ||
      normalizeText(document.title.replace(/ - Email Generator$/, '')),
    content: normalizeText(contentElement.textContent),
    html: '',
    from: summary.sender_name,
    received_at: summary.received_at
  };
}

export class GeneratorEmailProvider {
  constructor(options) {
    this.name = 'generator_email';
    this.options = options;
    this.client = new HttpClient({
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
      defaultHeaders: DEFAULT_HEADERS
    });
  }

  capabilities() {
    return {
      createMailbox: true,
      listInbox: true,
      getMail: true,
      transport: 'html'
    };
  }

  async createMailbox() {
    const mailbox = parseMailboxId(randomEmail());
    return {
      id: mailbox.email,
      email: mailbox.email,
      provider: this.name
    };
  }

  async listInbox({ mailboxId }) {
    const mailbox = parseMailboxId(mailboxId);
    const html = await this.client.getText(mailboxPath(mailbox), {
      method: 'GET',
      headers: {
        Cookie: mailboxCookie(mailbox),
        Referer: this.options.baseUrl
      }
    });

    return parseInbox(html, mailbox, this.options.baseUrl);
  }

  async getMail({ id }) {
    const url = new URL(id, this.options.baseUrl);
    const mailbox = inferMailboxFromPath(url.pathname);
    const html = await this.client.getText(`${url.pathname}${url.search}`, {
      method: 'GET',
      headers: mailbox
        ? {
            Cookie: messageCookie(url.pathname),
            Referer: `${this.options.baseUrl}${mailboxPath(mailbox)}`
          }
        : { Referer: this.options.baseUrl }
    });

    return parseDetail(html, id);
  }
}
