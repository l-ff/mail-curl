import { createServer as createHttpServer } from "http";
import { loadConfig } from "./config.js";
import {
  NotFoundError,
  ProviderUnavailableError,
  UnauthorizedError,
  ValidationError,
  assertMethod,
  handleError,
  sendJson,
} from "./errors.js";
import { RandomUtils } from "./random-utils.js";
import { createChatGptMailProvider } from "./providers/chatgpt-mail.js";
import { GeneratorEmailProvider } from "./providers/generator-email.js";
import { MailTmProvider } from "./providers/mail-tm.js";
import { PriyoEmailProvider } from "./providers/priyo-email.js";
import { TempMailIoProvider } from "./providers/temp-mail-io.js";
import { TwentyFourEmailProvider } from "./providers/twenty-four-email.js";

const ALL_PROVIDER_NAME = "all";
const ALL_ID_SEPARATOR = "::";

function createProviders(config) {
  const providers = new Map();

  if (config.providers.chatgptMail.enabled) {
    const provider = createChatGptMailProvider(config.providers.chatgptMail);
    providers.set(provider.name, provider);
  }

  if (config.providers.twentyFourEmail.enabled) {
    const provider = new TwentyFourEmailProvider(config.providers.twentyFourEmail);
    providers.set(provider.name, provider);
  }

  if (config.providers.generatorEmail.enabled) {
    const provider = new GeneratorEmailProvider(config.providers.generatorEmail);
    providers.set(provider.name, provider);
  }

  if (config.providers.tempMailIo.enabled) {
    const provider = new TempMailIoProvider(config.providers.tempMailIo);
    providers.set(provider.name, provider);
  }

  if (config.providers.mailTm.enabled) {
    const provider = new MailTmProvider(config.providers.mailTm);
    providers.set(provider.name, provider);
  }

  if (config.providers.priyoEmail.enabled) {
    const provider = new PriyoEmailProvider(config.providers.priyoEmail);
    providers.set(provider.name, provider);
  }

  return providers;
}

function getProvider(providers, name) {
  const provider = providers.get(name);
  if (!provider) {
    throw new ProviderUnavailableError(name);
  }
  return provider;
}

function providerSupports(provider, capability) {
  return provider.capabilities?.()?.[capability] === true;
}

function randomProvider(providers, capability) {
  const candidates = [...providers.values()].filter((provider) =>
    providerSupports(provider, capability),
  );
  if (!candidates.length) {
    throw new ProviderUnavailableError(ALL_PROVIDER_NAME);
  }

  return candidates[RandomUtils.intBetween(0, candidates.length - 1)];
}

function health(providers) {
  return {
    ok: true,
    providers: [...providers.values()].map((provider) => ({
      name: provider.name,
      capabilities: provider.capabilities(),
    })),
  };
}

function wrapAllId(providerName, id) {
  return `${providerName}${ALL_ID_SEPARATOR}${id}`;
}

function unwrapAllId(value, field) {
  const text = String(value || "").trim();
  const separatorIndex = text.indexOf(ALL_ID_SEPARATOR);
  if (separatorIndex <= 0 || separatorIndex + ALL_ID_SEPARATOR.length >= text.length) {
    throw new ValidationError(`${field} must include provider prefix when using all`);
  }

  return {
    providerName: text.slice(0, separatorIndex),
    id: text.slice(separatorIndex + ALL_ID_SEPARATOR.length),
  };
}

function wrapAllMailbox(provider, mailbox) {
  return {
    ...mailbox,
    id: wrapAllId(provider.name, mailbox.id),
    provider: provider.name,
    provider_id: mailbox.id,
  };
}

function wrapAllInbox(provider, inbox) {
  return inbox.map((mail) => ({
    ...mail,
    mail_id: wrapAllId(provider.name, mail.mail_id),
    provider: provider.name,
    provider_mail_id: mail.mail_id,
  }));
}

function wrapAllMail(provider, mail) {
  return {
    ...mail,
    id: wrapAllId(provider.name, mail.id),
    provider: provider.name,
    provider_mail_id: mail.id,
  };
}

function ensureAuth(url, authKey) {
  const key = url.searchParams.get("key");
  if (key !== authKey) {
    throw new UnauthorizedError();
  }
}

function extractProviderRoute(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 3) {
    return null;
  }

  const [providerName, ...rest] = segments;
  return {
    providerName,
    routePath: `/${rest.join("/")}`,
  };
}

function createRouter({ providers, authKey }) {
  return async function route(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const providerRoute = extractProviderRoute(url.pathname);

    try {
      if (url.pathname === "/health") {
        assertMethod(req, ["GET"]);
        sendJson(res, 200, health(providers));
        return;
      }

      if (providerRoute?.routePath === "/api/remail") {
        assertMethod(req, ["POST"]);
        ensureAuth(url, authKey);
        const isAllProvider = providerRoute.providerName === ALL_PROVIDER_NAME;
        const provider = isAllProvider
          ? randomProvider(providers, "createMailbox")
          : getProvider(providers, providerRoute.providerName);
        const mailbox = await provider.createMailbox();
        sendJson(res, 200, isAllProvider ? wrapAllMailbox(provider, mailbox) : mailbox);
        return;
      }

      if (providerRoute?.routePath === "/api/inbox") {
        assertMethod(req, ["GET"]);
        ensureAuth(url, authKey);
        const mailboxId = url.searchParams.get("mailbox_id");
        if (!mailboxId) {
          throw new ValidationError("mailbox_id is required");
        }

        const isAllProvider = providerRoute.providerName === ALL_PROVIDER_NAME;
        const route = isAllProvider
          ? unwrapAllId(mailboxId, "mailbox_id")
          : { providerName: providerRoute.providerName, id: mailboxId };
        const provider = getProvider(providers, route.providerName);
        const inbox = await provider.listInbox({ mailboxId: route.id });
        sendJson(res, 200, isAllProvider ? wrapAllInbox(provider, inbox) : inbox);
        return;
      }

      if (providerRoute?.routePath === "/api/mail") {
        assertMethod(req, ["GET"]);
        ensureAuth(url, authKey);
        const id = url.searchParams.get("id");
        if (!id) {
          throw new ValidationError("id is required");
        }

        const isAllProvider = providerRoute.providerName === ALL_PROVIDER_NAME;
        const route = isAllProvider
          ? unwrapAllId(id, "id")
          : { providerName: providerRoute.providerName, id };
        const provider = getProvider(providers, route.providerName);
        const mail = await provider.getMail({ id: route.id });
        sendJson(res, 200, isAllProvider ? wrapAllMail(provider, mail) : mail);
        return;
      }

      throw new NotFoundError("Route not found");
    } catch (error) {
      handleError(res, error);
    }
  };
}

export function buildApp(config = loadConfig()) {
  const providers = createProviders(config);

  return {
    config,
    providers,
    server: createHttpServer(
      createRouter({
        providers,
        authKey: config.app.authKey,
      }),
    ),
  };
}

export function startServer() {
  const { config, server } = buildApp();
  server.listen(config.app.port, config.app.host, () => {
    console.log(`Server is running at http://${config.app.host}:${config.app.port}`);
  });
  return server;
}
