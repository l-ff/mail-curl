import { UpstreamError } from "../errors.js";
import { HttpClient } from "../http-client.js";

export function createChatGptMailProvider({ baseUrl, apiKey, timeoutMs }) {
  const client = new HttpClient({
    baseUrl,
    timeoutMs,
    defaultHeaders: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
  });

  return {
    name: "chatgpt_mail",

    capabilities() {
      return {
        createMailbox: true,
        listInbox: true,
        getMail: true,
      };
    },

    async createMailbox() {
      const data = await client.getJson("/api/generate-email", { method: "POST" });
      const email = data?.data?.email;

      if (!email) {
        throw new UpstreamError("Provider returned an invalid mailbox payload");
      }

      return {
        id: email,
        email,
        provider: this.name,
      };
    },

    async listInbox({ mailboxId }) {
      const data = await client.getJson(`/api/emails?email=${encodeURIComponent(mailboxId)}`, {
        method: "GET",
      });

      return (data?.data?.emails || []).map((email) => ({
        mail_id: email.id,
        sender_name: email.from || email.subject || "",
        subject: email.subject || "",
        received_at: email.created_at || email.date || null,
      }));
    },

    async getMail({ id }) {
      const data = await client.getJson(`/api/email/${encodeURIComponent(id)}`, {
        method: "GET",
      });

      const mail = data?.data;
      if (!mail) {
        throw new UpstreamError("Provider returned an invalid mail payload");
      }

      return {
        id,
        subject: mail.subject || "",
        content: mail.content || "",
        html: mail.html_content || "",
        from: {
          name: mail.from || "",
          address: mail.from_email || "",
        },
        received_at: mail.created_at || mail.date || null,
      };
    },
  };
}
