# code-polish-be

To install dependencies:

```bash
bun install
```

Required environment variables:

```bash
ACCESS_PASSWORD=your-password
NEXT_PUBLIC_SESSION_EXPIRE_S=600
GEMINI_API_KEY=your-gemini-key
HUGGINGFACE_API_KEY=your-huggingface-key
PROMPTS_DIR=../code-polish/lib/prompts
GENERATED_IMAGES_DIR=./src/assets/generated-images
MAX_ROUNDS_PER_REQUEST=2
MAX_DYNAMIC_AGENTS=4
MAX_GOOGLE_CALLS_PER_REQUEST=12
MAX_IMAGE_CALLS_PER_REQUEST=1
```

To run:

```bash
bun run start
```

To run in dev watch mode:

```bash
bun run dev
```

Swagger/OpenAPI JSON documentation:

```bash
GET /openapi.json
```

Swagger UI:

```bash
GET /docs
```

Main APIs:

```bash
POST /api/auth
GET /api/auth/check
POST /api/agents/run
POST /api/refine
POST /api/refine/stream
```

Multi-agent API input:

```json
{
  "query": "refine this function for performance",
  "action": "REFINE"
}
```

`maxRounds` and image generation are now decided internally by the CTO planner agent based on query complexity and intent.
Agents execute in parallel per round using a shared-memory snapshot, then merge results before CTO review.
Image generation is done once after agent discussion, using the refined prompt context.
Image backend routing: simple prompts use Google image model, more complex prompts can use Hugging Face `Tongyi-MAI/Z-Image-Turbo` when `HUGGINGFACE_API_KEY` is configured.

This project was created using `bun init` in bun v1.3.11. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
