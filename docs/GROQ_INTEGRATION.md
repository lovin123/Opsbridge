# Groq integration

All Opsbridge AI calls run on the API with `groq-sdk`. The browser never sees `GROQ_API_KEY`.

## Configuration

```
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-20b
GROQ_FALLBACK_MODEL=openai/gpt-oss-120b
```

Defaults target Groq’s free plan. Llama 3.1/3.3 IDs are enterprise-only now. Missing `GROQ_API_KEY` fails closed as HTTP 503 for AI routes. Incident CRUD still works; context refresh records a `FAILED` snapshot instead of blocking.

## Behavior

`GroqClient.generate(schema, system, prompt)`:

1. Calls Groq chat completions with structured JSON (`json_schema`, `strict: false`)
2. Falls back to `json_object` when the model rejects schema mode
3. Validates the response with Zod
4. Retries briefly, then tries `GROQ_FALLBACK_MODEL` on transient / model errors
5. Enforces per-model and overall timeouts so interactive actions do not hang

## Used by

- `POST /api/v1/ai/classify`
- Incident context refresh / intelligence / assistant
- Shift handover drafts (`POST /api/v1/handovers`)
