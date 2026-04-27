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
import { createChatGptMailProvider } from "./providers/chatgpt-mail.js";
import { GeneratorEmailProvider } from "./providers/generator-email.js";
import { PriyoEmailProvider } from "./providers/priyo-email.js";
import { TwentyTwoDoProvider } from "./providers/twenty-two-do.js";
import { TwentyFourEmailProvider } from "./providers/twenty-four-email.js";

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

  if (config.providers.twentyTwoDo.enabled) {
    const provider = new TwentyTwoDoProvider(config.providers.twentyTwoDo);
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

function health(providers) {
  return {
    ok: true,
    providers: [...providers.values()].map((provider) => ({
      name: provider.name,
      capabilities: provider.capabilities(),
    })),
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
        const provider = getProvider(providers, providerRoute.providerName);
        sendJson(res, 200, await provider.createMailbox());
        return;
      }

      if (providerRoute?.routePath === "/api/inbox") {
        assertMethod(req, ["GET"]);
        ensureAuth(url, authKey);
        const mailboxId = url.searchParams.get("mailbox_id");
        if (!mailboxId) {
          throw new ValidationError("mailbox_id is required");
        }

        const provider = getProvider(providers, providerRoute.providerName);
        sendJson(res, 200, await provider.listInbox({ mailboxId }));
        return;
      }

      if (providerRoute?.routePath === "/api/mail") {
        assertMethod(req, ["GET"]);
        ensureAuth(url, authKey);
        const id = url.searchParams.get("id");
        if (!id) {
          throw new ValidationError("id is required");
        }

        const provider = getProvider(providers, providerRoute.providerName);
        sendJson(res, 200, await provider.getMail({ id }));
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
