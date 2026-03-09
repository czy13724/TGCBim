-- schema.sql
-- Cloudflare D1 Database Schema for TgContactBot

-- Drop tables if they exist (for clean migrations/resets)
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS valid_usernames;
DROP TABLE IF EXISTS message_logs;
DROP TABLE IF EXISTS message_mappings;
DROP TABLE IF EXISTS topics;
DROP TABLE IF EXISTS user_states;
DROP TABLE IF EXISTS counters;
DROP TABLE IF EXISTS blocks;
DROP TABLE IF EXISTS verifications;
DROP TABLE IF EXISTS whitelists;
DROP TABLE IF EXISTS spam_keywords;
DROP TABLE IF EXISTS templates;
DROP TABLE IF EXISTS admin_audit_logs;

-- Users table
CREATE TABLE users (
    user_id TEXT PRIMARY KEY,
    first_name TEXT,
    last_name TEXT,
    username TEXT,
    message_thread_id INTEGER,
    message_count INTEGER DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER,
    last_activity INTEGER,
    language_code TEXT,
    pref_lang TEXT,
    last_msg_time INTEGER DEFAULT 0
);

CREATE INDEX idx_users_username ON users(username);

-- Message logs
CREATE TABLE message_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    date_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    direction TEXT NOT NULL, -- 'u2a' or 'a2u'
    message_id INTEGER,
    type TEXT,
    text TEXT,
    caption TEXT,
    file_id TEXT,
    file_unique_id TEXT,
    file_name TEXT,
    mime_type TEXT,
    file_size INTEGER,
    width INTEGER,
    height INTEGER,
    duration INTEGER,
    performer TEXT,
    title TEXT,
    emoji TEXT,
    set_name TEXT,
    is_animated BOOLEAN,
    is_video BOOLEAN,
    length INTEGER
);

CREATE INDEX idx_logs_user_date ON message_logs(user_id, date_key);
CREATE INDEX idx_logs_created_at ON message_logs(created_at);

-- Message ID Mappings (u2a and a2u)
CREATE TABLE message_mappings (
    mapping_key TEXT PRIMARY KEY, -- e.g., 'u2a:12345'
    target_id INTEGER NOT NULL
);

-- Topics
CREATE TABLE topics (
    thread_id INTEGER PRIMARY KEY,
    status TEXT NOT NULL, -- 'opened', 'closed', 'auto_closed'
    created_at INTEGER NOT NULL,
    updated_at INTEGER,
    created_by_user TEXT,
    reason TEXT,
    closed_at INTEGER,
    inactive_hours INTEGER
);

-- User Verification/Captcha States
CREATE TABLE user_states (
    user_id TEXT NOT NULL,
    state_key TEXT NOT NULL,
    state_value TEXT NOT NULL, -- JSON string
    PRIMARY KEY (user_id, state_key)
);

-- Global Counters & Metrics
CREATE TABLE counters (
    key TEXT PRIMARY KEY,
    value INTEGER DEFAULT 0
);

-- Blocked Users
CREATE TABLE blocks (
    user_id TEXT PRIMARY KEY,
    is_blocked BOOLEAN DEFAULT 1
);

-- Verified Users (Anti-Spam Passes)
CREATE TABLE verifications (
    user_id TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
);

-- User Whitelist
CREATE TABLE whitelists (
    user_id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
);

-- Admin Reply Templates
CREATE TABLE templates (
    key_name TEXT PRIMARY KEY,
    content TEXT NOT NULL
);

-- Admin audit logs
CREATE TABLE admin_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_id TEXT,
    chat_id TEXT,
    thread_id TEXT,
    success INTEGER NOT NULL DEFAULT 1,
    detail TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_admin_audit_created_at ON admin_audit_logs(created_at);
CREATE INDEX idx_admin_audit_admin_action ON admin_audit_logs(admin_id, action);

-- Spam keywords and remote whitelist cache (single rows)
CREATE TABLE system_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL -- JSON string
);
