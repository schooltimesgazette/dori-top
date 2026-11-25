-- PostgreSQL / Supabase uchun migratsiya sxemasi (SQLite sxemasi bilan to'liq mos)
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'pharmacy_owner', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pharmacy_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  license_number TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  is_247 BOOLEAN NOT NULL DEFAULT FALSE,
  open_time TEXT NOT NULL DEFAULT '08:00',
  close_time TEXT NOT NULL DEFAULT '22:00',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pharmacies (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  license_number TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  is_247 BOOLEAN NOT NULL DEFAULT FALSE,
  open_time TEXT NOT NULL DEFAULT '08:00',
  close_time TEXT NOT NULL DEFAULT '22:00',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS medicines (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  active_ingredient TEXT NOT NULL,
  manufacturer TEXT NOT NULL DEFAULT '',
  dosage TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Umumiy',
  prescription BOOLEAN NOT NULL DEFAULT FALSE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name, dosage, manufacturer)
);

CREATE TABLE IF NOT EXISTS inventory (
  id BIGSERIAL PRIMARY KEY,
  pharmacy_id BIGINT NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  medicine_id BIGINT NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  price INTEGER NOT NULL CHECK (price >= 0),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'low', 'out')),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pharmacy_id, medicine_id)
);

-- Bitta foydalanuvchida bir vaqtda faqat bitta kutilayotgan ariza
CREATE UNIQUE INDEX IF NOT EXISTS idx_pg_requests_one_pending ON pharmacy_requests(user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pg_requests_status ON pharmacy_requests(status);
CREATE INDEX IF NOT EXISTS idx_pg_pharmacies_city ON pharmacies(city);
CREATE INDEX IF NOT EXISTS idx_pg_pharmacies_owner ON pharmacies(owner_id);
CREATE INDEX IF NOT EXISTS idx_pg_medicines_name ON medicines(LOWER(name));
CREATE INDEX IF NOT EXISTS idx_pg_medicines_active ON medicines(LOWER(active_ingredient));
CREATE INDEX IF NOT EXISTS idx_pg_inventory_med ON inventory(medicine_id);
CREATE INDEX IF NOT EXISTS idx_pg_inventory_ph ON inventory(pharmacy_id);
