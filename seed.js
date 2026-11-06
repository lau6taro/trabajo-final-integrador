const fs = require('fs');
const path = require('path');
const db = require('./db');

const archivo = path.join(__dirname, 'data_productos_seed.json');
if (!fs.existsSync(archivo)) throw new Error('No se encontro data_productos_seed.json');
const productos = JSON.parse(fs.readFileSync(archivo, 'utf8'));
const insertar = db.prepare(`
  INSERT OR IGNORE INTO productos
  (nombre, precio_1, precio_2, precio_1_label, precio_2_label, stock, hoja,
   descuento_pct, iva_pct, ganancia_pct, creado_en, actualizado_en)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
`);
const importar = db.transaction(() => {
  for (const producto of productos) {
    insertar.run(
      producto.nombre,
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
console.log(`${productos.length} productos revisados.`);
db.close();
