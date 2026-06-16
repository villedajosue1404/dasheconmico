const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const bcrypt = require('bcryptjs');

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS businesses (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT,
        color TEXT DEFAULT '#7c6dfa',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
        type TEXT CHECK(type IN ('income','expense')) NOT NULL,
        amount NUMERIC(12,2) NOT NULL,
        description TEXT,
        category TEXT,
        date DATE DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        business_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
        network TEXT CHECK(network IN ('fb','tg')) NOT NULL,
        content TEXT NOT NULL,
        status TEXT CHECK(status IN ('draft','scheduled','published','failed')) DEFAULT 'draft',
        scheduled_at TIMESTAMPTZ,
        published_at TIMESTAMPTZ,
        reach INTEGER DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS scheduled_posts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        photo_url TEXT,
        networks TEXT NOT NULL DEFAULT 'tg',
        days TEXT NOT NULL DEFAULT 'mon,tue,wed,thu,fri,sat,sun',
        times TEXT NOT NULL,
        business_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
        active BOOLEAN DEFAULT TRUE,
        created_by TEXT,
        last_sent TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS memory (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        scope TEXT NOT NULL DEFAULT 'user' CHECK(scope IN ('user','global')),
        type TEXT NOT NULL DEFAULT 'qa' CHECK(type IN ('qa','pattern','correction','improvement')),
        keywords TEXT[] DEFAULT '{}',
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        feedback TEXT,
        hit_count INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_memory_user ON memory(user_id);
      CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory(scope);
    `);

    // Migraciones para tablas existentes sin user_id
    const tables = ['businesses', 'transactions', 'posts', 'scheduled_posts'];
    for (const t of tables) {
      await client.query(`
        ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
      `);
    }

    // Seed: crear admin por defecto si no existe
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@centromando.app';
    const adminPass  = process.env.ADMIN_PASSWORD || 'admin123';
    const existing   = await client.query('SELECT id FROM users WHERE email=$1', [adminEmail]);
    if (!existing.rows.length) {
      const hash = await bcrypt.hash(adminPass, 10);
      const r    = await client.query(
        'INSERT INTO users(name,email,password) VALUES($1,$2,$3) RETURNING id',
        ['Admin', adminEmail, hash]
      );
      const adminId = r.rows[0].id;
      // Asignar datos existentes al admin
      for (const t of tables) {
        await client.query(`UPDATE ${t} SET user_id=$1 WHERE user_id IS NULL`, [adminId]);
      }
      console.log('Admin creado: ' + adminEmail);
    }

    console.log('Base de datos inicializada');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
