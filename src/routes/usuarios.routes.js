const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../db');
const { requireRole } = require('../middleware/auth.middleware');

const router = express.Router();
router.use(requireRole('admin'));

const seleccionarUsuarios = db.prepare(`
  SELECT id, username, nombre, email, rol, activo, creado_en, actualizado_en
  FROM usuarios ORDER BY nombre COLLATE NOCASE
`);

function normalizarTexto(valor) {
  return String(valor ?? '').trim().replace(/\s+/g, ' ');
}

function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function respuestaError(res, estado, error) {
  return res.status(estado).json({ error });
}

router.get('/', (_req, res) => res.json(seleccionarUsuarios.all()));

router.post('/', async (req, res, next) => {
  try {
    const username = normalizarTexto(req.body?.username).toLowerCase();
    const nombre = normalizarTexto(req.body?.nombre);
    const email = normalizarTexto(req.body?.email).toLowerCase();
    const password = String(req.body?.password || '');
    const rol = req.body?.rol === 'admin' ? 'admin' : 'usuario';

    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      return respuestaError(res, 400, 'El usuario debe tener entre 3 y 32 caracteres: letras, numeros, punto, guion o guion bajo.');
    }
    if (!nombre || !validarEmail(email)) return respuestaError(res, 400, 'Nombre y email valido son obligatorios.');
    if (password.length < 10) return respuestaError(res, 400, 'La contraseña debe tener al menos 10 caracteres.');

    const passwordHash = await bcrypt.hash(password, 12);
    const resultado = db.prepare(`
      INSERT INTO usuarios (username, nombre, email, password_hash, rol, activo)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(username, nombre, email, passwordHash, rol);

    return res.status(201).json({ mensaje: 'Usuario creado.', id: resultado.lastInsertRowid });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return respuestaError(res, 409, 'Ese nombre de usuario o email ya esta registrado.');
    return next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return respuestaError(res, 400, 'Id de usuario invalido.');
    const actual = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    if (!actual) return respuestaError(res, 404, 'Usuario no encontrado.');

    const nombre = req.body?.nombre !== undefined ? normalizarTexto(req.body.nombre) : actual.nombre;
    const email = req.body?.email !== undefined ? normalizarTexto(req.body.email).toLowerCase() : actual.email;
    const rol = req.body?.rol !== undefined ? req.body.rol : actual.rol;
    const activo = req.body?.activo !== undefined
      ? ((req.body.activo === true || req.body.activo === 1 || req.body.activo === '1') ? 1 : 0)
      : actual.activo;
    const password = String(req.body?.password || '');

    if (!nombre || !validarEmail(email)) return respuestaError(res, 400, 'Nombre y email valido son obligatorios.');
    if (!['admin', 'usuario'].includes(rol)) return respuestaError(res, 400, 'El rol debe ser admin o usuario.');
    if (![0, 1].includes(Number(activo))) return respuestaError(res, 400, 'Estado de usuario invalido.');
    if (password && password.length < 10) return respuestaError(res, 400, 'La nueva contraseña debe tener al menos 10 caracteres.');

    if (actual.id === req.user.id && Number(activo) === 0) {
      return respuestaError(res, 400, 'No puedes desactivar tu propia cuenta.');
    }

    const dejaDeSerAdmin = actual.rol === 'admin' && (rol !== 'admin' || Number(activo) !== 1);
    if (dejaDeSerAdmin) {
      const otrosAdmins = db.prepare(`
        SELECT COUNT(*) AS total FROM usuarios
        WHERE rol = 'admin' AND activo = 1 AND id <> ?
      `).get(id).total;
      if (otrosAdmins < 1) return respuestaError(res, 400, 'Debe quedar al menos un administrador activo.');
    }

    const passwordHash = password ? await bcrypt.hash(password, 12) : actual.password_hash;
    db.prepare(`
      UPDATE usuarios
      SET nombre = ?, email = ?, rol = ?, activo = ?, password_hash = ?, actualizado_en = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nombre, email, rol, Number(activo), passwordHash, id);

    if (password || Number(activo) === 0) {
      db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(id);
    }
    return res.json({ mensaje: 'Usuario actualizado.' });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return respuestaError(res, 409, 'Ese email ya esta registrado en otra cuenta.');
    return next(error);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return respuestaError(res, 400, 'Id de usuario invalido.');
    const usuario = db.prepare('SELECT id, rol FROM usuarios WHERE id = ?').get(id);
    if (!usuario) return respuestaError(res, 404, 'Usuario no encontrado.');
    if (id === req.user.id) return respuestaError(res, 400, 'No puedes eliminar tu propia cuenta.');

    if (usuario.rol === 'admin') {
      const otrosAdmins = db.prepare(`
        SELECT COUNT(*) AS total FROM usuarios
        WHERE rol = 'admin' AND activo = 1 AND id <> ?
      `).get(id).total;
      if (otrosAdmins < 1) return respuestaError(res, 400, 'No puedes eliminar el ultimo administrador activo.');
    }

    db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
    return res.json({ mensaje: 'Usuario eliminado.' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
