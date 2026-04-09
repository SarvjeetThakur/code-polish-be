import type { FastifyPluginAsync } from "fastify";

import { COOKIE_KEYS } from "../constants/auth";
import { createModuleLogger } from "../lib/logger";
import { AgentRunRequestSchema } from "../schemas/agent.schema";
import { runMultiAgentWorkflow } from "../services/agent.service";

export const agentRoutes: FastifyPluginAsync = async (app) => {
  const logger = createModuleLogger(app.log, "agents.route");

  app.post(
    "/api/agents/run",
    {
      schema: {
        tags: ["Agents"],
        summary: "Run dynamic multi-agent workflow",
        body: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string" },
            action: { type: "string", enum: ["REFINE", "RENAME", "PROMPT"] },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              query: { type: "string" },
              action: { anyOf: [{ type: "string" }, { type: "null" }] },
              ctoSatisfied: { type: "boolean" },
              ctoFeedback: { type: "string" },
              agentsUsed: { type: "array", items: { type: "object", additionalProperties: true } },
              defaultAgents: { type: "array", items: { type: "object", additionalProperties: true } },
              dynamicAgents: { type: "array", items: { type: "object", additionalProperties: true } },
              logs: { type: "array", items: { type: "string" } },
              artifacts: {
                type: "object",
                additionalProperties: {
                  type: "object",
                  additionalProperties: true,
                  properties: {
                    output: { type: "string" },
                    round: { type: "number" },
                    role: { type: "string" },
                  },
                },
              },
              imagePaths: { type: "array", items: { type: "string" } },
              imageUrls: { type: "array", items: { type: "string" } },
              usage: {
                type: "object",
                properties: {
                  googleCalls: { type: "number" },
                  googleCallsWithoutSearchTool: { type: "number" },
                  huggingFaceCalls: { type: "number" },
                  imageCalls: { type: "number" },
                  googleImageCalls: { type: "number" },
                  huggingFaceImageCalls: { type: "number" },
                  modelValidationCalls: { type: "number" },
                  // Informational note: limits are configured via env and can be tier-based in future.
                },
              },
              finalResult: { type: "string" },
            },
          },
          400: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
          401: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
          500: {
            type: "object",
            properties: {
              error: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = AgentRunRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid request body",
          details: parsed.error.flatten(),
        });
      }

      const authCookie = request.cookies[COOKIE_KEYS.AUTH];
      if (!authCookie) {
        return reply.status(401).send({ error: "Access denied. Please log in." });
      }

      try {
        const baseUrl = `${request.protocol}://${request.headers.host ?? "localhost:3000"}`;
        const result = await runMultiAgentWorkflow(
          parsed.data.query,
          parsed.data.action,
          baseUrl,
          (message) => logger.info(message),
        );

        return reply.send({
          success: true,
          ...result,
        });
      } catch (error) {
        return reply.status(500).send({
          error: "Server configuration error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );
};

