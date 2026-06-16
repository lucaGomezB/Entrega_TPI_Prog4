# Guion de Presentacion — Food Store E-commerce (Version Final Completa)

**Duracion estimada:** 20 minutos
**Formato:** Slides → Codigo backend → Demo frontend
**Protagonista:** Backend FastAPI. El frontend muestra lo que el backend expone.
**Enfoque:** Recorrido lineal por TODAS las funcionalidades, sin saltos ni repeticiones. Balance backend (60%) y frontend (40%).

---

## Bloque 1 — Arquitectura y Nucleo (3:30)

### Slide 1 | Portada (0:15)

> **En pantalla:** Titulo "Food Store API — Backend FastAPI + Frontend React" con nombres de los integrantes.
>
> **Narracion:** "Aplicacion e-commerce con backend en Python FastAPI organizado en 3 modulos, base de datos PostgreSQL, y frontend React que consume la API. Vamos a recorrer todo lo que implementamos en orden: arquitectura, autenticacion, catalogo, pedidos, WebSockets, MercadoPago, Cloudinary, estadisticas, tests y frontend."

---

### Slide 2 | Arquitectura General + Patrones Transversales (1:30)

> **En pantalla:** Diagrama de capas + extractos de UoW y BaseRepository:
> ```
> PostgreSQL ← SQLModel ORM ← FastAPI ← HTTP/REST ← React (Vite)
>                                ↑
>                         3 Bounded Contexts:
>                     IdentidadYAcceso
>                     CatalogoDeProductos
>                     VentasPagosTrazabilidad
> 
> Capas por recurso:
> Router → Service → UnitOfWork → Repository → Model
> ```
> ```python
> # Unit of Work — transaccion atomica
> class VentasPagosTrazabilidadUnitOfWork:
>     def __exit__(self, exc_type, exc, tb):
>         if exc_type: self.rollback(); return False
>         self.commit()
> 
> # BaseRepository<T> — CRUD generico con paginacion
> T = TypeVar("T", bound=SQLModel)
> class BaseRepository(Generic[T]):
>     def get_all(self, skip=0, limit=100) -> List[T]: ...
> ```
>
> **Narracion:** "El backend es el nucleo. FastAPI recibe requests HTTP, SQLModel mapea a PostgreSQL. Tres bounded contexts independientes. Cada recurso sigue 5 capas: Router expone endpoints, Service tiene logica de negocio, UnitOfWork maneja transacciones atomicas con commit/rollback automatico — si algo falla dentro del `with`, nada se persiste. Repository encapsula consultas SQL, y Model define la tabla. Para no repetir codigo tenemos `BaseRepository<T>` generico con CRUD completo, paginacion con `skip`/`limit`, y filtro soft-delete automatico. Cada bounded context hereda y agrega sus queries especificas."
>
> **Codigo backend (20s):** Mostrar `Backend/main.py` — los `app.include_router(...)` que registran los 14 routers. Mostrar `Backend/modules/VentasPagosTrazabilidad/uow.py` — `__enter__/__exit__`, `commit()`, `rollback()`. Mostrar `Backend/models/base_repository.py` — clase generica con `get_all()`.

---

### Slide 3 | Core — Infraestructura Compartida (1:00)

> **En pantalla:** Arbol del directorio `Backend/core/`:
> ```
> core/
> ├── database.py          ← engine SQLModel + get_session
> ├── security/
> │   ├── tokens.py        ← JWT create_access_token + verify
> │   └── passwords.py     ← bcrypt hash + verify
> ├── websocket_manager.py ← ConnectionManager
> ├── rate_limit.py        ← Slowapi limiter
> ├── problem_response.py  ← RFC 7807 errors
> ├── cloudinary_config.py ← CloudinarySettings
> ├── dependencies.py      ← shared FastAPI deps
> └── paginated_response.py
> ```
>
> **Narracion:** "El directorio `core/` contiene infraestructura compartida. `database.py` crea el engine de SQLModel y la dependencia `get_session`. `security/tokens.py` maneja JWT, `passwords.py` usa bcrypt. `websocket_manager.py` administra conexiones WebSocket activas. `rate_limit.py` configura Slowapi. `problem_response.py` construye errores en formato RFC 7807. `cloudinary_config.py` carga credenciales desde variables de entorno."
>
> **Codigo backend (15s):** Mostrar `Backend/core/database.py` — `engine = create_engine(...)` y `def get_session()`. Mostrar `Backend/core/problem_response.py` — como construye el error JSON con `code`, `message`, `request_id`.

---

### Slide 4 | Alembic + Seed Idempotente + Soft Delete (0:45)

> **En pantalla:** Lista de 11 migraciones + extracto de `models/base.py`:
> ```python
> # SoftDeleteModel — nunca borramos fisicamente
> class SoftDeleteModel(TimestampModel):
>     deleted_at: Optional[datetime] = Field(default=None)
> ```
>
> **Narracion:** "Usamos Alembic para migraciones versionadas: 11 archivos, desde el schema inicial hasta fixes como `es_sistema` en historial. El seed es idempotente: si los roles, estados o admin ya existen, no los duplica. Y un patron clave: soft delete — nunca borramos fisicamente. Todos los modelos heredan `SoftDeleteModel` que agrega `deleted_at`. El `BaseRepository` filtra automaticamente `WHERE deleted_at IS NULL` en cada query."
>
> **Codigo backend (15s):** Mostrar `Backend/migrations/versions/` — 11 archivos. Mostrar `Backend/models/base.py` — `TimestampModel` y `SoftDeleteModel`. Mostrar `Backend/app/db/seed.py` — patron `get_or_create()`.

---

## Bloque 2 — IdentidadYAcceso (2:45)

### Slide 5 | Auth — Login JWT + Refresh + Logout (1:00)

> **En pantalla:** Diagrama de flujo:
> ```
> POST /api/v1/auth/login { email, password }
>   → Service valida bcrypt
>   → Genera JWT access_token (30 min) en body
>   → Genera refresh_token (7 dias) en cookie httpOnly
>   → Responde { access_token, token_type, expires_in }
> 
> POST /api/v1/auth/refresh (cookie)
>   → Valida refresh_token en BD → Revoca anterior → Genera nuevo par
> 
> POST /api/v1/auth/logout
>   → Revoca refresh_token en BD → Limpia cookie
> ```
>
> **Narracion:** "El endpoint de login recibe email y password. El servicio usa bcrypt para verificar el hash, genera un JWT de acceso corto en el body y un refresh token de larga duracion como cookie httpOnly — el frontend nunca toca ese refresh. El refresh rota: cada uso revoca el anterior y genera uno nuevo. El logout revoca el token y limpia la cookie."
>
> **Codigo backend (15s):** Mostrar `Backend/modules/IdentidadYAcceso/Auth/router.py` — `login()` con `set_cookie()`, `refresh()` con rotacion.
>
> **Demo frontend (10s):** Mostrar formulario de login. DevTools > Application > Cookies: la cookie httpOnly NO aparece. Mostrar localStorage con access_token.

---

### Slide 6 | RBAC — require_roles + Usuario-Rol M:N (1:00)

> **En pantalla:** Diagrama ER + UniqueConstraint:
> ```
> Usuario ──── usuario_rol ──── Rol
>   id           usuario_id      codigo (PK): ADMIN, PEDIDOS, CLIENT
>   email        rol_codigo      nombre
>   password_hash                descripcion
> 
> __table_args__ = (UniqueConstraint("usuario_id", "rol_codigo"),)
> ```
>
> **Narracion:** "Cada usuario tiene roles via M:N con tabla puente `usuario_rol` protegida por `UniqueConstraint` compuesto que evita duplicados. Los endpoints se protegen con `require_roles`: `get_current_user` extrae el JWT y busca al usuario con sus roles eager-loaded. `require_roles(['ADMIN'])` verifica que el usuario tenga al menos uno de los roles requeridos. Si no: 403."
>
> **Codigo backend (15s):** Mostrar `Backend/modules/IdentidadYAcceso/Auth/dependencies.py` — `get_current_user()` y `require_roles()`. Mostrar `usuario_rol.py` — `UniqueConstraint`.
>
> **Demo (10s):** Frontend: CLIENT → navbar sin "Usuarios". ADMIN → visible. Swagger: endpoint admin sin token → 401, con CLIENT → 403, con ADMIN → 200.

---

### Slide 7 | Usuario, Rol y DireccionEntrega (0:45)

> **En pantalla:** Swagger mostrando los tags Usuarios, Roles, Direcciones de Entrega.
>
> **Narracion:** "Completan IdentidadYAcceso: CRUD de usuarios con soft delete via `is_active`, CRUD de roles protegido solo para ADMIN, y direcciones de entrega con el concepto de direccion principal — `set_principal()` desmarca la anterior y marca la nueva en una unica transaccion. Solo una direccion principal por usuario a la vez."
>
> **Codigo backend (10s):** Mostrar `Backend/modules/IdentidadYAcceso/DireccionEntrega/service.py` — `set_principal()` con desmarque + marcado atomico.
>
> **Demo (10s):** Frontend: crear direccion, marcarla principal. La UI refleja el cambio inmediatamente.

---

## Bloque 3 — CatalogoDeProductos (2:15)

### Slide 8 | Categorias Jerarquicas — FK Autorreferenciante (0:45)

> **En pantalla:** Arbol + modelo:
> ```
> Bebidas (parent_id = NULL)
> ├── Bebidas Frias (parent_id = Bebidas.id)
> └── Bebidas Calientes
> ```
> ```python
> # FK a si misma
> parent_id: Optional[int] = Field(foreign_key="categoria.id")
> subcategorias: List["Categoria"] = Relationship(back_populates="parent")
> ```
>
> **Narracion:** "Las categorias usan foreign key autorreferenciante: `parent_id` apunta a `categoria.id`. NULL significa raiz. El endpoint `GET /categorias/tree` construye el arbol con relaciones recursivas de SQLAlchemy. El frontend renderiza el arbol con un componente React que se llama a si mismo para cada nivel."
>
> **Codigo backend (15s):** Mostrar `Backend/modules/CatalogoDeProductos/Categoria/models.py` — `parent_id` + `subcategorias` con `remote_side`.
>
> **Codigo frontend (10s):** Mostrar `Frontend/src/components/CategoryTreeRow.tsx` — componente recursivo.

---

### Slide 9 | Productos + Ingredientes M:N + Soft Delete + Paginacion (1:30)

> **En pantalla:** Diagrama M:N + Swagger + codigo:
> ```
> Producto ── producto_ingrediente ── Ingrediente
>   id          producto_id            id
>   nombre      ingrediente_id        nombre
>   precio_base                        es_alergeno
> ```
> ```json
> POST /productos/
> { "nombre": "Hamburguesa", "precio_base": 75.00,
>   "categoria_ids": [1, 2], "ingredientes_ids": [1, 3, 5] }
> ```
>
> **Narracion:** "Productos e Ingredientes se relacionan M:N mediante tabla puente. El endpoint `POST /productos/` acepta crear un producto con categorias e ingredientes en una sola request, todo dentro de una transaccion atomica con Unit of Work. `GET /productos/` es publico, soporta paginacion con `skip`/`limit` (maximo 500) y filtros por `categoria_id`. Aplica soft delete: `DELETE /productos/{id}` marca `deleted_at` y el producto desaparece de los listados, pero los datos siguen en la BD."
>
> **Codigo backend (15s):** Mostrar `Backend/modules/CatalogoDeProductos/Producto/service.py` — `create()` con `categoria_ids` e `ingredientes_ids`. Mostrar `CatalogoDeProductos/uow.py` — agrupa repos de Producto, Categoria e Ingrediente.
>
> **Demo (10s):** Swagger: `DELETE /productos/{id}` → 200. `GET /productos/` → el producto ya no aparece (soft-deleteado). `GET /productos/?skip=0&limit=3` → pagina 1.

---

## Bloque 4 — Ventas, Pagos y Trazabilidad (3:45)

### Slide 10 | Pedidos — FSM, Snapshots y Auto-Select Direccion (1:15)

> **En pantalla:** Diagrama FSM + snapshots:
> ```
> PENDIENTE → CONFIRMADO → EN_PREP → EN_CAMINO → ENTREGADO
>     ↓            ↓          ↓           ↓
>     └────────────┴──────────┴───────────┘──→ CANCELADO
> ```
> ```python
> # DetallePedido/models.py — snapshots congelan el valor
> nombre_snapshot: str
> precio_snapshot: Decimal
> subtotal_snap: Decimal
> 
> # Pedido/service.py — auto-select direccion principal
> if data.direccion_id is None:
>     principal = direccion_repo.get_principal(data.usuario_id)
> ```
>
> **Narracion:** "Los pedidos siguen una Maquina de Estados Finitos con transiciones definidas en `TRANSICIONES_VALIDAS`. ENTREGADO y CANCELADO son terminales. Cada transicion se registra en `HistorialEstadoPedido` — INSERT-only, sin UPDATE ni DELETE. Los detalles capturan `nombre_snapshot` y `precio_snapshot` al momento de la compra: si el producto cambia despues, el pedido conserva los valores originales. Y un detalle de UX: si no se especifica direccion de entrega, el backend busca y asigna automaticamente la direccion principal del usuario."
>
> **Codigo backend (15s):** Mostrar `Backend/modules/VentasPagosTrazabilidad/Pedido/service.py` — `TRANSICIONES_VALIDAS` y `avanzar_estado()`. Mostrar `DetallePedido/models.py` — snapshots.
>
> **Demo (10s):** Swagger: `POST /pedidos/` → 201 con estado CONFIRMADO. `PATCH /pedidos/{id}/avanzar` → 200, badge cambia.

---

### Slide 11 | Cancelacion con Motivo + Historial Append-Only (0:45)

> **En pantalla:** Swagger `PATCH /pedidos/{id}/cancelar`:
> ```json
> { "motivo": "Producto agotado" }
> ```
>
> **Narracion:** "La cancelacion requiere motivo obligatorio validado por Pydantic. No se puede cancelar en EN_PREP ni en estados terminales. Cada usuario solo cancela sus propios pedidos. `GET /pedidos/{id}/historial` devuelve trazabilidad completa: `estado_desde`, `estado_hacia`, `usuario_id`, `motivo` y flag `es_sistema` que distingue transiciones automaticas de manuales. Todo INSERT-only."
>
> **Codigo backend (10s):** Mostrar `Backend/modules/VentasPagosTrazabilidad/Pedido/router.py` — endpoint `cancelar()`. Mostrar `HistorialEstadoPedido/models.py` — `es_sistema`.
>
> **Demo (10s):** Swagger: cancelar pedido PENDIENTE → 200. Intentar cancelar EN_PREP → 400.

---

### Slide 12 | MercadoPago — Preferencia, Webhook y Redirect (1:45)

> **En pantalla:** Diagrama de flujo MP:
> ```
> Frontend → POST /pagos/crear → Backend crea preferencia MP (idempotency_key)
>   → Backend retorna URL de checkout
>   → Usuario paga en MP
>   → MP notifica por Webhook IPN → Backend verifica (responde 200 OK siempre)
>   → MP redirige al Frontend → Backend verifica de nuevo contra API de MP
>   → Backend actualiza estado del pedido
> ```
>
> **Narracion:** "Tres patas en MercadoPago. Primero, `POST /pagos/crear` registra la preferencia con `idempotency_key` (UUID unico por intento) y retorna URL de checkout. Segundo, el webhook IPN en `/pagos/webhook`: MP notifica asincronamente — siempre responde 200 OK para que MP no bloquee notificaciones. Tercero, el redirect: cuando el usuario vuelve, el frontend consulta el estado real contra la API de MP, nunca confia en la URL de retorno."
>
> **Narracion (continua):** "ACLARACION: no pudimos probar el flujo completo en produccion por un error en la integracion. La arquitectura esta correcta: `init_mp_payment()` crea la preferencia con `mercadopago.SDK`, `update_pago_status()` consulta el `payment_id` a MP, y el webhook recibe IPN con validacion HMAC. El problema estuvo en la validacion HMAC y en respuestas inconsistentes del sandbox de MP. Dejamos la arquitectura documentada: backend orquesta, MP decide, pedido refleja la verdad."
>
> **Codigo backend (15s):** Mostrar `Backend/modules/VentasPagosTrazabilidad/Pago/service.py` — `init_mp_payment()` con `idempotency_key`, `update_pago_status()` con `SDK.payment.get`.
>
> **Codigo backend (10s):** Mostrar `Backend/modules/VentasPagosTrazabilidad/Pago/router.py` — `webhook()` que responde 200 OK siempre.
>
> **Codigo frontend (10s):** Mostrar `Frontend/src/api/pagos.ts` — `crearPago()` y `verificarPago()`.

---

## Bloque 5 — WebSockets (1:30)

### Slide 13 | ConnectionManager + Rooms por Rol y Entidad (1:00)

> **En pantalla:** Diagrama del ConnectionManager:
> ```
> ConnectionManager
> ├── rooms: dict[str, set[WebSocket]]
> │   ├── "role:cocina" → {ws1, ws2, ws3}
> │   └── "order:42"    → {ws4}
> └── socket_rooms: dict[WebSocket, set[str]]  (mapa inverso)
> 
> Metodos: connect() → disconnect() → join/leave_order_room()
>           broadcast_to_role() → broadcast_to_order()
> ```
>
> **Narracion:** "WebSockets para notificaciones en tiempo real. El `ConnectionManager` tiene dos diccionarios inversos: `rooms` (que sockets en cada sala) y `socket_rooms` (en que salas esta cada socket). Al conectar, se valida JWT y roles, y se une a las rooms correspondientes. Dos estrategias: rooms por rol (`role:cocina` notifica a todo el equipo) y rooms por entidad (`order:42` notifica solo al dueno del pedido). El broadcast evita duplicados: si un admin esta en dos salas, recibe el evento una sola vez."
>
> **Codigo backend (15s):** Mostrar `Backend/core/websocket_manager.py` — `__init__` con diccionarios, `connect()` con roles, `disconnect()` con limpieza del mapa inverso, `broadcast()` sin duplicados.
>
> **Codigo backend (10s):** Mostrar `Backend/modules/VentasPagosTrazabilidad/Pedido/router.py` — `@router.websocket("/cocina/ws")` con validacion de token y bucle `receive_text()`.

---

### Slide 14 | Frontend — useWebSocket Hook (0:30)

> **En pantalla:** Extracto del hook:
> ```typescript
> // useEstadoPedidoWS.ts
> export function useEstadoPedidoWS(pedidoId: number) {
>   const { isConnected, subscribe } = useWebSocket();
>   // subscribe a order:{pedidoId}, recibe WS_PEDIDO_ESTADO_CAMBIADO
>   // actualiza estado local sin polling
> }
> ```
>
> **Narracion:** "Tres hooks WebSocket en el frontend. `useEstadoPedidoWS` subscribe al cliente a la room de su pedido. `useAdminPedidoFeed` para el panel admin. El store `wsStore` con Zustand maneja conexion y reconexion automatica con backoff exponencial."
>
> **Codigo frontend (15s):** Mostrar `Frontend/src/hooks/useEstadoPedidoWS.ts`, `useAdminPedidoFeed.ts`, y `Frontend/src/store/wsStore.ts`.

---

## Bloque 6 — Cloudinary (0:45)

### Slide 15 | Upload de Imagenes y Validaciones (0:45)

> **En pantalla:** Swagger `POST /api/v1/uploads/image` (multipart/form-data).
>
> **Narracion:** "Cloudinary para imagenes. El endpoint recibe archivos via FormData. El servicio valida: solo JPEG, PNG, GIF, WebP; maximo 10 MB. Usa `public_id` como identificador. La respuesta incluye `url`, `width`, `height`, `bytes`. `DELETE /uploads/image/{public_id}` elimina de Cloudinary. El frontend usa input `type=file` con `multiple` y un carrusel por producto."
>
> **Codigo backend (10s):** Mostrar `Backend/modules/Uploads/service.py` — `upload_image()` con `ALLOWED_CONTENT_TYPES` y `MAX_FILE_SIZE`.
>
> **Codigo frontend (10s):** Mostrar `Frontend/src/api/uploads.ts` — `uploadImages(files)` con FormData.

---

## Bloque 7 — Estadisticas (0:45)

### Slide 16 | Decimal, CANCELADO Excluido, Recharts (0:45)

> **En pantalla:** Swagger con 5 endpoints ADMIN-only + grafico Recharts.
>
> **Narracion:** "Estadisticas: 5 endpoints solo para ADMIN. Todos los montos en `Decimal` — nunca `float` para dinero. CANCELADO excluido de todos los calculos. Ingresos solo con `mp_status='Approved'`. Precios via `subtotal_snap` de `DetallePedido` (historicos correctos). Filtros de periodo con `desde`/`hasta` como `date`. Frontend: Recharts con `<BarChart>`, `<PieChart>` y tablas para productos top."
>
> **Codigo backend (10s):** Mostrar `Backend/modules/Estadisticas/repository.py` — queries con `func.sum()` y filtros CANCELADO + Approved.
>
> **Codigo frontend (10s):** Mostrar `Frontend/src/pages/EstadisticasPage.tsx` — componentes Recharts.

---

## Bloque 8 — Tests (1:30)

### Slide 17 | Infraestructura conftest.py (0:45)

> **En pantalla:** Arbol de `Backend/tests/` (9 archivos):
> ```
> Backend/tests/
> ├── conftest.py                    ← Fixtures globales
> ├── test_identidad_acceso.py       ← 38 tests
> ├── test_catalogo_productos.py     ← 21 tests
> ├── test_pedidos.py                ← 16 tests
> ├── test_catalogos_pedido.py       ← 11 tests
> ├── test_estadisticas.py           ← 42 tests
> ├── test_cloudinary_uploads.py     ← 12 tests
> ├── test_pago_service.py           ← 8 tests
> └── test_historial_estado_pedido_service.py ← 5 tests
> ```
>
> **Narracion:** "143 tests en total. `conftest.py` es la columna vertebral: engine SQLite en memoria con `StaticPool`, sesiones transaccionales con rollback automatico por test, TestClient de FastAPI con `get_session` sobreescrito, helpers JWT para generar headers de autenticacion por rol, y factories para crear Productos, Pedidos, Categorias e Ingredientes en BD de test."
>
> **Codigo backend (15s):** Mostrar `Backend/tests/conftest.py` — fixture `engine` con `create_all()`, fixture `db_session` con rollback, fixture `client` con lifespan override, helper `_create_auth_headers()`.

---

### Slide 18 | 143 Tests — Todos los Modulos con 5+ (0:45)

> **En pantalla:** Tabla de cobertura:
> ```
> Modulo              Tests   Tipo
> Auth                 16     Integracion TestClient
> Usuario               8     Integracion
> Rol                   5     Integracion
> DireccionEntrega      7     Integracion
> Categoria             7     Integracion
> Producto              7     Integracion
> Ingrediente           7     Integracion
> Pedido               16     Integracion
> EstadoPedido          5     Integracion
> FormaPago             6     Integracion
> Estadisticas         42     Mixto
> Cloudinary           12     Unit MagicMock
> Pago                  8     Unit MagicMock
> HistorialEstado       5     Unit MagicMock
> ```
>
> **Narracion:** "Cada modulo tiene minimo 5 tests. Dos capas: integracion con `TestClient` para endpoints REST (flujo HTTP hasta BD en memoria), y unitarios con `MagicMock` para servicios con APIs externas. Los tests de Pedidos cubren toda la FSM: creacion, avance valido, rechazo de terminal, cancelacion con motivo, historial append-only. Los de Auth: register, login, credenciales invalidas, logout, refresh rotation, y RBAC con 401/403."
>
> **Demo (15s):** Terminal corriendo `pytest Backend/tests/ -v` — 143 tests en verde.

---

## Bloque 9 — Frontend como Consumidor (2:30)

### Slide 19 | Feature Sliced + API Layer + Axios Interceptor (1:00)

> **En pantalla:** Arbol frontend:
> ```
> Frontend/src/
> ├── api/           ← client.ts, pedidos.ts, auth.ts...
> ├── components/    ← Botones, cards, formularios...
> ├── hooks/         ← useWebSocket, useAppForm...
> ├── pages/         ← Paginas por feature
> ├── store/         ← Zustand: auth, cart, ws
> ├── types/         ← Interfaces TypeScript
> └── utils/         ← Helpers
> ```
>
> **Narracion:** "Frontend feature-sliced: cada carpeta tiene una responsabilidad. `api/` contiene el cliente HTTP con Axios y un interceptor de refresh token: cuando el backend responde 401, el interceptor atrapa el error, llama a `/auth/refresh` con la cookie httpOnly, obtiene nuevo token, y reintenta la request original. `apiFetch<T>` es un wrapper generico que tipa la respuesta con interfaces de `types/`."
>
> **Codigo frontend (15s):** Mostrar `Frontend/src/api/client.ts` — response interceptor con `failedQueue`, `isRefreshing`, `processQueue`. Mostrar `apiFetch<T>()`.
>
> **Codigo frontend (10s):** Mostrar `Frontend/src/api/pedidos.ts` — interfaces `Pedido`, `DetallePedido` y metodos.

---

### Slide 20 | Zustand + TanStack + React Router Protegido (1:00)

> **En pantalla:** Extractos de stores y rutas.
>
> **Narracion:** "Zustand para estado global: `authStore` (usuario + roles), `cartStore` (carrito), `wsStore` (conexion WebSocket). TanStack Form para formularios tipados con validacion. React Router con rutas protegidas: `App.tsx` define condiciones como `{canSeeFullNav && <Route .../>}` que espejan los permisos RBAC del backend. Si alguien modifica el frontend, el backend igual frena con `require_roles`."
>
> **Codigo frontend (10s):** Mostrar `Frontend/src/store/authStore.ts` — Zustand store con `user`, `roles`, `login()`.
>
> **Codigo frontend (10s):** Mostrar `Frontend/src/App.tsx` — condiciones de ruta por roles.
>
> **Demo (10s):** CLIENT → navbar sin "Usuarios" ni "Estadisticas". ADMIN → todo visible.

---

### Slide 21 | Diseno Consistente con Tailwind (0:30)

> **En pantalla:** Capturas: dashboard, productos, pedidos — consistencia visual.
>
> **Narracion:** "Tailwind CSS 4 para todo el diseno. Misma paleta, mismos espaciados, mismos componentes en todas las paginas. Unica deuda tecnica: skeleton loaders mobile-first — los estados de carga en mobile no estan tan pulidos como en desktop. Es un fix chico que no compromete estabilidad: agregar componentes `<Skeleton>` con Tailwind."
>
> **Demo (10s):** Mostrar responsive: misma pagina en desktop y mobile. Senalar la diferencia en carga.

---

## Bloque 10 — Cierre (1:00)

### Slide 22 | Resumen — Backend como Fuente de Verdad (1:00)

> **En pantalla:** Diagrama final + stack completo:
> ```
> [PostgreSQL] ← [SQLModel ORM]
>                    ↑
>              [Service Layer]    ← reglas de negocio
>                    ↑
>              [REST API]         ← contratos Pydantic
>                    ↑
>              [HTTP/JSON]        ← cualquier cliente
>                    ↑
>           ┌────────┴────────┐
>        [React]          [Swagger UI]
> ```
> Stack: FastAPI + SQLModel + PostgreSQL | JWT + bcrypt + RBAC | constraints + soft delete + snapshots | Repository generico + UoW | WebSockets con rooms | MercadoPago (preferencia + webhook) | Cloudinary (upload + validaciones) | 143 tests en 11 modulos | React 19 + TypeScript + Zustand + TanStack + Tailwind
>
> **Narracion:** "Todo arranca en la base de datos y sube hasta el cliente. La API REST es el contrato unico — React, mobile, Postman la consumen igual. El backend concentra reglas de negocio, validaciones, y seguridad. El frontend es una de las caras de la API. Eso es lo que construimos: un sistema donde el backend es la fuente de verdad."

---

## Notas para el presentador

- **Ritmo:** ~55s por slide en promedio. Slides densos (2, 10, 12) ~1:15, slides ligeros (7, 15, 16, 21) ~0:35-0:45.
- **Codigo backend:** NO leas linea por linea. Senala estructura (clase, metodo, decorador) y explica el proposito. El publico ve el archivo, vos explicas que hace.
- **Demo frontend:** Es el "escaparate" del backend. Mostralo para ver como se consume la API, no para explicar React.
- **Swagger como respaldo:** Si el frontend falla, abri `/docs` y mostra los endpoints directamente. Tene Swagger y ReDoc abiertos en otras pestanas.
- **Preparacion antes de grabar:**
  - Deja logueado un ADMIN (admin@email.com / admin123) en el frontend.
  - En Swagger, hace login y pega el token en "Authorize" para no perder tiempo.
  - Backend corriendo (`uvicorn main:app --reload`) y BD con datos de seed.
  - Si usas Docker: `docker-compose up` levanta todo.
- **MercadoPago:** Se honesto y tecnico. Explica la arquitectura, mostra el codigo, y despues conta que paso. Demostra que entendes el problema.
- **Tiempo total:** 22 slides × ~55s = ~20 minutos. Si te excedes, acorta los bloques de Frontend (9) — lo importante es el backend.
- **Practica:** Lee la narracion en voz alta al menos una vez. Las secciones densas (FSM, WebSockets, MP) necesitan practica.
