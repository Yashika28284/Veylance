CREATE TABLE user_identity_profiles (
  sub TEXT PRIMARY KEY REFERENCES users(sub) ON DELETE CASCADE,
  email TEXT,
  email_normalized TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1))
);
CREATE INDEX user_identity_profiles_email_lookup
  ON user_identity_profiles(email_normalized, email_verified);
