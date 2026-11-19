import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  configured(): boolean {
    return Boolean(this.config.get<string>('SMTP_HOST')?.trim());
  }

  async send(message: MailMessage): Promise<void> {
    const from = this.config.getOrThrow<string>('MAIL_FROM');
    if (!this.configured()) {
      if (this.config.getOrThrow<string>('NODE_ENV') === 'production') {
        throw new ServiceUnavailableException('Email delivery is not configured');
      }
      this.logger.log(
        `[mail:dev] from=${from} to=${message.to} subject=${message.subject}\n${message.text}`,
      );
      return;
    }

    try {
      const transporter = this.getTransporter();
      await transporter.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html ?? textToHtml(message.text),
      });
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      const detail = error instanceof Error ? error.message : 'Email send failed';
      this.logger.error(`Failed to send mail to ${message.to}: ${detail}`);
      throw new ServiceUnavailableException('Email delivery failed');
    }
  }

  async sendPasswordReset(input: { to: string; name: string; resetUrl: string }): Promise<void> {
    const text = [
      `Hi ${input.name},`,
      '',
      'We received a request to reset your Opsbridge password.',
      `Open this link within the next hour to choose a new password:`,
      input.resetUrl,
      '',
      'If you did not request this, you can ignore this email.',
      '',
      '— Opsbridge',
    ].join('\n');

    await this.send({
      to: input.to,
      subject: 'Reset your Opsbridge password',
      text,
      html: renderEmail({
        preheader: 'Reset your Opsbridge password',
        title: 'Reset your password',
        bodyHtml: `
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
            Hi ${escapeHtml(input.name)},
          </p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
            We received a request to reset your Opsbridge password. Use the button below within the next hour.
          </p>
          ${ctaButton(input.resetUrl, 'Reset password')}
          <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#64748b;">
            If you did not request this, you can ignore this email.
          </p>
        `,
      }),
    });
  }

  async sendInvitation(input: {
    to: string;
    organizationName: string;
    role: string;
    invitedByName: string;
    acceptUrl: string;
  }): Promise<void> {
    const text = [
      `You have been invited to join ${input.organizationName} on Opsbridge as ${input.role}.`,
      `Invited by: ${input.invitedByName}`,
      '',
      'Accept the invitation here (sign in with this email address first if needed):',
      input.acceptUrl,
      '',
      '— Opsbridge',
    ].join('\n');

    await this.send({
      to: input.to,
      subject: `Join ${input.organizationName} on Opsbridge`,
      text,
      html: renderEmail({
        preheader: `Join ${input.organizationName} on Opsbridge`,
        title: 'You’re invited to Opsbridge',
        bodyHtml: `
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
            You’ve been invited to join
            <strong style="color:#0f172a;">${escapeHtml(input.organizationName)}</strong>
            on Opsbridge as
            <strong style="color:#0f172a;">${escapeHtml(input.role)}</strong>.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
            <tr>
              <td style="padding:14px 16px;">
                <p style="margin:0 0 4px;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;font-weight:600;">Invited by</p>
                <p style="margin:0;font-size:15px;color:#0f172a;font-weight:600;">${escapeHtml(input.invitedByName)}</p>
              </td>
            </tr>
          </table>
          ${ctaButton(input.acceptUrl, 'Accept invitation')}
          <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#64748b;">
            Sign in with <strong>${escapeHtml(input.to)}</strong> first if you do not already have an Opsbridge account.
          </p>
        `,
      }),
    });
  }

  async sendNotification(input: {
    to: string;
    name: string;
    title: string;
    body: string;
    actionUrl?: string;
  }): Promise<void> {
    const lines = [`Hi ${input.name},`, '', input.title, input.body];
    if (input.actionUrl) {
      lines.push('', `View in Opsbridge: ${input.actionUrl}`);
    }
    lines.push('', '— Opsbridge');
    const text = lines.join('\n');

    await this.send({
      to: input.to,
      subject: input.title,
      text,
      html: renderEmail({
        preheader: input.title,
        title: input.title,
        bodyHtml: `
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
            Hi ${escapeHtml(input.name)},
          </p>
          <p style="margin:0 0 12px;font-size:16px;line-height:1.5;color:#0f172a;font-weight:600;">
            ${escapeHtml(input.title)}
          </p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
            ${escapeHtml(input.body)}
          </p>
          ${input.actionUrl ? ctaButton(input.actionUrl, 'View in Opsbridge') : ''}
        `,
      }),
    });
  }

  private getTransporter(): Transporter {
    if (this.transporter) {
      return this.transporter;
    }
    const host = this.config.getOrThrow<string>('SMTP_HOST');
    const port = this.config.getOrThrow<number>('SMTP_PORT');
    const user = this.config.get<string>('SMTP_USER')?.trim() || undefined;
    const pass = this.config.get<string>('SMTP_PASS') || undefined;
    const secure = this.config.getOrThrow<boolean>('SMTP_SECURE');

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
    });
    return this.transporter;
  }
}

function ctaButton(href: string, label: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px;">
      <tr>
        <td align="left" bgcolor="#3730a3" style="border-radius:8px;">
          <a href="${escapeHtml(href)}"
             style="display:inline-block;padding:12px 18px;font-size:14px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:8px;background:#3730a3;">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>
  `;
}

function renderEmail(input: { preheader: string; title: string; bodyHtml: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(input.title)}</title>
</head>
<body style="margin:0;padding:0;background:#eef2ff;font-family:Segoe UI,Helvetica Neue,Arial,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${escapeHtml(input.preheader)}
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eef2ff;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:22px 28px;background:linear-gradient(135deg,#07111f 0%,#1e3a8a 100%);">
              <p style="margin:0;font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#ffffff;">Opsbridge</p>
              <p style="margin:6px 0 0;font-size:12px;color:#bfdbfe;">Workforce operations platform</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;color:#0f172a;font-weight:700;">
                ${escapeHtml(input.title)}
              </h1>
              ${input.bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 22px;border-top:1px solid #e2e8f0;background:#f8fafc;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">
                Sent by Opsbridge · Bridge every field team in one workspace.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function textToHtml(text: string): string {
  return renderEmail({
    preheader: text.slice(0, 90),
    title: 'Opsbridge',
    bodyHtml: `<pre style="margin:0;font-family:Segoe UI,Helvetica Neue,Arial,sans-serif;white-space:pre-wrap;font-size:14px;line-height:1.6;color:#334155;">${escapeHtml(text)}</pre>`,
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
