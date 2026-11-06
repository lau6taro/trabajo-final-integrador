# Ferretería Avenida – versión preparada para PPS / TFI

Aplicación web de inventario con persistencia SQLite, autenticación, roles, ABM de usuarios y productos, historial de movimientos y reportes exportables.

## 1. Requisitos

- Node.js 20, 21 o 22.
- npm.
- En Railway: un Volume persistente montado en `/data`.

## 2. Instalación local

```bash
npm install
cp .env.example .env
npm start
```

Abrir `http://localhost:3000`.

En Windows se puede copiar `.env.example` como `.env` manualmente. No subir `.env` a GitHub.

## 3. Primer administrador

Antes del primer inicio, configurar en `.env` o en las Variables del servicio:

```env
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@ferreteria.local
ADMIN_PASSWORD=CAMBIAR_POR_UNA_CLAVE_LARGA_Y_UNICA
```

La clave debe tener al menos 10 caracteres. Si la tabla de usuarios está vacía y no se configuró `ADMIN_PASSWORD`, la aplicación genera una clave aleatoria y la escribe una sola vez en los logs de inicio. Guardarla inmediatamente.

La creación inicial ocurre solo si no hay usuarios registrados. Cambiar `ADMIN_PASSWORD` después no cambia la clave de una cuenta ya creada.

## 4. Railway

1. En el servicio Node, crear o conservar un Volume y montarlo en `/data`.
2. Configurar `NODE_ENV=production` y las variables `ADMIN_USERNAME`, `ADMIN_EMAIL` y `ADMIN_PASSWORD` antes del primer arranque de esta versión.
3. Mantener `DATA_DIR=/data` si ya estaba configurada. El código también reconoce automáticamente `RAILWAY_VOLUME_MOUNT_PATH` cuando Railway adjunta el Volume.
4. Usar `npm start` como Start Command.
5. Confirmar que `/api/health` responde `{ "ok": true }`.

**Importante:** antes de desplegar sobre una base con datos, hacer un backup del archivo `inventario.db`. La migración es aditiva y conserva `productos`, pero la copia de seguridad sigue siendo obligatoria.

## 5. Cuentas y roles

- `admin`: alta, modificación y baja de productos y usuarios; importación de Excel; consulta y exportación de reportes.
- `usuario`: consulta de productos, ajustes de stock y consulta/exportación de reportes.
- Las contraseñas se almacenan con hash bcrypt. Las sesiones usan un token aleatorio almacenado como hash y una cookie HttpOnly.

La recuperación de contraseña está implementada como **simulación académica**: al solicitarla, el código de seis dígitos aparece en Deploy Logs de Railway y vence a los 15 minutos. No se envía un correo. Para uso real, hay que integrar un proveedor de email y reemplazar ese registro en logs por el envío del código.

## 6. Funciones

- Productos: alta, consulta, modificación y baja.
- Stock: entradas/salidas con validación, usuario responsable y registro de historial.
- Usuarios: alta, consulta, modificación, desactivación y baja; roles `admin` y `usuario`.
- Reportes: indicadores en pantalla, tabla de movimientos y exportación del inventario a Excel y CSV.
- Importación de catálogo Excel para administradores.
- Persistencia de datos con SQLite y claves foráneas.

## 7. Comprobación rápida

```bash
npm run check
curl http://localhost:3000/api/health
```

El proyecto no contiene credenciales ni una copia de la base productiva. La base se crea en `DATA_DIR` al arrancar.
