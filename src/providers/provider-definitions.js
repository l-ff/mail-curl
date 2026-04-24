import { ChatGPTMailProvider } from "./chatgpt-mail/chatgpt-mail-provider.js";
import { TwentyFourEmailProvider } from "./twenty-four-email/twenty-four-email-provider.js";

export const providerDefinitions = [
  {
    name: "chatgpt_mail",
    configKey: "chatgptMail",
    isEnabled: (config) => Boolean(config.providers.chatgptMail.enabled),
    create: (config) => new ChatGPTMailProvider(config.providers.chatgptMail),
  },
  {
    name: "twenty_four_email",
    configKey: "twentyFourEmail",
    isEnabled: (config) => Boolean(config.providers.twentyFourEmail.enabled),
    create: (config) => new TwentyFourEmailProvider(config.providers.twentyFourEmail),
  },
];
