# 🎯 Centro de Mando

Sistema completo de gestión de negocios con bot de Telegram, publicación automática en redes sociales y control financiero en tiempo real.

---

## ¿Qué hace?

- **Bot de Telegram inteligente** — registrá ventas y gastos con lenguaje natural ("vendí 10 tacos a Q15")
- **Publicación automática** — mandá foto + texto al bot y publica en Telegram y Facebook desde tu cuenta personal
- **Publicaciones programadas** — definí días y horarios ("publicar viernes a las 9am y 6pm")
- **Control financiero** — balance por negocio, ventas del mes, historial de movimientos
- **Dashboard web** — panel de control accesible desde cualquier dispositivo

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js + Express |
| Base de datos | PostgreSQL (Railway) |
| Bot | Telegram Bot API + GramJS (MTProto) |
| Frontend | HTML/CSS/JS (single file) |
| Deploy | Railway |

---

## Estructura

```
/
├── server.js          # Servidor principal (Express)
├── bot.js             # Bot de Telegram — comandos y lógica
├── scheduler.js       # Publicador automático (corre cada minuto)
├── userbot.js         # Userbot MTProto (publica desde cuenta personal)
├── package.json       # Dependencias
├── nixpacks.toml      # Config de build para Railway
├── railway.json       # Config de deploy para Railway
├── Procfile           # Comando de inicio
├── .env.example       # Variables de entorno de ejemplo
├── db/
│   └── schema.js      # Conexión a DB y creación de tablas
├── routes/
│   ├── config.js      # API: configuración (tokens, etc)
│   ├── businesses.js  # API: negocios
│   ├── transactions.js# API: ingresos y gastos
│   └── posts.js       # API: publicaciones
└── public/
    └── index.html     # Frontend completo (dashboard)
```

---

## Instalación en Railway (nueva instancia)

### Paso 1 — Fork o cloná el repo

```bash
git clone https://github.com/tu-usuario/tu-repo.git
cd tu-repo
```

### Paso 2 — Crear proyecto en Railway

1. Andá a [railway.app](https://railway.app) y creá cuenta
2. **New Project** → **Deploy from GitHub** → seleccioná el repo
3. Railway detecta Node.js automáticamente

### Paso 3 — Agregar PostgreSQL

1. En el proyecto: **New** → **Database** → **Add PostgreSQL**
2. Railway conecta la DB automáticamente via `DATABASE_URL`

### Paso 4 — Variables de entorno

En tu servicio → **Variables** → agregá:

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Auto-generada por Railway | — |
| `NODE_ENV` | Entorno | `production` |
| `TG_API_ID` | API ID de my.telegram.org | `12345678` |
| `TG_API_HASH` | API Hash de my.telegram.org | `abc123...` |
| `TG_USER_PHONE` | Tu número de teléfono | `+50212345678` |

### Paso 5 — Deploy

Railway hace el deploy automáticamente al hacer push. La app crea las tablas sola al iniciar.

### Paso 6 — Configurar desde el dashboard

1. Abrí la URL de Railway en el navegador
2. Andá a **Configuración**
3. Ingresá el token del bot de Telegram y el Chat ID
4. Guardá — el webhook se registra automáticamente

### Paso 7 — Autenticar userbot (una sola vez)

En la Console de Railway:

```bash
node auth.js
```

Ingresá tu número y el código que te manda Telegram. La sesión queda guardada en la DB permanentemente.

---

## Comandos del bot

### Finanzas

| Comando | Ejemplo |
|---------|---------|
| Registrar venta | `"vendí 10 tacos a Q15"` |
| Registrar venta simple | `"venta de 500"` |
| Registrar gasto | `"gasto de 200 en renta"` |
| Registrar gasto con cantidad | `"compré 3 kg carne a Q50"` |
| Ver balance | `/balance` |
| Ver ventas del mes | `/ventas` |
| Ver movimientos de hoy | `/inventario` |

### Negocios

| Comando | Ejemplo |
|---------|---------|
| Crear negocio | `/nuevo negocio Tacos Don Pedro` |
| Listar negocios | `/negocios` |

### Publicaciones

| Acción | Cómo |
|--------|------|
| Publicar ahora | Foto + texto + `"Publica ahorita"` |
| Programar días específicos | Foto + texto + `"publicar viernes sábado a las 9am 6pm"` |
| Programar todos los días | Texto + `"publicar cada día a las 8am 12pm"` |
| Ver programados | `/programados` |
| Cancelar programado | `/cancelar 2` |

### Userbot

| Comando | Descripción |
|---------|-------------|
| `/conectar_cuenta` | Iniciar autenticación |
| `/codigo 12345` | Ingresar código de verificación |
| `/grupo_id -1001234567890` | Configurar grupo donde publicar |
| `/estado_userbot` | Ver si está conectado |

---

## Variables de entorno completas

```env
# Base de datos (Railway la genera automáticamente)
DATABASE_URL=postgresql://...

# Entorno
NODE_ENV=production

# Telegram Bot (obtener de @BotFather)
# Se configura desde el dashboard, no hace falta acá

# Telegram Userbot (obtener de my.telegram.org)
TG_API_ID=12345678
TG_API_HASH=abc123def456...
TG_USER_PHONE=+50212345678
```

---

## Base de datos

Las tablas se crean automáticamente al iniciar el servidor:

| Tabla | Descripción |
|-------|-------------|
| `config` | Tokens, sesiones y configuración |
| `businesses` | Negocios registrados |
| `transactions` | Ingresos y gastos |
| `posts` | Historial de publicaciones |
| `scheduled_posts` | Publicaciones programadas |

---

## Costo estimado en Railway

| Componente | Costo mensual |
|-----------|---------------|
| Servidor Node.js | ~$1.50 |
| PostgreSQL | ~$0.50 |
| **Total** | **~$2/mes** |

Railway da $5 de crédito gratis al mes — suficiente para un proyecto de este tamaño.

---

## Licencia

MIT — libre para uso personal y comercial.
