import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('./bot.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    guild_id TEXT PRIMARY KEY,
    verify_channel TEXT,
    verified_role TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS embeds (
    guild_id TEXT,
    embed_id TEXT PRIMARY KEY,
    title TEXT,
    description TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS verifications (
    random TEXT PRIMARY KEY,
    user_id TEXT,
    hashed_username TEXT,
    guild_id TEXT,
    image_path TEXT,
    image_name TEXT,
    status TEXT DEFAULT 'pending'
  )`);
});

export default db;
