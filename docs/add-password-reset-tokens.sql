CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  last_sent_at TIMESTAMP DEFAULT NOW(),
  used_at TIMESTAMP,
  invalidated_at TIMESTAMP,
  invalidation_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE password_reset_tokens
ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMP DEFAULT NOW();

ALTER TABLE password_reset_tokens
ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMP;

ALTER TABLE password_reset_tokens
ADD COLUMN IF NOT EXISTS invalidation_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
ON password_reset_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_active_lookup
ON password_reset_tokens(user_id, expires_at);
