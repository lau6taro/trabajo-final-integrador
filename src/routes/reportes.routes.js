const express = require('express');
const XLSX = require('xlsx');
const db = require('../../db');

const router = express.Router();

router.get('/resumen', (_req, res, next) => {
  try {
    const resumen = db.prepare(`
      SELECT
        COUNT(*) AS total_productos,
        COALESCE(SUM(stock), 0) AS total_unidades,
        COALESCE(SUM(CASE WHEN stock <= 5 THEN 1 ELSE 0 END), 0) AS bajo_stock,
        COALESCE(SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END), 0) AS sin_stock,
        COALESCE(SUM(COALESCE(precio_1, 0) * stock), 0) AS valor_inventario
      FROM productos
    `).get();
    return res.json(resumen);
  } catch (error) {
    return next(error);
  }
});

router.get('/movimientos', (req, res, next) => {
  try {
    const limiteSolicitado = Number(req.query.limite || 100);
    const limite = Number.isInteger(limiteSolicitado) ? Math.min(Math.max(limiteSolicitado, 1), 500) : 100;
    const movimientos = db.prepare(`
      SELECT m.id, m.producto_nombre, m.tipo, m.cantidad, m.stock_anterior,
             m.stock_nuevo, m.observacion, m.creado_en,
             COALESCE(u.nombre, 'Usuario eliminado') AS usuario
      FROM movimientos_stock m
      LEFT JOIN usuarios u ON u.id = m.usuario_id
      ORDER BY m.id DESC
      LIMIT ?
    `).all(limite);
    return res.json(movimientos);
  } catch (error) {
    return next(error);
  }
});

function obtenerDatosExportacion() {
  return db.prepare(`
    SELECT id AS ID, nombre AS Producto, precio_1 AS Precio_1, precio_2 AS Precio_2,
           stock AS Stock, descuento_pct AS Descuento_pct, iva_pct AS IVA_pct,
           ganancia_pct AS Ganancia_pct,
           ROUND(COALESCE(precio_1, 0) * stock, 2) AS Valor_stock,
           creado_en AS Creado_en, actualizado_en AS Actualizado_en
    FROM productos ORDER BY nombre COLLATE NOCASE
  `).all();
}

router.get('/exportar.csv', (_req, res, next) => {
  try {
    const filas = obtenerDatosExportacion();
    const columnas = filas.length ? Object.keys(filas[0]) : ['ID', 'Producto', 'Precio_1', 'Precio_2', 'Stock'];
    const escapar = (valor) => {
      const texto = String(valor ?? '');
      return /[",\r\n;]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
    };
    const csv = [columnas.map(escapar).join(';'), ...filas.map((fila) => columnas.map((columna) => escapar(fila[columna])).join(';'))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="reporte_inventario.csv"');
    return res.send(`\uFEFF${csv}`);
  } catch (error) {
    return next(error);
  }
});

router.get('/exportar.xlsx', (_req, res, next) => {
  try {
    const filas = obtenerDatosExportacion();
    const hoja = XLSX.utils.json_to_sheet(filas);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Inventario');
    const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="reporte_inventario.xlsx"');
    return res.send(buffer);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
