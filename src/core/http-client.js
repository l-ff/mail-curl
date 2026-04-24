import { UpstreamError } from "./errors.js";

export class HttpClient {
  constructor({ baseUrl, timeoutMs = 15000, defaultHeaders = {} }) {
    this.baseUrl = baseUrl ? baseUrl.replace(/\/$/, "") : "";
    this.timeoutMs = timeoutMs;
    this.defaultHeaders = defaultHeaders;
  }

  async getJson(path, init = {}) {
    const response = await this.request(path, init);

    try {
      return await response.json();
    } catch (error) {
      throw new UpstreamError("Upstream did not return valid JSON", {
        path,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getText(path, init = {}) {
    const response = await this.request(path, init);
    return response.text();
  }

  async request(path, init = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.#resolveUrl(path), {
        ...init,
        signal: controller.signal,
        headers: {
          ...this.defaultHeaders,
          ...(init.headers || {}),
        },
      });

      if (!response.ok) {
        throw new UpstreamError(`Provider request failed: ${response.statusText}`, {
          path,
          status: response.status,
        });
      }

      return response;
    } catch (error) {
      if (error instanceof UpstreamError) {
        throw error;
      }

      throw new UpstreamError(error instanceof Error ? error.message : "Unknown upstream error", {
        path,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  #resolveUrl(path) {
    if (/^https?:\/\//.test(path)) {
      return path;
    }

    if (!this.baseUrl) {
      throw new UpstreamError("Provider baseUrl is not configured", { path });
    }

    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }
}
