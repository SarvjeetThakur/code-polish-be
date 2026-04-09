import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";
import { join } from "node:path";

export async function registerPlugins(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Code Polish Backend API",
        description: "Fastify backend APIs for auth and multi-agent workflows.",
        version: "1.0.0",
      },
      servers: [
        {
          url: "http://localhost:3000",
          description: "Local development",
        },
      ],
      tags: [
        { name: "Health", description: "Service health endpoints" },
        { name: "Auth", description: "Authentication endpoints" },
        { name: "Agents", description: "Multi-agent orchestration endpoints" },
        { name: "Refine", description: "Code refinement APIs" },
      ],
    },
  });

  await app.register(cookie);
  await app.register(fastifyStatic, {
    root: join(process.cwd(), "src", "assets", "generated-images"),
    prefix: "/assets/generated-images/",
  });
  await app.register(swaggerUI, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
    },
    staticCSP: true,
  });

  app.get("/openapi.json", async () => {
    return app.swagger();
  });
}

