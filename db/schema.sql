CREATE TABLE IF NOT EXISTS portefeuille (
  id INTEGER PRIMARY KEY DEFAULT 1,
  argent NUMERIC(12, 2) NOT NULL DEFAULT 10000,
  CONSTRAINT portefeuille_unique CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS positions (
  symbole TEXT PRIMARY KEY,
  quantite INTEGER NOT NULL CHECK (quantite >= 0)
);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('ACHAT', 'VENTE')),
  symbole TEXT NOT NULL,
  quantite INTEGER NOT NULL CHECK (quantite > 0),
  prix_unitaire NUMERIC(12, 4) NOT NULL CHECK (prix_unitaire >= 0),
  total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
  date_transaction TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auth tables for Supabase login
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_portfolios (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  argent NUMERIC(12, 2) NOT NULL DEFAULT 10000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS user_positions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbole TEXT NOT NULL,
  quantite INTEGER NOT NULL CHECK (quantite >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, symbole)
);

CREATE TABLE IF NOT EXISTS user_transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('ACHAT', 'VENTE')),
  symbole TEXT NOT NULL,
  quantite INTEGER NOT NULL CHECK (quantite > 0),
  prix_unitaire NUMERIC(12, 4) NOT NULL CHECK (prix_unitaire >= 0),
  total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
  date_transaction TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO portefeuille (id, argent)
VALUES (1, 10000)
ON CONFLICT (id) DO NOTHING;
