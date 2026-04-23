const crypto = require('crypto');
const { supabase } = require('../utils/supabase');
const { sendEmail } = require('../utils/email');

const PASSWORD_RESET_TOKEN_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES || 30);
const PASSWORD_RESET_RESEND_COOLDOWN_SECONDS = Number(process.env.PASSWORD_RESET_RESEND_COOLDOWN_SECONDS || 60);
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const getAppUrl = (origin) => {
  const explicitUrl = String(process.env.APP_URL || process.env.PUBLIC_APP_URL || '').trim();
  const fallbackUrl = origin && /^https?:\/\//i.test(origin) ? origin : 'http://localhost:5173';
  return (explicitUrl || fallbackUrl).replace(/\/+$/, '');
};
const buildResetPasswordEmail = (name, resetUrl) => {
  const greetingName = name || 'there';

  return {
    text: `Hello ${greetingName},\n\nWe received a request to reset your Madison88 password.\n\nUse this link to create a new password:\n${resetUrl}\n\nThis link expires in ${PASSWORD_RESET_TOKEN_TTL_MINUTES} minutes.\nIf you did not request this, you can ignore this email.`,
    html: `
      <div style="margin:0;padding:32px 16px;background:#eef3fb;font-family:Segoe UI,Arial,sans-serif;color:#13213d;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #d9e1f1;">
          <div style="padding:32px;background:linear-gradient(135deg,#1e2b4a 0%,#2d416d 100%);text-align:center;">
            <img src="https://hjjpqwzmrnjquneuppeb.supabase.co/storage/v1/object/public/public-assets/madison88-logo.png" alt="Madison88" style="max-width:180px;height:auto;background:#f8fbff;padding:12px 18px;border-radius:18px;" />
            <h1 style="margin:24px 0 0;font-size:28px;line-height:1.2;color:#ffffff;">Reset Your Password</h1>
          </div>
          <div style="padding:32px;">
            <p style="margin:0 0 16px;font-size:16px;line-height:1.7;">Hello ${greetingName},</p>
            <p style="margin:0 0 16px;font-size:16px;line-height:1.7;">We received a request to reset your Madison88 Budget Management System password.</p>
            <p style="margin:0 0 28px;font-size:16px;line-height:1.7;">Click the button below to open the system and choose a new password.</p>
            <div style="text-align:center;margin:0 0 28px;">
              <a href="${resetUrl}" style="display:inline-block;background:#38558c;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 28px;border-radius:14px;">Reset Password</a>
            </div>
            <div style="margin:0 0 24px;padding:16px 18px;background:#f6f8fc;border:1px solid #d9e1f1;border-radius:16px;">
              <p style="margin:0 0 8px;font-size:14px;color:#4b5b7c;">If the button does not work, copy and open this link:</p>
              <p style="margin:0;word-break:break-all;font-size:14px;"><a href="${resetUrl}" style="color:#38558c;">${resetUrl}</a></p>
            </div>
            <p style="margin:0 0 10px;font-size:14px;line-height:1.7;color:#5f6f90;">This link expires in ${PASSWORD_RESET_TOKEN_TTL_MINUTES} minutes.</p>
            <p style="margin:0;font-size:14px;line-height:1.7;color:#5f6f90;">If you did not request this, you can safely ignore this email.</p>
          </div>
        </div>
      </div>
    `
  };
};
const getPasswordResetSecret = () => process.env.JWT_SECRET || 'change-me';
const getPasswordResetExpirySeconds = (expiresAt) => Math.floor(new Date(expiresAt).getTime() / 1000);
const buildPasswordResetToken = (resetToken) =>
  require('jsonwebtoken').sign(
    {
      sub: resetToken.user_id,
      jti: resetToken.id,
      type: 'password_reset',
      exp: getPasswordResetExpirySeconds(resetToken.expires_at)
    },
    getPasswordResetSecret(),
    {
      algorithm: 'HS256',
      noTimestamp: true
    }
  );
const getPasswordResetTokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const getPasswordResetCooldownMessage = () => 'A reset link was already sent recently. Please check your latest email.';
const getPasswordResetSentMessage = () => 'If the email is registered, a password reset link has been sent.';
const getActiveResetTokenForUser = async (userId) => {
  const { data, error } = await supabase
    .from('password_reset_tokens')
    .select('id, user_id, token_hash, expires_at, last_sent_at, used_at, invalidated_at, invalidation_reason, created_at')
    .eq('user_id', userId)
    .is('used_at', null)
    .is('invalidated_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  return {
    data: data?.[0] || null,
    error
  };
};
const wasPasswordResetLinkSentRecently = (lastSentAt) => {
  if (!lastSentAt) return false;
  return Date.now() - new Date(lastSentAt).getTime() < PASSWORD_RESET_RESEND_COOLDOWN_SECONDS * 1000;
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { email: rawEmail } = JSON.parse(event.body || '{}');
    const email = normalizeEmail(rawEmail);

    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Email is required.' }) };
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, email')
      .eq('email', email)
      .maybeSingle();

    if (error) {
      return { statusCode: 400, body: JSON.stringify({ error: error.message || 'Unable to process password reset.' }) };
    }

    if (!user) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: getPasswordResetSentMessage() })
      };
    }
    const { data: activeResetToken, error: activeResetTokenError } = await getActiveResetTokenForUser(user.id);

    if (activeResetTokenError) {
      return { statusCode: 400, body: JSON.stringify({ error: activeResetTokenError.message || 'Unable to process password reset.' }) };
    }

    if (activeResetToken) {
      if (wasPasswordResetLinkSentRecently(activeResetToken.last_sent_at)) {
        return { statusCode: 200, body: JSON.stringify({ message: getPasswordResetCooldownMessage() }) };
      }

      const rawToken = buildPasswordResetToken(activeResetToken);
      const origin = event.headers.origin || event.headers.Origin;
      const resetUrl = `${getAppUrl(origin)}/reset-password?token=${rawToken}`;
      const emailContent = buildResetPasswordEmail(user.name || 'there', resetUrl);

      await sendEmail(
        user.email,
        'Reset your Madison88 password',
        emailContent.text,
        emailContent.html
      );

      await supabase
        .from('password_reset_tokens')
        .update({ last_sent_at: new Date().toISOString() })
        .eq('id', activeResetToken.id);

      return {
        statusCode: 200,
        body: JSON.stringify({ message: getPasswordResetSentMessage() })
      };
    }

    await supabase
      .from('password_reset_tokens')
      .update({
        invalidated_at: new Date().toISOString(),
        invalidation_reason: 'superseded'
      })
      .eq('user_id', user.id)
      .is('used_at', null)
      .is('invalidated_at', null);

    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();
    const { data: createdResetToken, error: insertError } = await supabase
      .from('password_reset_tokens')
      .insert({
        user_id: user.id,
        token_hash: 'pending',
        expires_at: expiresAt,
        last_sent_at: new Date().toISOString()
      })
      .select('id, user_id, expires_at')
      .single();

    if (insertError || !createdResetToken) {
      return { statusCode: 400, body: JSON.stringify({ error: insertError?.message || 'Unable to create password reset token.' }) };
    }

    const rawToken = buildPasswordResetToken(createdResetToken);
    const tokenHash = getPasswordResetTokenHash(rawToken);
    const { error: updateResetTokenError } = await supabase
      .from('password_reset_tokens')
      .update({ token_hash: tokenHash })
      .eq('id', createdResetToken.id);

    if (updateResetTokenError) {
      return { statusCode: 400, body: JSON.stringify({ error: updateResetTokenError.message || 'Unable to finalize password reset token.' }) };
    }

    const origin = event.headers.origin || event.headers.Origin;
    const resetUrl = `${getAppUrl(origin)}/reset-password?token=${rawToken}`;
    const emailContent = buildResetPasswordEmail(user.name || 'there', resetUrl);

    await sendEmail(
      user.email,
      'Reset your Madison88 password',
      emailContent.text,
      emailContent.html
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ message: getPasswordResetSentMessage() })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Internal server error' })
    };
  }
};
