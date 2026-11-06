const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const db = require('./db');
const authRoutes = require('./src/routes/auth.routes');
const usuariosRoutes = require('./src/routes/usuarios.routes');
const productosRoutes = require('./src/routes/productos.routes');
const reportesRoutes = require('./src/routes/reportes.routes');
const { authRequired, requireRole } = require('./src/middleware/auth.middleware');
const { inicializarAdministrador, inicializarInventario } = require('./src/services/bootstrap.service');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    return res.json({ ok: true, servicio: 'ferreteria-avenida' });
  } catch (_error) {
    return res.status(500).json({ ok: false, error: 'Base de datos no disponible.' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/usuarios', authRequired, usuariosRoutes);
app.use('/api/productos', authRequired, productosRoutes);
app.use('/api/reportes', authRequired, reportesRoutes);
app.post(
  '/api/upload',
  authRequired,
  requireRole('admin'),
  productosRoutes.uploadMiddleware,
  (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Selecciona un archivo Excel.' });
      let resultado;
      try {
        resultado = productosRoutes.importarExcel(req.file.buffer, req.body.actualizar === 'true');
      } catch (_error) {
        return res.status(400).json({ error: 'El archivo Excel no se pudo procesar. Verifica su contenido y formato.' });
      }
      return res.json(resultado);
    } catch (error) {
      return next(error);
    }
  }
);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta API no encontrada.' }));

app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  const esMulter = error && (error.name === 'MulterError' || /Solo se permiten archivos|File too large/.test(error.message || ''));
  const estado = esMulter ? 400 : (Number.isInteger(error.status) ? error.status : 500);
  if (estado >= 500) console.error('Error interno:', error);
  return res.status(estado).json({
    error: estado >= 500 ? 'Ocurrio un error interno. Intenta nuevamente.' : error.message
  });
});

async function iniciarServidor() {
  await inicializarAdministrador();
  inicializarInventario();

  const puerto = Number(process.env.PORT) || 3000;
  const servidor = app.listen(puerto, '0.0.0.0', () => {
    console.log(`Servidor escuchando en 0.0.0.0:${puerto}`);
  });

  const cerrar = (senal) => {
    console.log(`Recibida señal ${senal}. Cerrando servidor...`);
    servidor.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.once('SIGTERM', () => cerrar('SIGTERM'));
  process.once('SIGINT', () => cerrar('SIGINT'));
}

iniciarServidor().catch((error) => {
  console.error('No se pudo iniciar la aplicacion:', error);
  process.exit(1);
});

module.exports = app;
