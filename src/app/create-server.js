import { createServer as createHttpServer } from "http";
import { createRouter } from "../http/create-router.js";

export function createServer(options) {
  return createHttpServer(createRouter(options));
}
