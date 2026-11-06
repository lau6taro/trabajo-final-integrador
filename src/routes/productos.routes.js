const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('../../db');
const { requireRole } = require('../middleware/auth.middleware');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, archivo, callback) => {
    if (/\.(xlsx|xls)$/i.test(archivo.originalname || '')) return callback(null, true);
    return callback(new Error('Solo se permiten archivos .xlsx o .xls.'));
  }
});

function nombreNormalizado(valor) {
  return String(valor ?? '').trim().replace(/\s+/g, ' ');
}

function numeroOpcional(valor, etiqueta, minimo = 0, maximo = Number.MAX_SAFE_INTEGER) {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  const numero = typeof valor === 'string'
    ? Number(valor.trim().replace(/\s/g, '').replace(',', '.'))
    : Number(valor);
  if (!Number.isFinite(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${etiqueta} debe ser un numero entre ${minimo} y ${maximo}.`);
  }
  return numero;
}

function stockValido(valor, permitirAusente = false) {
  if (valor === undefined && permitirAusente) return undefined;
  const stock = Number(valor);
  if (!Number.isInteger(stock) || stock < 0) throw new Error('El stock debe ser un entero igual o mayor que cero.');
  return stock;
}

function obtenerProducto(id) {
  return db.prepare('SELECT * FROM productos WHERE id = ?').get(id);
}

router.get('/', (req, res, next) => {
  try {
    const busqueda = nombreNormalizado(req.query.q);
    const productos = busqueda
      ? db.prepare('SELECT * FROM productos WHERE nombre LIKE ? ORDER BY nombre COLLATE NOCASE').all(`%${busqueda}%`)
      : db.prepare('SELECT * FROM productos ORDER BY nombre COLLATE NOCASE').all();
    return res.json(productos);
  } catch (error) {
    return next(error);
  }
});

router.post('/', requireRole('admin'), (req, res, next) => {
  try {
    const nombre = nombreNormalizado(req.body?.nombre);
    if (!nombre) return res.status(400).json({ error: 'El nombre del producto es obligatorio.' });

    const precio1 = numeroOpcional(req.body?.precio_1, 'Precio 1');
    const precio2 = numeroOpcional(req.body?.precio_2, 'Precio 2');
    const stock = stockValido(req.body?.stock ?? 0);
    const resultado = db.prepare(`
      INSERT INTO productos (nombre, precio_1, precio_2, stock, creado_en, actualizado_en)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(nombre, precio1 ?? null, precio2 ?? null, stock);

    return res.status(201).json({ mensaje: 'Producto creado.', id: resultado.lastInsertRowid });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe un producto con ese nombre.' });
    if (error.message.includes('debe ser un numero') || error.message.includes('El stock')) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
});

router.put('/:id', requireRole('admin'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Id de producto invalido.' });
    const actual = obtenerProducto(id);
    if (!actual) return res.status(404).json({ error: 'Producto no encontrado.' });

    const body = req.body || {};
    const nombre = body.nombre !== undefined ? nombreNormalizado(body.nombre) : actual.nombre;
    if (!nombre) return res.status(400).json({ error: 'El nombre del producto es obligatorio.' });

    const precio1 = numeroOpcional(body.precio_1, 'Precio 1');
    const precio2 = numeroOpcional(body.precio_2, 'Precio 2');
    const descuento = numeroOpcional(body.descuento_pct, 'Descuento', 0, 100);
    const iva = numeroOpcional(body.iva_pct, 'IVA', 0, 100);
    const ganancia = numeroOpcional(body.ganancia_pct, 'Ganancia', 0, 1000);
    const iva1 = numeroOpcional(body.iva1_pct, 'IVA 1', 0, 100);
    const iva2 = numeroOpcional(body.iva2_pct, 'IVA 2', 0, 100);
    const iva3 = numeroOpcional(body.iva3_pct, 'IVA 3', 0, 100);

    db.prepare(`
      UPDATE productos SET
        nombre = ?,
        precio_1 = ?,
        precio_2 = ?,
        descuento_pct = ?,
        iva_pct = ?,
        ganancia_pct = ?,
        iva1_pct = ?,
        iva2_pct = ?,
        iva3_pct = ?,
        actualizado_en = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      nombre,
      precio1 === undefined ? actual.precio_1 : precio1,
      precio2 === undefined ? actual.precio_2 : precio2,
      descuento === undefined ? (actual.descuento_pct || 0) : descuento,
      iva === undefined ? (actual.iva_pct || 0) : iva,
      ganancia === undefined ? (actual.ganancia_pct || 0) : ganancia,
      iva1 === undefined ? (actual.iva1_pct || 0) : iva1,
      iva2 === undefined ? (actual.iva2_pct || 0) : iva2,
      iva3 === undefined ? (actual.iva3_pct || 0) : iva3,
      id
    );

    return res.json({ mensaje: 'Producto actualizado.' });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe otro producto con ese nombre.' });
    if (/debe ser un numero/.test(error.message)) return res.status(400).json({ error: error.message });
    return next(error);
  }
});

router.post('/:id/stock', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const cantidad = Number(req.body?.cantidad);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Id de producto invalido.' });
    if (!Number.isInteger(cantidad) || cantidad === 0) {
      return res.status(400).json({ error: 'La cantidad debe ser un entero distinto de cero.' });
    }

    const ajustar = db.transaction(() => {
      const producto = obtenerProducto(id);
      if (!producto) {
        const error = new Error('Producto no encontrado.');
        error.status = 404;
        throw error;
      }
      const nuevoStock = producto.stock + cantidad;
      if (nuevoStock < 0) {
        const error = new Error('El stock no puede quedar negativo.');
        error.status = 400;
        throw error;
      }

      db.prepare('UPDATE productos SET stock = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?')
        .run(nuevoStock, id);
      db.prepare(`
        INSERT INTO movimientos_stock
        (producto_id, producto_nombre, usuario_id, tipo, cantidad, stock_anterior, stock_nuevo, observacion)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        producto.nombre,
        req.user.id,
        cantidad > 0 ? 'entrada' : 'salida',
        Math.abs(cantidad),
        producto.stock,
        nuevoStock,
        nombreNormalizado(req.body?.observacion) || null
      );
      return nuevoStock;
    });

    const stock = ajustar();
    return res.json({ id, stock, mensaje: 'Stock actualizado y movimiento registrado.' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
});

router.delete('/:id', requireRole('admin'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Id de producto invalido.' });
    const producto = obtenerProducto(id);
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado.' });
    db.prepare('DELETE FROM productos WHERE id = ?').run(id);
    return res.json({ mensaje: 'Producto eliminado.' });
  } catch (error) {
    return next(error);
  }
});

function normalizarEncabezado(valor) {
  return String(valor).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function buscarColumna(encabezados, alternativas) {
  const mapa = new Map(encabezados.map((valor) => [normalizarEncabezado(valor), valor]));
  for (const alternativa of alternativas) {
    const encontrada = mapa.get(normalizarEncabezado(alternativa));
    if (encontrada) return encontrada;
  }
  return null;
}

function numeroImportado(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  let texto = String(valor).trim().replace(/\$/g, '').replace(/\s/g, '');
  if (texto.includes(',') && texto.includes('.')) texto = texto.replace(/\./g, '').replace(',', '.');
  else texto = texto.replace(',', '.');
  const numero = Number(texto);
  return Number.isFinite(numero) && numero >= 0 ? numero : null;
}

function importarExcel(buffer, actualizarExistentes) {
  const libro = XLSX.read(buffer, { type: 'buffer' });
  let insertados = 0;
  let actualizados = 0;
  let omitidos = 0;
  const insertar = db.prepare(`
    INSERT INTO productos
    (nombre, precio_1, precio_1_label, precio_2, precio_2_label, stock, hoja,
     descuento_pct, iva_pct, ganancia_pct, creado_en, actualizado_en)
    VALUES (?, ?, ?, ?, ?, 0, ?, 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  const actualizar = db.prepare(`
    UPDATE productos SET precio_1 = ?, precio_1_label = ?, precio_2 = ?, precio_2_label = ?,
      hoja = ?, actualizado_en = CURRENT_TIMESTAMP
    WHERE nombre = ?
  `);

  const transaccion = db.transaction(() => {
    for (const nombreHoja of libro.SheetNames) {
      const filas = XLSX.utils.sheet_to_json(libro.Sheets[nombreHoja], { defval: null });
      if (!filas.length) continue;
      const encabezados = Object.keys(filas[0]);
      const colNombre = buscarColumna(encabezados, ['nombre', 'producto', 'descripcion', 'articulo']);
      const colPrecio1 = buscarColumna(encabezados, ['precio', 'precio 1', 'precio_1', 'venta', 'p1']);
      const colPrecio2 = buscarColumna(encabezados, ['precio 2', 'precio_2', 'p2', 'mayorista', 'precio mayorista']);
      if (!colNombre) continue;

      for (const fila of filas) {
        const nombre = nombreNormalizado(fila[colNombre]);
        if (!nombre) {
          omitidos += 1;
          continue;
        }
        const precio1 = colPrecio1 ? numeroImportado(fila[colPrecio1]) : null;
        const precio2 = colPrecio2 ? numeroImportado(fila[colPrecio2]) : null;
        const existente = db.prepare('SELECT id FROM productos WHERE nombre = ?').get(nombre);
        if (existente) {
          if (actualizarExistentes) {
            actualizar.run(precio1, colPrecio1 || null, precio2, colPrecio2 || null, nombreHoja, nombre);
            actualizados += 1;
          } else {
            omitidos += 1;
          }
        } else {
          insertar.run(nombre, precio1, colPrecio1 || null, precio2, colPrecio2 || null, nombreHoja);
          insertados += 1;
        }
      }
    }
  });
  transaccion();
  return { insertados, actualizados, omitidos };
}

router.uploadMiddleware = upload.single('archivo');
router.importarExcel = importarExcel;

module.exports = router;
