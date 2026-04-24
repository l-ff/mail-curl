import { createServer } from "./app/create-server.js";
import { MailAdapterService } from "./application/mail-adapter-service.js";
import { loadConfig } from "./config/env.js";
import { createProviderRegistry } from "./providers/provider-registry.js";

export function buildApp(config = loadConfig()) {
  const registry = createProviderRegistry(config);
  const service = new MailAdapterService({
    registry,
  });

  return {
    config,
    registry,
    service,
    server: createServer({
      service,
      authKey: config.app.authKey,
    }),
  };
}

export function startServer() {
  const { config, server } = buildApp();
  server.listen(config.app.port, config.app.host, () => {
    console.log(`Server is running at http://${config.app.host}:${config.app.port}`);
  });
  return server;
}
