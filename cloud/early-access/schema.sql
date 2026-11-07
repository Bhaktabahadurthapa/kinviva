-- Early Access signups. Minimal personal data on purpose.
CREATE TABLE IF NOT EXISTS signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  email_lower TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  use_case TEXT NOT NULL,
  company TEXT,
  consent_version TEXT NOT NULL,
  consent_at TEXT NOT NULL
);

-- Rate limiting: a salted hash of the client address (never the address itself), counted per hour. Old rows are removed.
CREATE TABLE IF NOT EXISTS rate (
  key TEXT NOT NULL,
  window INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window)
);
