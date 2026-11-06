const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../../db');
const { COOKIE_NAME, hashToken, cookieOptions, authRequired } = require('../middleware/auth.middleware');

const router = express.Router();
const duracionSesionMs = 8 * 60 * 60 * 1000;
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera 15 minutos y vuelve a intentar.' }
});

function usuarioPublico(usuario) {
  return {
    id: usuario.id,
    username: usuario.username,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: usuario.rol,
    activo: Boolean(usuario.activo)
  };
}

router.post('/login', limiteLogin, async (req, res, next) => {
  try {
    const identificador = String(req.body?.identificador || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!identificador || !password) {
      return res.status(400).json({ error: 'Ingresa usuario o email y contraseña.' });
    }

    const usuario = db.prepare(`
      SELECT * FROM usuarios
      WHERE username = ? OR email = ?
      LIMIT 1
    `).get(identificador, identificador);

    const valido = usuario && usuario.activo === 1 && await bcrypt.compare(password, usuario.password_hash);
    if (!valido) {
      return res.status(401).json({ error: 'Credenciales incorrectas o usuario inactivo.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expira = new Date(Date.now() + duracionSesionMs).toISOString();
    db.prepare('INSERT INTO sesiones (usuario_id, token_hash, expira_en) VALUES (?, ?, ?)')
      .run(usuario.id, hashToken(token), expira);

    res.cookie(COOKIE_NAME, token, {
      ...cookieOptions(),
      maxAge: duracionSesionMs
    });
    return res.json({ mensaje: 'Sesion iniciada.', usuario: usuarioPublico(usuario) });
  } catch (error) {
    return next(error);
  }
});

router.post('/logout', (req, res, next) => {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) db.prepare('DELETE FROM sesiones WHERE token_hash = ?').run(hashToken(token));
    res.clearCookie(COOKIE_NAME, cookieOptions());
    return res.json({ mensaje: 'Sesion cerrada.' });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', authRequired, (req, res) => {
  return res.json({ usuario: req.user });
});

// Recuperacion simulada: el codigo se envia a los Deploy Logs de Railway.
// Para produccion real, reemplazar el console.info por un proveedor de correo.
router.post('/recuperar', limiteLogin, (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Ingresa el correo de la cuenta.' });

    const usuario = db.prepare('SELECT id, email, activo FROM usuarios WHERE email = ?').get(email);
    if (usuario && usuario.activo === 1) {
      const codigo = String(crypto.randomInt(100000, 1000000));
      const codigoHash = hashToken(codigo);
      const expira = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      db.prepare('DELETE FROM recuperaciones_password WHERE usuario_id = ?').run(usuario.id);
      db.prepare(`
        INSERT INTO recuperaciones_password (usuario_id, codigo_hash, expira_en)
        VALUES (?, ?, ?)
      `).run(usuario.id, codigoHash, expira);
      console.info(`[RECUPERACION SIMULADA] email=${usuario.email} codigo=${codigo} (vence en 15 minutos)`);
    }

    return res.json({
      mensaje: 'Si el correo esta registrado, se genero un codigo. En esta version simulada, revisa los Deploy Logs de Railway.'
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/restablecer', limiteLogin, (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const codigo = String(req.body?.codigo || '').trim();
    const password = String(req.body?.password || '');
    if (!email || !/^\d{6}$/.test(codigo) || password.length < 10) {
      return res.status(400).json({ error: 'Completa email, codigo de 6 digitos y contraseña de al menos 10 caracteres.' });
    }

    const usuario = db.prepare('SELECT id FROM usuarios WHERE email = ? AND activo = 1').get(email);
    if (!usuario) return res.status(400).json({ error: 'El codigo no es valido o vencio.' });

    const recuperacion = db.prepare(`
      SELECT id, codigo_hash FROM recuperaciones_password
      WHERE usuario_id = ? AND usado_en IS NULL AND expira_en > ?
      ORDER BY id DESC LIMIT 1
    `).get(usuario.id, new Date().toISOString());

    if (!recuperacion || recuperacion.codigo_hash !== hashToken(codigo)) {
      return res.status(400).json({ error: 'El codigo no es valido o vencio.' });
    }

    const passwordHash = bcrypt.hashSync(password, 12);
    const restablecer = db.transaction(() => {
      db.prepare('UPDATE usuarios SET password_hash = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?')
        .run(passwordHash, usuario.id);
      db.prepare('UPDATE recuperaciones_password SET usado_en = CURRENT_TIMESTAMP WHERE id = ?')
        .run(recuperacion.id);
      db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(usuario.id);
    });
    restablecer();

    return res.json({ mensaje: 'Contraseña actualizada. Inicia sesion con la nueva clave.' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
