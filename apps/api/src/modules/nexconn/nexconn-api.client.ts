import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { newNonce, nexconnSignature } from './signature';

interface NexconnResponse {
  code: number;
  msg?: string;
  result?: { accessToken?: string; userId?: string };
}

@Injectable()
export class NexconnApiClient {
  constructor(private readonly config: ConfigService) {}

  configured(): boolean {
    return Boolean(this.config.get<string>('NEXCONN_APP_KEY') && this.config.get<string>('NEXCONN_APP_SECRET'));
  }

  async issueToken(userId: string, name: string): Promise<string> {
    const body = await this.postWithRetry<NexconnResponse>('/v4/auth/access-token/issue', {
      userId,
      name: name.slice(0, 64),
    });
    const token = body.result?.accessToken;
    if (body.code !== 0 || !token) {
      throw new ServiceUnavailableException(body.msg || 'Nexconn did not issue a token');
    }
    return token;
  }

  async createGroup(input: { channelId: string; name: string; owner: string; userIds: string[] }) {
    return this.postWithRetry<NexconnResponse>('/v4/group-channel/create', {
      channelId: input.channelId,
      name: input.name.slice(0, 64),
      owner: input.owner,
      userIds: input.userIds.slice(0, 30),
    });
  }

  async joinGroup(channelId: string, userIds: string[]) {
    return this.postWithRetry<NexconnResponse>('/v4/group-channel/join', {
      channelId,
      userIds: userIds.slice(0, 100),
    });
  }

  private async postWithRetry<T>(path: string, body: unknown, attempts = 3): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.post<T>(path, body);
      } catch (error) {
        lastError = error;
        if (attempt === attempts || !isTransientNexconnError(error)) {
          break;
        }
        await sleep(300 * attempt);
      }
    }
    if (lastError instanceof ServiceUnavailableException) {
      throw lastError;
    }
    const message = lastError instanceof Error ? lastError.message : 'Nexconn request failed';
    throw new ServiceUnavailableException(message.slice(0, 300));
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    if (!this.configured()) {
      throw new ServiceUnavailableException('Nexconn is not configured');
    }
    const appKey = this.config.getOrThrow<string>('NEXCONN_APP_KEY');
    const secret = this.config.getOrThrow<string>('NEXCONN_APP_SECRET');
    const base = this.config.getOrThrow<string>('NEXCONN_API_BASE_URL').replace(/\/$/, '');
    const nonce = newNonce();
    const timestamp = String(Date.now());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'App-Key': appKey,
          Nonce: nonce,
          Timestamp: timestamp,
          Signature: nexconnSignature(secret, nonce, timestamp),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => null)) as T | null;
      if (!response.ok) {
        // Nexconn often returns business errors (already exists, etc.) as HTTP 4xx with a code/msg body.
        if (payload && typeof payload === 'object') {
          return payload;
        }
        if (response.status >= 500 || response.status === 408 || response.status === 429) {
          throw new ServiceUnavailableException(`Nexconn returned HTTP ${response.status}`);
        }
        throw new ServiceUnavailableException(`Nexconn returned HTTP ${response.status}`);
      }
      return (payload ?? ({} as T)) as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ServiceUnavailableException('Nexconn request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function isTransientNexconnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('enotfound') ||
    message.includes('http 408') ||
    message.includes('http 429') ||
    message.includes('http 500') ||
    message.includes('http 502') ||
    message.includes('http 503') ||
    message.includes('http 504')
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
