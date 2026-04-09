import type { FastifyPluginAsync } from "fastify";

import { env } from "../config/env";
import { COOKIE_KEYS } from "../constants/auth";

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/api/auth",
    {
      schema: {
        tags: ["Auth"],
        summary: "Authenticate user with access password",
        body: {
          type: "object",
          required: ["password"],
          properties: {
            password: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              message: { type: "string" },
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
              success: { type: "boolean" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const body = request.body as { password?: string };

        if (!body?.password) {
          return reply.status(400).send({ error: "Password is required" });
        }

        if (body.password !== env.ACCESS_PASSWORD) {
          return reply.status(401).send({ success: false, message: "Invalid password" });
        }

        const maxAge = env.NEXT_PUBLIC_SESSION_EXPIRE_S;
        const storageData = {
          authenticated: true,
          expiresAt: Date.now() + maxAge * 1000,
        };

        reply.setCookie(COOKIE_KEYS.AUTH, JSON.stringify(storageData), {
          httpOnly: true,
          secure: env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge,
          path: "/",
        });

        return reply.send({ success: true, message: "Access granted" });
      } catch {
        return reply.status(400).send({ error: "Invalid request body" });
      }
    },
  );

  app.get(
    "/api/auth/check",
    {
      schema: {
        tags: ["Auth"],
        summary: "Check current auth state from cookie",
        response: {
          200: {
            type: "object",
            properties: {
              authenticated: { type: "boolean" },
              expiresAt: { type: "number" },
            },
          },
          401: {
            type: "object",
            properties: {
              authenticated: { type: "boolean" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const authCookie = request.cookies[COOKIE_KEYS.AUTH];

      if (!authCookie) {
        return reply.status(401).send({ authenticated: false });
      }

      try {
        return reply.send(JSON.parse(authCookie));
      } catch {
        return reply.status(401).send({ authenticated: false });
      }
    },
  );
};

