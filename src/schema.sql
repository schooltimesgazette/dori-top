PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'pharmacy_owner', 'admin')) DEFAULT 'user',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pharmacy_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  license_number TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  is_247 INTEGER NOT NULL DEFAULT 0,
  open_time TEXT NOT NULL DEFAULT '08:00',
  close_time TEXT NOT NULL DEFAULT '22:00',
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  admin_note TEXT NOT NULL DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pharmacies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  license_number TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  is_247 INTEGER NOT NULL DEFAULT 0,
  open_time TEXT NOT NULL DEFAULT '08:00',
  close_time TEXT NOT NULL DEFAULT '22:00',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS medicines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  active_ingredient TEXT NOT NULL,
  manufacturer TEXT NOT NULL DEFAULT '',
  dosage TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Umumiy',
  prescription INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(name, dosage, manufacturer),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL,
  medicine_id INTEGER NOT NULL,
  price INTEGER NOT NULL CHECK(price >= 0),
  status TEXT NOT NULL CHECK(status IN ('available', 'low', 'out')) DEFAULT 'available',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(pharmacy_id, medicine_id),
  FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id) ON DELETE CASCADE,
  FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_requests_status ON pharmacy_requests(status);
CREATE INDEX IF NOT EXISTS idx_pharmacies_city ON pharmacies(city);
CREATE INDEX IF NOT EXISTS idx_medicines_name ON medicines(name);
CREATE INDEX IF NOT EXISTS idx_medicines_active ON medicines(active_ingredient);
CREATE INDEX IF NOT EXISTS idx_inventory_med ON inventory(medicine_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ph ON inventory(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_pharmacies_owner ON pharmacies(owner_id);
CREATE INDEX IF NOT EXISTS idx_pharmacies_license ON pharmacies(license_number);
CREATE INDEX IF NOT EXISTS idx_requests_user ON pharmacy_requests(user_id);
