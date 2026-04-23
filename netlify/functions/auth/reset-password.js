const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { supabase } = require('../utils/supabase');

const getPasswordResetSecret = () => process.env.JWT_SECRET || 'change-me';
const getPasswordResetTokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

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
    const { token: rawToken, password } = JSON.parse(event.body || '{}');
    const token = String(rawToken || '').trim();
    const normalizedPassword = String(password || '');

    if (!token || !normalizedPassword) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Reset token and new password are required.' }) };
    }

    if (normalizedPassword.length < 8) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Password must be at least 8 characters long.' }) };
    }

    const tokenHash = getPasswordResetTokenHash(token);
    let decodedToken;

    try {
      decodedToken = jwt.verify(token, getPasswordResetSecret());
    } catch (error) {
      if (error?.name === 'TokenExpiredError') {
        return { statusCode: 400, body: JSON.stringify({ error: 'This password reset link has expired.' }) };
      }

      return { statusCode: 400, body: JSON.stringify({ error: 'This password reset link is invalid.' }) };
    }

    if (decodedToken.type !== 'password_reset' || !decodedToken.jti || !decodedToken.sub) {
      return { statusCode: 400, body: JSON.stringify({ error: 'This password reset link is invalid.' }) };
    }

    const { data: resetToken, error: resetTokenError } = await supabase
      .from('password_reset_tokens')
      .select('id, user_id, token_hash, expires_at, used_at, invalidated_at, invalidation_reason')
      .eq('id', String(decodedToken.jti))
      .maybeSingle();

    if (resetTokenError) {
      return { statusCode: 400, body: JSON.stringify({ error: resetTokenError.message || 'Invalid password reset token.' }) };
    }

    if (!resetToken) {
      return { statusCode: 400, body: JSON.stringify({ error: 'This password reset link is invalid.' }) };
    }

    if (resetToken.user_id !== String(decodedToken.sub) || resetToken.token_hash !== tokenHash) {
      return { statusCode: 400, body: JSON.stringify({ error: 'This password reset link is invalid.' }) };
    }

    if (resetToken.invalidated_at && resetToken.invalidation_reason === 'superseded') {
      return { statusCode: 400, body: JSON.stringify({ error: 'A newer password reset link was already requested. Please use the latest email.' }) };
    }

    if (resetToken.used_at) {
      return { statusCode: 400, body: JSON.stringify({ error: 'This password reset link was already used.' }) };
    }

    if (new Date(resetToken.expires_at).getTime() < Date.now()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'This password reset link has expired.' }) };
    }

    const passwordHash = await bcrypt.hash(normalizedPassword, 10);

    const { error: updateUserError } = await supabase
      .from('users')
      .update({
        password_hash: passwordHash,
        updated_at: new Date().toISOString()
      })
      .eq('id', resetToken.user_id);

    if (updateUserError) {
      return { statusCode: 400, body: JSON.stringify({ error: updateUserError.message || 'Failed to reset password.' }) };
    }

    await supabase
      .from('password_reset_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', resetToken.id);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Password reset successful. You can now sign in with your new password.' })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Internal server error' })
    };
  }
};
