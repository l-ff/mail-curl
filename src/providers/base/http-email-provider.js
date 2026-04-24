import { UpstreamError } from "../../core/errors.js";
import { HttpClient } from "../../core/http-client.js";
import { EmailProvider } from "./email-provider.js";

export class HttpEmailProvider extends EmailProvider {
  constructor(name, options = {}) {
    super(name, options);

    if (!options.baseUrl) {
      throw new UpstreamError(`Provider '${name}' is missing baseUrl configuration`);
    }

    this.client = new HttpClient({
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
      defaultHeaders: options.defaultHeaders,
    });
  }

  async getJson(path, init = {}) {
    return this.client.getJson(path, init);
  }

  async getText(path, init = {}) {
    return this.client.getText(path, init);
  }
}
