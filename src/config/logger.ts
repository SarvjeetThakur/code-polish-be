import type { FastifyServerOptions } from "fastify";

import { env } from "./env";

export const loggerConfig: FastifyServerOptions["logger"] = {
  level: env.NODE_ENV === "production" ? "info" : "debug",
  base: {
    service: "code-polish-be",
    env: env.NODE_ENV,
  },
  timestamp: true,
};

