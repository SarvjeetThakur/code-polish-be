import type { FastifyBaseLogger } from "fastify";

export function createModuleLogger(logger: FastifyBaseLogger, module: string) {
  return logger.child({ module });
}

