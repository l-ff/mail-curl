import { ValidationError } from "../core/errors.js";

export class MailAdapterService {
  constructor({ registry }) {
    this.registry = registry;
  }

  health() {
    return {
      ok: true,
      providers: this.registry.list().map((name) => {
        const provider = this.registry.get(name);
        return {
          name,
          capabilities: provider.capabilities(),
        };
      }),
    };
  }

  async createMailbox(providerName) {
    return this.#getProvider(providerName).createMailbox();
  }

  async listInbox({ providerName, mailboxId }) {
    if (!mailboxId) {
      throw new ValidationError("mailbox_id is required");
    }

    return this.#getProvider(providerName).listInbox({ mailboxId });
  }

  async getMail({ providerName, mailId }) {
    if (!mailId) {
      throw new ValidationError("id is required");
    }

    return this.#getProvider(providerName).getMail({ id: mailId });
  }

  #getProvider(providerName) {
    return this.registry.get(providerName);
  }
}
