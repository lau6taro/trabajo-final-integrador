const crypto = require('crypto');
const db = require('../../db');

const COOKIE_NAME = 'ferreteria_session';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function authRequired(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) {
      return res.status(401).json({ error: 'Necesitas iniciar sesion.' });
    }

    const sesion = db.prepare(`
      SELECT u.id, u.username, u.nombre, u.email, u.rol, u.activo
      FROM sesiones s
      INNER JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = ? AND s.expira_en > ? AND u.activo = 1
    `).get(hashToken(token), new Date().toISOString());

    if (!sesion) {
      res.clearCookie(COOKIE_NAME, cookieOptions());
      return res.status(401).json({ error: 'La sesion vencio. Inicia sesion nuevamente.' });
    }

    req.user = sesion;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.user || !rolesPermitidos.includes(req.user.rol)) {
      return res.status(403).json({ error: 'No tienes permisos para realizar esta operacion.' });
    }
    return next();
  };
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
  };
}

module.exports = { COOKIE_NAME, hashToken, authRequired, requireRole, cookieOptions };
