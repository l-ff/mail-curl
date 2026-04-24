import { assertMethod, handleError, sendJson } from "./http-helpers.js";
import { NotFoundError, UnauthorizedError } from "../core/errors.js";

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

export function createRouter({ service, authKey }) {
  return async function route(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const providerRoute = extractProviderRoute(url.pathname);

    try {
      if (url.pathname === "/health") {
        assertMethod(req, ["GET"]);
        sendJson(res, 200, service.health());
        return;
      }

      if (providerRoute?.routePath === "/api/remail") {
        assertMethod(req, ["POST"]);
        ensureAuth(url, authKey);
        sendJson(res, 200, await service.createMailbox(providerRoute.providerName));
        return;
      }

      if (providerRoute?.routePath === "/api/inbox") {
        assertMethod(req, ["GET"]);
        ensureAuth(url, authKey);
        const mailboxId = url.searchParams.get("mailbox_id");
        sendJson(
          res,
          200,
          await service.listInbox({ providerName: providerRoute.providerName, mailboxId }),
        );
        return;
      }

      if (providerRoute?.routePath === "/api/mail") {
        assertMethod(req, ["GET"]);
        ensureAuth(url, authKey);
        const mailId = url.searchParams.get("id");
        sendJson(res, 200, await service.getMail({ providerName: providerRoute.providerName, mailId }));
        return;
      }

      throw new NotFoundError("Route not found");
    } catch (error) {
      handleError(res, error);
    }
  };
}
