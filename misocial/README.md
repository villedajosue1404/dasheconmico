# 🎯 Centro de Mando — Guía de instalación

## ¿Qué incluye?
- Gestión de negocios con finanzas (ingresos, gastos, balance)
- Publicaciones a Facebook y Telegram
- Comparación de publicidades por alcance y negocio
- Base de datos PostgreSQL en la nube
- Acceso desde cualquier IP / dispositivo

---

## PASO 1 — Subir el backend a Railway (gratis)

1. Creá una cuenta en **https://railway.app** (con tu cuenta de GitHub)
2. Hacé clic en **"New Project"**
3. Elegí **"Deploy from GitHub repo"**
   - Si no tenés GitHub, elegí **"Empty project"** y usá Railway CLI (ver más abajo)
4. Subí la carpeta `misocial/` a un repo de GitHub
5. En Railway, conectá ese repo
6. Railway detecta automáticamente que es Node.js

---

## PASO 2 — Agregar la base de datos PostgreSQL

1. En tu proyecto de Railway, hacé clic en **"New"** → **"Database"** → **"PostgreSQL"**
2. Railway crea la DB y automáticamente agrega la variable `DATABASE_URL`
3. ¡Listo! La app la usa automáticamente.

---

## PASO 3 — Deploy

1. Railway hace el deploy automáticamente
2. Andá a **Settings** → **Domains** → **Generate domain**
3. Te da una URL como: `https://tu-app-production.up.railway.app`
4. **Copiá esa URL** — la vas a necesitar en el paso 4

---

## PASO 4 — Abrir el Centro de Mando

1. Abrí el archivo `index.html` (o la URL de Railway si lo pusiste en public/)
2. Andá a **Configuración** en el menú
3. En **"URL del servidor"**, pegá tu URL de Railway
4. Hacé clic en **Guardar**
5. Deberías ver ✅ "Servidor conectado"

---

## PASO 5 — Configurar Telegram (una sola vez)

1. Abrí Telegram → buscá `@BotFather`
2. Enviá `/newbot` → seguí las instrucciones
3. Copiá el **Bot Token** que te da
4. Agregá el bot a tu canal como administrador
5. Para el **Chat ID**: abrí `https://api.telegram.org/bot[TOKEN]/getUpdates` y buscá `"id"` dentro de `"chat"`
6. En el Centro de Mando → Configuración → pegá el Token y Chat ID → **"Guardar en servidor"**

✅ **Se guarda en la base de datos del servidor. No necesitás hacerlo nunca más.**

---

## PASO 6 — Compartir acceso a tu equipo

Simplemente compartí la **URL de Railway** con tu equipo.
Todos ven los mismos datos en tiempo real.

Si querés usar el archivo HTML local: compartí el archivo `index.html` y la URL del servidor.
Cada persona lo abre en su navegador y pone la misma URL del servidor.

---

## Usando Railway CLI (alternativa sin GitHub)

```bash
npm install -g @railway/cli
railway login
cd misocial
railway init
railway up
railway add --plugin postgresql
```

---

## Variables de entorno necesarias

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | La agrega Railway automáticamente |
| `PORT` | Railway la asigna automáticamente |
| `NODE_ENV` | Podés poner `production` |

---

## Estructura de archivos

```
misocial/
├── server.js          ← Servidor principal
├── package.json       ← Dependencias
├── railway.json       ← Config de Railway
├── .env.example       ← Variables de entorno (referencia)
├── db/
│   └── schema.js      ← Base de datos (crea tablas automáticamente)
├── routes/
│   ├── config.js      ← Tokens y configuración
│   ├── businesses.js  ← Negocios y finanzas
│   ├── transactions.js← Ingresos y gastos
│   └── posts.js       ← Publicaciones sociales
└── public/
    └── index.html     ← Centro de mando (frontend completo)
```
