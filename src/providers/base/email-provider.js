export class EmailProvider {
  constructor(name, options = {}) {
    this.name = name;
    this.options = options;
  }

  capabilities() {
    return {
      createMailbox: true,
      listInbox: true,
      getMail: true,
    };
  }

  async healthCheck() {
    return {
      ok: true,
      provider: this.name,
    };
  }

  async createMailbox() {
    throw new Error(`${this.name} provider must implement createMailbox`);
  }

  async listInbox() {
    throw new Error(`${this.name} provider must implement listInbox`);
  }

  async getMail() {
    throw new Error(`${this.name} provider must implement getMail`);
  }
}
