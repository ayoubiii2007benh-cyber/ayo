'use strict';

/* Sends transactional email via the Resend HTTP API -- no SDK dependency,
   same "just fetch it" approach as oauth.js. When RESEND_API_KEY isn't set
   (local dev, CI), the email is logged to the console instead of sent, so
   the whole forgot-password/forgot-username flow is fully exercisable
   without a Resend account. */

const RESEND_API_URL = 'https://api.resend.com/emails';

async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY not set -- logging instead of sending.\n  To: ${to}\n  Subject: ${subject}\n  ---\n${text}\n  ---`);
    return { logged: true };
  }
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error('EMAIL_FROM is not set; cannot send email with RESEND_API_KEY configured.');
  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend send failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

function emailShell(baseUrl, bodyHtml) {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F4ECE7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4ECE7;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:440px;background:#ffffff;border-radius:24px;overflow:hidden;">
        <tr><td style="padding:32px 32px 8px;text-align:center;">
          <img src="${baseUrl}/favicon/icon-192.png" width="48" height="48" alt="Pomodoro" style="border-radius:12px;display:inline-block;">
        </tr></td>
        <tr><td style="padding:8px 32px 32px;color:#1A1310;">
          ${bodyHtml}
        </td></tr>
      </table>
      <p style="color:#8a7a72;font-size:12px;margin-top:20px;">Pomodoro &middot; ${baseUrl.replace(/^https?:\/\//, '')}</p>
    </td></tr>
  </table>
</body>
</html>`;
}

function resetCodeEmail(baseUrl, code) {
  const html = emailShell(baseUrl, `
    <h1 style="font-size:20px;margin:0 0 12px;">Your reset code</h1>
    <p style="font-size:14px;line-height:1.5;color:#5B4C46;margin:0 0 24px;">Use this code to reset your Pomodoro password. If you didn't request this, you can safely ignore this email.</p>
    <div style="background:#F4ECE7;border-radius:16px;padding:20px;text-align:center;margin:0 0 20px;">
      <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#D9361A;font-variant-numeric:tabular-nums;">${code}</span>
    </div>
    <p style="font-size:13px;color:#8a7a72;margin:0;">Expires in 10 minutes.</p>
    <p style="font-size:13px;color:#8a7a72;margin:12px 0 0;">If you didn't request this, ignore this email.</p>
  `);
  const text = `Your Pomodoro reset code: ${code}\n\nExpires in 10 minutes.\n\nIf you didn't request this, ignore this email.`;
  return { subject: 'Your Pomodoro reset code', html, text };
}

function usernameEmail(baseUrl, username) {
  const html = emailShell(baseUrl, `
    <h1 style="font-size:20px;margin:0 0 12px;">Your username</h1>
    <p style="font-size:14px;line-height:1.5;color:#5B4C46;margin:0 0 24px;">Here's the username for your Pomodoro account:</p>
    <div style="background:#F4ECE7;border-radius:16px;padding:20px;text-align:center;margin:0 0 20px;">
      <span style="font-size:24px;font-weight:700;color:#1A1310;">${username}</span>
    </div>
    <p style="font-size:13px;color:#8a7a72;margin:0;">If you didn't request this, ignore this email.</p>
  `);
  const text = `Your Pomodoro username: ${username}\n\nIf you didn't request this, ignore this email.`;
  return { subject: 'Your Pomodoro username', html, text };
}

module.exports = { sendEmail, resetCodeEmail, usernameEmail };
