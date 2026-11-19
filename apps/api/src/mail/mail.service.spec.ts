import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { MailService } from './mail.service';

describe('MailService', () => {
  function service(env: Record<string, string | number | boolean>) {
    const config = {
      get: (key: string) => env[key],
      getOrThrow: (key: string) => {
        if (env[key] === undefined) {
          throw new Error(`missing ${key}`);
        }
        return env[key];
      },
    } as unknown as ConfigService;
    return new MailService(config);
  }

  it('reports configured only when SMTP_HOST is set', () => {
    expect(service({ SMTP_HOST: '', NODE_ENV: 'development' }).configured()).toBe(false);
    expect(service({ SMTP_HOST: 'smtp.example.com', NODE_ENV: 'development' }).configured()).toBe(true);
  });

  it('logs mail in non-production when SMTP is unset', async () => {
    const mail = service({
      SMTP_HOST: '',
      NODE_ENV: 'development',
      MAIL_FROM: 'Opsbridge <noreply@Opsbridge.local>',
    });
    await expect(
      mail.send({ to: 'tech@example.com', subject: 'Hello', text: 'Body' }),
    ).resolves.toBeUndefined();
  });

  it('fails closed in production when SMTP is unset', async () => {
    const mail = service({
      SMTP_HOST: '',
      NODE_ENV: 'production',
      MAIL_FROM: 'Opsbridge <noreply@Opsbridge.local>',
    });
    await expect(
      mail.send({ to: 'tech@example.com', subject: 'Hello', text: 'Body' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
