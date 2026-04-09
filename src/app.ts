import Fastify from "fastify";

import { loggerConfig } from "./config/logger";
import { registerPlugins } from "./plugins";
import { agentRoutes } from "./routes/agents.route";
import { authRoutes } from "./routes/auth.route";
import { healthRoutes } from "./routes/health.route";
import { refineRoutes } from "./routes/refine.route";

export async function buildApp() {
  const app = Fastify({ logger: loggerConfig });

  await registerPlugins(app);
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(refineRoutes);
  await app.register(agentRoutes);

  return app;
}

