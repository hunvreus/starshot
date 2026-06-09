CREATE TABLE IF NOT EXISTS "user" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  expiresAt TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt TEXT,
  refreshTokenExpiresAt TEXT,
  scope TEXT,
  password TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS github_users (
  id INTEGER PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  avatar_url TEXT,
  name TEXT,
  company TEXT,
  location TEXT,
  email TEXT,
  bio TEXT,
  twitter_username TEXT,
  followers_count INTEGER,
  following_count INTEGER,
  public_repos INTEGER,
  public_gists INTEGER,
  blog TEXT,
  hireable INTEGER,
  created_at TEXT,
  updated_at TEXT,
  normalized_location TEXT,
  country TEXT,
  country_code TEXT,
  latitude REAL,
  longitude REAL,
  geocoded_at TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS github_repos (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL UNIQUE,
  description TEXT,
  private INTEGER NOT NULL DEFAULT 0,
  stargazers_count INTEGER NOT NULL DEFAULT 0,
  owner_login TEXT,
  owner_avatar_url TEXT,
  html_url TEXT,
  homepage TEXT,
  language TEXT,
  forks_count INTEGER,
  open_issues_count INTEGER,
  created_at TEXT,
  updated_at TEXT,
  pushed_at TEXT,
  latest_commit_sha TEXT,
  latest_commit_url TEXT,
  latest_commit_message TEXT,
  latest_commit_author_login TEXT,
  latest_commit_author_avatar_url TEXT,
  latest_commit_author_url TEXT,
  latest_commit_author_name TEXT,
  latest_commit_at TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN ('repo_stargazers', 'user_followers')),
  value TEXT NOT NULL,
  label TEXT NOT NULL,
  github_repo_id INTEGER REFERENCES github_repos(id),
  github_user_id INTEGER REFERENCES github_users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(kind, value)
);

CREATE TABLE IF NOT EXISTS user_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, source_id)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'smart' CHECK(mode IN ('smart', 'full', 'profiles', 'clear')),
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'success', 'error')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT,
  scanned_count INTEGER NOT NULL DEFAULT 0,
  active_count INTEGER NOT NULL DEFAULT 0,
  removed_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS source_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  github_user_id INTEGER NOT NULL REFERENCES github_users(id) ON DELETE CASCADE,
  starred_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  removed_at TEXT,
  last_run_id INTEGER NOT NULL REFERENCES sync_runs(id),
  UNIQUE(source_id, github_user_id)
);

CREATE INDEX IF NOT EXISTS user_sources_user_idx ON user_sources(user_id);
CREATE INDEX IF NOT EXISTS source_memberships_source_active_idx ON source_memberships(source_id, removed_at);
CREATE INDEX IF NOT EXISTS source_memberships_last_run_idx ON source_memberships(last_run_id);
CREATE INDEX IF NOT EXISTS github_users_login_idx ON github_users(login);
CREATE INDEX IF NOT EXISTS github_users_country_idx ON github_users(country);

CREATE VIRTUAL TABLE IF NOT EXISTS github_users_fts USING fts5(
  login,
  name,
  company,
  location,
  email,
  bio,
  content='github_users',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS github_users_ai AFTER INSERT ON github_users BEGIN
  INSERT INTO github_users_fts(rowid, login, name, company, location, email, bio)
  VALUES (new.id, new.login, new.name, new.company, new.location, new.email, new.bio);
END;

CREATE TRIGGER IF NOT EXISTS github_users_ad AFTER DELETE ON github_users BEGIN
  INSERT INTO github_users_fts(github_users_fts, rowid, login, name, company, location, email, bio)
  VALUES ('delete', old.id, old.login, old.name, old.company, old.location, old.email, old.bio);
END;

CREATE TRIGGER IF NOT EXISTS github_users_au AFTER UPDATE ON github_users BEGIN
  INSERT INTO github_users_fts(github_users_fts, rowid, login, name, company, location, email, bio)
  VALUES ('delete', old.id, old.login, old.name, old.company, old.location, old.email, old.bio);
  INSERT INTO github_users_fts(rowid, login, name, company, location, email, bio)
  VALUES (new.id, new.login, new.name, new.company, new.location, new.email, new.bio);
END;
