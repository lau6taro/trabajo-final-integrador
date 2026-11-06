const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Railway expone RAILWAY_VOLUME_MOUNT_PATH cuando el servicio tiene un Volume.
// DATA_DIR permite conservar compatibilidad con la configuracion existente.
const dataDir = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'inventario.db'));
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

// Tabla existente: se conserva para no perder el inventario desplegado.
db.exec(`
  CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    precio_1 REAL,
    precio_1_label TEXT,
    precio_2 REAL,
    precio_2_label TEXT,
    stock INTEGER NOT NULL DEFAULT 0,
    hoja TEXT,
    descuento_pct REAL NOT NULL DEFAULT 0,
    iva_pct REAL NOT NULL DEFAULT 0,
    ganancia_pct REAL NOT NULL DEFAULT 0,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    nombre TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    rol TEXT NOT NULL DEFAULT 'usuario' CHECK (rol IN ('admin', 'usuario')),
    activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
    creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sesiones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expira_en TEXT NOT NULL,
    creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS recuperaciones_password (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    codigo_hash TEXT NOT NULL,
    expira_en TEXT NOT NULL,
    usado_en TEXT,
    creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS movimientos_stock (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER,
    producto_nombre TEXT NOT NULL,
    usuario_id INTEGER,
    tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'salida')),
    cantidad INTEGER NOT NULL CHECK (cantidad > 0),
    stock_anterior INTEGER NOT NULL CHECK (stock_anterior >= 0),
    stock_nuevo INTEGER NOT NULL CHECK (stock_nuevo >= 0),
    observacion TEXT,
    creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE SET NULL,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
  );
`);

// Migraciones aditivas: agregan columnas faltantes sin eliminar datos existentes.
const columnasProductos = new Set(db.prepare('PRAGMA table_info(productos)').all().map((columna) => columna.name));
const migracionesProductos = {
  precio_1_label: 'ALTER TABLE productos ADD COLUMN precio_1_label TEXT',
  precio_2_label: 'ALTER TABLE productos ADD COLUMN precio_2_label TEXT',
  hoja: 'ALTER TABLE productos ADD COLUMN hoja TEXT',
  descuento_pct: 'ALTER TABLE productos ADD COLUMN descuento_pct REAL NOT NULL DEFAULT 0',
  iva_pct: 'ALTER TABLE productos ADD COLUMN iva_pct REAL NOT NULL DEFAULT 0',
  ganancia_pct: 'ALTER TABLE productos ADD COLUMN ganancia_pct REAL NOT NULL DEFAULT 0',
  iva1_pct: 'ALTER TABLE productos ADD COLUMN iva1_pct REAL NOT NULL DEFAULT 0',
  iva2_pct: 'ALTER TABLE productos ADD COLUMN iva2_pct REAL NOT NULL DEFAULT 0',
  iva3_pct: 'ALTER TABLE productos ADD COLUMN iva3_pct REAL NOT NULL DEFAULT 0',
  creado_en: 'ALTER TABLE productos ADD COLUMN creado_en TEXT',
  actualizado_en: 'ALTER TABLE productos ADD COLUMN actualizado_en TEXT'
};

for (const [columna, sql] of Object.entries(migracionesProductos)) {
  if (!columnasProductos.has(columna)) {
    db.exec(sql);
    if (columna === 'iva1_pct') {
      db.exec('UPDATE productos SET iva1_pct = iva_pct WHERE iva1_pct = 0 AND iva_pct <> 0');
    }
    if (columna === 'creado_en' || columna === 'actualizado_en') {
      db.exec(`UPDATE productos SET ${columna} = CURRENT_TIMESTAMP WHERE ${columna} IS NULL`);
    }
  }
}

db.exec(`
  UPDATE productos SET creado_en = CURRENT_TIMESTAMP WHERE creado_en IS NULL;
  UPDATE productos SET actualizado_en = CURRENT_TIMESTAMP WHERE actualizado_en IS NULL;
  CREATE INDEX IF NOT EXISTS idx_productos_nombre ON productos(nombre);
  CREATE INDEX IF NOT EXISTS idx_movimientos_fecha ON movimientos_stock(creado_en);
  CREATE INDEX IF NOT EXISTS idx_movimientos_producto ON movimientos_stock(producto_id);
  CREATE INDEX IF NOT EXISTS idx_sesiones_usuario ON sesiones(usuario_id);
`);

module.exports = db;
