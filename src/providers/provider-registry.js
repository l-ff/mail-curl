import { ProviderUnavailableError } from "../core/errors.js";
import { providerDefinitions } from "./provider-definitions.js";

export class ProviderRegistry {
  constructor() {
    this.providers = new Map();
  }

  register(provider) {
    this.providers.set(provider.name, provider);
    return this;
  }

  get(name) {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new ProviderUnavailableError(name);
    }
    return provider;
  }

  list() {
    return [...this.providers.keys()];
  }
}

export function createProviderRegistry(config) {
  const registry = new ProviderRegistry();

  for (const definition of providerDefinitions) {
    if (definition.isEnabled(config)) {
      registry.register(definition.create(config));
    }
  }

  return registry;
}
