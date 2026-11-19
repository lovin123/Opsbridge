import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';
import { z } from 'zod';

const PER_MODEL_TIMEOUT_MS = 20_000;
const OVERALL_TIMEOUT_MS = 35_000;

@Injectable()
export class GroqClient {
  private readonly logger = new Logger(GroqClient.name);
  private client: Groq | null = null;

  constructor(private readonly config: ConfigService) {}

  configured() {
    return Boolean(this.config.get<string>('GROQ_API_KEY')?.trim());
  }

  async generate<T extends z.ZodType>(schema: T, system: string, prompt: string): Promise<z.infer<T>> {
    if (!this.configured()) {
      throw new ServiceUnavailableException('Groq is not configured');
    }

    const primary = this.config.get<string>('GROQ_MODEL') || 'openai/gpt-oss-20b';
    const fallback = (this.config.get<string>('GROQ_FALLBACK_MODEL') || '').trim();
    const models = fallback && fallback !== primary ? [primary, fallback] : [primary];

    try {
      return await withTimeout(
        this.generateAcrossModels(models, schema, system, prompt),
        OVERALL_TIMEOUT_MS,
        'Groq timed out. Please try again in a moment.',
      );
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      const message = errorMessage(error);
      if (isTransientGroqError(error) || /timed out/i.test(message)) {
        throw new ServiceUnavailableException(
          'Groq is temporarily unavailable. Please try again in a moment.',
        );
      }
      throw new ServiceUnavailableException(message.slice(0, 300));
    }
  }

  private async generateAcrossModels<T extends z.ZodType>(
    models: string[],
    schema: T,
    system: string,
    prompt: string,
  ): Promise<z.infer<T>> {
    let lastError: unknown;
    for (let index = 0; index < models.length; index += 1) {
      const model = models[index];
      try {
        return await this.generateWithModel(model, schema, system, prompt);
      } catch (error) {
        lastError = error;
        const next = models[index + 1];
        if (!next || !shouldTryFallbackModel(error)) {
          break;
        }
        this.logger.warn(`Groq model ${model} unavailable; trying fallback ${next}`);
      }
    }

    if (lastError instanceof ServiceUnavailableException) {
      throw lastError;
    }
    const message = errorMessage(lastError);
    if (isTransientGroqError(lastError)) {
      throw new ServiceUnavailableException(
        'Groq is temporarily unavailable. Please try again in a moment.',
      );
    }
    throw new ServiceUnavailableException(message.slice(0, 300));
  }

  private async generateWithModel<T extends z.ZodType>(
    model: string,
    schema: T,
    system: string,
    prompt: string,
  ): Promise<z.infer<T>> {
    if (!this.client) {
      this.client = new Groq({
        apiKey: this.config.getOrThrow<string>('GROQ_API_KEY'),
        timeout: PER_MODEL_TIMEOUT_MS,
        maxRetries: 1,
      });
    }

    const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
    delete jsonSchema.$schema;
    const schemaHint = JSON.stringify(jsonSchema);

    const completion = await withTimeout(
      this.createCompletion(model, system, prompt, schemaHint),
      PER_MODEL_TIMEOUT_MS,
      `Groq model ${model} timed out`,
    );

    const text = completion.choices[0]?.message?.content ?? '';
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ServiceUnavailableException('Groq returned invalid JSON');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ServiceUnavailableException('Groq response failed validation');
    }
    return parsed.data;
  }

  private async createCompletion(model: string, system: string, prompt: string, schemaHint: string) {
    if (!this.client) {
      throw new ServiceUnavailableException('Groq is not configured');
    }
    const messages = [
      {
        role: 'system' as const,
        content: `${system}\n\nRespond with a single JSON object only. It must match this JSON Schema:\n${schemaHint}`,
      },
      { role: 'user' as const, content: prompt },
    ];

    try {
      return await this.client.chat.completions.create({
        model,
        temperature: 0.2,
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'opsbridge_response',
            strict: false,
            schema: JSON.parse(schemaHint) as Record<string, unknown>,
          },
        },
      });
    } catch (error) {
      // Many Groq models only support json_object mode; fall back cleanly.
      if (!supportsJsonObjectFallback(error)) {
        throw error;
      }
      this.logger.warn(`Groq model ${model} rejected json_schema; retrying with json_object`);
      return this.client.chat.completions.create({
        model,
        temperature: 0.2,
        messages,
        response_format: { type: 'json_object' },
      });
    }
  }
}

function supportsJsonObjectFallback(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  const status =
    typeof error === 'object' && error && 'status' in error
      ? Number((error as { status: unknown }).status)
      : NaN;
  return (
    status === 400 ||
    message.includes('json_schema') ||
    message.includes('response_format') ||
    message.includes('not supported')
  );
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {
        // ignore abort failures
      }
      reject(new ServiceUnavailableException(message));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Groq request failed';
}

function isTransientGroqError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  const status =
    typeof error === 'object' && error && 'status' in error
      ? Number((error as { status: unknown }).status)
      : NaN;
  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    message.includes('rate limit') ||
    message.includes('overloaded') ||
    message.includes('unavailable') ||
    message.includes('timed out') ||
    message.includes('timeout')
  );
}

function shouldTryFallbackModel(error: unknown): boolean {
  if (isTransientGroqError(error)) {
    return true;
  }
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes('model_not_found') ||
    message.includes('does not exist') ||
    message.includes('not supported') ||
    message.includes('invalid model')
  );
}
