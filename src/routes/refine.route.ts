import type { FastifyPluginAsync } from "fastify";

import { FEATURES, normalizeFeature } from "../data/features";
import { COOKIE_KEYS } from "../constants/auth";
import { MODEL_ID, ai, buildGeminiConfig, parseGeminiResponse } from "../services/gemini.service";
import { runRefineFlow } from "../services/refine.service";

type RefineRequestBody = {
  code?: string;
  mode?: string;
  context?: string;
};

export const refineRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/api/refine",
    {
      schema: {
        tags: ["Refine"],
        summary: "Run one-shot refinement API",
        body: {
          type: "object",
          required: ["code", "mode"],
          properties: {
            code: { type: "string" },
            mode: { type: "string", enum: Object.values(FEATURES) },
            context: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const authCookie = request.cookies[COOKIE_KEYS.AUTH];
      if (!authCookie) {
        return reply.status(401).send({ error: "Access denied. Please log in." });
      }

      const body = request.body as RefineRequestBody;
      if (!body.code || !body.mode) {
        return reply.status(400).send({ error: "Missing required fields: 'code' and 'mode'" });
      }

      const mode = normalizeFeature(body.mode);
      if (!mode) {
        return reply.status(400).send({ error: "Invalid mode. Must be 'refine', 'rename', or 'prompt'" });
      }

      const result = await runRefineFlow({ code: body.code, mode, context: body.context });
      return reply.send({ ...result, mode });
    },
  );

  app.post(
    "/api/refine/stream",
    {
      schema: {
        tags: ["Refine"],
        summary: "Run streaming refinement API (SSE)",
        body: {
          type: "object",
          required: ["code", "mode"],
          properties: {
            code: { type: "string" },
            mode: { type: "string", enum: Object.values(FEATURES) },
            context: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const authCookie = request.cookies[COOKIE_KEYS.AUTH];
      if (!authCookie) {
        return reply.status(401).send({ error: "Access denied. Please log in." });
      }

      const body = request.body as RefineRequestBody;
      if (!body.code || !body.mode) {
        return reply.status(400).send({ error: "Missing required fields: 'code' and 'mode'" });
      }

      const mode = normalizeFeature(body.mode);
      if (!mode) {
        return reply.status(400).send({ error: "Invalid mode. Must be 'refine', 'rename', or 'prompt'" });
      }

      const initialPrompt = body.context ? `Context: ${body.context}\n\nCode:\n${body.code}` : `Code:\n${body.code}`;
      const chat = ai.chats.create({ model: MODEL_ID, config: buildGeminiConfig(mode) });

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      let accumulatedText = "";
      let sentLength = 0;
      let currentPrompt = initialPrompt;
      let done = false;

      while (!done) {
        const stream = await chat.sendMessageStream({ message: currentPrompt });
        let finishReason: string | undefined;

        for await (const chunk of stream) {
          const chunkText = chunk.text ?? "";
          if (chunk.candidates?.[0]?.finishReason) {
            finishReason = chunk.candidates[0].finishReason;
          }
          if (!chunkText) continue;
          accumulatedText += chunkText;

          const resultMatch = accumulatedText.match(/"result"\s*:\s*"((?:[^"\\]|\\.)*)/);
          if (!resultMatch) continue;

          try {
            const parsedString = JSON.parse(`"${resultMatch[1]}"`) as string;
            const newText = parsedString.slice(sentLength);
            if (!newText) continue;
            sentLength = parsedString.length;
            reply.raw.write(`event: chunk\ndata: ${JSON.stringify({ text: newText })}\n\n`);
          } catch {
            // partial escape sequence, keep accumulating
          }
        }

        if (finishReason === "MAX_TOKENS") {
          currentPrompt =
            "Continue exactly where you left off. Do not repeat any prior text, only provide the continuation.";
          continue;
        }
        done = true;
      }

      const parsed = parseGeminiResponse(accumulatedText);
      reply.raw.write(
        `event: meta\ndata: ${JSON.stringify({
          description: parsed.description,
          confidence: parsed.confidence,
          mode,
        })}\n\n`,
      );
      reply.raw.write(`event: result\ndata: ${JSON.stringify({ result: parsed.result })}\n\n`);
      reply.raw.write(`event: done\ndata: ${JSON.stringify({ done: true })}\n\n`);
      reply.raw.end();
      return reply;
    },
  );
};

