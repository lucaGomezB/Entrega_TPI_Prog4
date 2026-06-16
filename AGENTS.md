# AGENTS.md — Convenciones del Proyecto

Reglas de arquitectura y convenciones que TODO agente de IA DEBE seguir al generar o modificar
codigo en este proyecto. Este es el contrato unico de arquitectura para frontend y backend.

---

## Stack Tecnologico

| Capa | Tecnologia |
|------|-----------|
| Frontend | React 19, TypeScript 6, Vite 8, Tailwind 4, Zustand 5, TanStack Query/Form, Recharts 3 |
| Backend | Python 3.12, FastAPI, SQLModel, PostgreSQL 16, Alembic, pytest |
| Infra | Docker Compose, Nginx |

---

## Frontend

### Arquitectura: Feature-Sliced Design (OBLIGATORIO)

Toda feature de negocio reside en `Frontend/src/features/<nombre>/` con esta estructura
interna (solo los subdirectorios necesarios, no todos):

```
features/<feature>/
├── api/          # Cliente HTTP para endpoints de esta feature
├── components/   # Componentes visuales de esta feature
├── hooks/        # Custom hooks de esta feature
├── pages/        # Paginas/rutas de esta feature
├── store/        # Estado global de esta feature (Zustand)
└── types/        # Tipos TypeScript de esta feature
```

### Shared layer (`src/shared/`)

SOLO codigo usado por 2+ features. Si una sola feature lo usa, DEBE estar dentro
de esa feature. Contiene:

- `shared/api/` — cliente HTTP (Axios) y modulo de uploads (Cloudinary)
- `shared/components/` — componentes reusables (ImageCarousel)
- `shared/hooks/` — hook de formulario base (useAppForm)
- `shared/store/` — stores globales (authStore, cartStore)
- `shared/utils/` — utilidades (exportExcel)

### Flujo de imports (DE ARRIBA HACIA ABAJO)

```
Pages → Hooks → API → Types
```

- Pages PUEDEN importar hooks, API, y tipos
- Hooks PUEDEN importar API, stores, y tipos
- API SOLO PUEDE importar `shared/api/client` y tipos locales
- Tipos NO PUEDEN importar nada (son hojas del arbol de dependencias)

### Alias `@/` (OBLIGATORIO)

Todos los imports DEBEN usar el alias `@/` que resuelve a `src/`. Prohibidos los
imports relativos con `../`.

```ts
// CORRECTO
import { useAuthStore } from '@/shared/store/authStore'
import { productosApi } from '@/features/productos/api/productos'

// INCORRECTO
import { useAuthStore } from '../../shared/store/authStore'
```

### Cross-feature imports (SOLO API)

Cuando una feature necesita datos de otra, SOLO puede importar su modulo de API.
NUNCA componentes, hooks, paginas, o stores de otra feature.

```ts
// VALIDO: Carrito (pedidos) importa API de productos
import { productosApi } from '@/features/productos/api/productos'

// INVALIDO: importar componente de otra feature
import ProductCard from '@/features/productos/components/ProductCard'
```

### App shell (`src/app/`)

Contiene EXCLUSIVAMENTE el cascaron de la aplicacion:

- `App.tsx` — bootstrap de sesion, barra de navegacion, renderizado de rutas
- `router.tsx` — componente puro que recibe flags de rol y retorna `<Routes>`
- `main.tsx` — punto de entrada, monta React con BrowserRouter
- `App.css`, `index.css` — estilos globales

NO contiene logica de negocio ni estado de features.

### Excepcion documentada

`shared/api/client.ts` importa `shared/store/authStore` para obtener el token JWT.
Esto es aceptable porque authStore es infraestructura compartida, no logica de una
feature individual.

### Prohibiciones

- NO imports circulares
- NO imports relativos (`../`)
- NO cross-feature imports de componentes, paginas, stores, o hooks
- NO logica de features en `shared/` (YAGNI: no compartir prematuramente)

---

## Backend

### Arquitectura modular

Proyecto FastAPI organizado en modulos de dominio en `modules/` con bounded contexts:

| Modulo | Responsabilidad |
|--------|----------------|
| IdentidadYAcceso | Autenticacion JWT, refresh tokens, usuarios, roles |
| CatalogoDeProductos | Productos, categorias, ingredientes |
| VentasPagosTrazabilidad | Pedidos, pagos (MercadoPago), direcciones |
| Estadisticas | Dashboard KPIs, graficos |
| Uploads | Imagenes via Cloudinary |

### Patron de capas (ESTRICTO)

```
Router → Service → Unit of Work → Repository → SQLModel
```

- Routers: solo reciben requests, validan, delegan al servicio
- Services: logica de negocio, transacciones, llamadas a UoW
- Unit of Work: coordina transacciones, inyecta repositorios
- Repositories: queries SQLModel, operaciones CRUD
- NO logica de negocio en routers
- NO queries raw fuera de repositorios

### Convenciones de datos

- **Dinero**: SIEMPRE `Decimal` (nunca `float`)
- **Soft delete**: campo `activo` (boolean, default `True`); filtrado automatico
- **Timestamps**: `created_at`, `updated_at` en UTC; `deleted_at` para soft delete
- **API**: prefijo `/api/v1/`, respuestas paginadas `{ items, total, skip, limit }`
- **Errores**: RFC 7807 Problem Details (`type`, `title`, `status`, `detail`)

### Autenticacion y autorizacion

- JWT access token (corto, en memoria/sessionStorage)
- Refresh token en httpOnly cookie (inaccesible desde JavaScript)
- RBAC con roles: ADMIN, CLIENTE, STOCK, PEDIDOS
- Roles anidados: ADMIN incluye permisos de STOCK + PEDIDOS

### WebSocket

- Autenticacion JWT en handshake (?token=...)
- Broadcast post-commit (eventos se emiten despues del commit exitoso)
- Canales: `/ws/pedidos/{id}` (cliente), `/ws/admin/pedidos` (staff)
- Eventos: `estado_cambiado`, `pedido_cancelado`, `pago_confirmado`

### Seeders

- Idempotentes: verifican existencia antes de insertar
- Crean roles, usuarios de prueba, y datos de ejemplo
- Se ejecutan automaticamente en `docker-compose up`

### Prohibiciones

- NO logica de negocio en routers
- NO queries SQL raw fuera de repositorios
- NO `float` para dinero (usar `Decimal`)
- NO eliminar dependencias del Unit of Work (los servicios dependen de UoW, no de repositorios directamente)

---

## Reglas generales

- AGENTS.md es la UNICA fuente de verdad de arquitectura para agentes
- Mantener AGENTS.md actualizado con cada cambio de arquitectura
- Idioma: documentacion en espanol, codigo en ingles
- Las reglas en AGENTS.md son MANDATORIAS, no sugerencias
