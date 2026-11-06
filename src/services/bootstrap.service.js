const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../../db');

async function inicializarAdministrador() {
  const existentes = db.prepare('SELECT COUNT(*) AS total FROM usuarios').get().total;
  if (existentes > 0) return;

  const username = String(process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
  const email = String(process.env.ADMIN_EMAIL || 'admin@local.test').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(18).toString('base64url');
  if (password.length < 10) {
    throw new Error('ADMIN_PASSWORD debe tener al menos 10 caracteres.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  db.prepare(`
    INSERT INTO usuarios (username, nombre, email, password_hash, rol, activo)
    VALUES (?, ?, ?, ?, 'admin', 1)
  `).run(username, 'Administrador principal', email, passwordHash);

  if (process.env.ADMIN_PASSWORD) {
    console.log(`Administrador inicial creado: usuario=${username}, email=${email}.`);
  } else {
    console.warn('ADMIN_PASSWORD no estaba configurada. Credenciales iniciales generadas:');
    console.warn(`USUARIO=${username} EMAIL=${email} PASSWORD=${password}`);
    console.warn('Guarda esta clave y define ADMIN_PASSWORD en Railway antes de un nuevo entorno.');
  }
}

function inicializarInventario() {
  const total = db.prepare('SELECT COUNT(*) AS total FROM productos').get().total;
  if (total > 0) return;

  const archivo = path.join(__dirname, '..', '..', 'data_productos_seed.json');
  if (!fs.existsSync(archivo)) {
    console.warn('No se encontro data_productos_seed.json; se inicia el inventario vacio.');
    return;
  }

  const productos = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  const insertar = db.prepare(`
    INSERT OR IGNORE INTO productos
    (nombre, precio_1, precio_2, precio_1_label, precio_2_label, stock, hoja,
     descuento_pct, iva_pct, ganancia_pct, creado_en, actualizado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);

  const importar = db.transaction(() => {
    for (const producto of productos) {
      if (!producto.nombre) continue;
      insertar.run(
        String(producto.nombre).trim(),
        producto.precio_1 ?? null,
        producto.precio_2 ?? null,
        producto.precio_1_label ?? null,
        producto.precio_2_label ?? null,
        Number.isInteger(producto.stock) && producto.stock >= 0 ? producto.stock : 0,
        producto.hoja ?? null,
        producto.descuento_pct ?? 0,
        producto.iva_pct ?? 0,
        producto.ganancia_pct ?? 0
      );
    }
  });

  importar();
  console.log(`Inventario inicial cargado: ${productos.length} productos revisados.`);
}

module.exports = { inicializarAdministrador, inicializarInventario };
