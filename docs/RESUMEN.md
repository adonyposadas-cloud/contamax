# CONTAMAX — Sistema Contable · Resumen del Proyecto

## Contexto General
Sistema contable a medida para **Tecnimax**, un grupo empresarial en Honduras que incluye 4 unidades de negocio manejadas como **centros de costo**: Tecnicentro (taller mecánico), Yonker (repuestos usados), Taxis (flota de taxis) y Autolote (compra/venta de vehículos).

La contabilidad es **corporativa** bajo Tecnimax, con **dos libros simultáneos**:
- **Libro interno**: todas las transacciones (control gerencial)
- **Libro fiscal**: solo las marcadas con checkbox "aplica_fiscal" (declaraciones SAR Honduras)

## Stack Tecnológico
- **Base de datos**: Supabase (PostgreSQL) — Plan Pro
- **Proyecto**: `contamax-produccion`
- **URL**: `https://icghaqhtvutwlkhtotyv.supabase.co`
- **Region**: East US (N. Virginia)
- **Frontend**: HTML/CSS/JS vanilla, estilo oscuro profesional (similar a Tecnimax/Taller Alpha)
- **Auth**: Supabase Auth con email/password
- **Storage**: Bucket `facturas-compras` (privado, 10MB max, solo JPG/PNG/WEBP/PDF)
- **API Key**: Usar la **Legacy anon key** (empieza con `eyJ...`), NO la publishable key (`sb_publishable_...`)
- **RLS**: Actualmente DESACTIVADO en todas las tablas para desarrollo. Debe re-activarse antes de producción.

## Nota importante sobre API Keys
Supabase tiene nuevo formato de keys. La `sb_publishable_` NO funciona con el cliente JS `@supabase/supabase-js`. Usar siempre la key de la pestaña **"Legacy anon, service_role API keys"** en Settings → API.

## Roles del Sistema
| Rol | Acceso |
|---|---|
| `super_admin` | Todo. Único que puede crear usuarios. Control de Caja General |
| `contador` | Todos los módulos contables, partidas, reportes |
| `aux_contable` | Ve facturas, puede editar datos y fotos de facturas pendientes, ve catálogo y partidas |
| `compras` | Solo ve: registrar compra + sus facturas pendientes. Acceso a todas las empresas |

## Usuarios Actuales
- **Adony Posadas** — `adonyposadas@yahoo.es` — `super_admin` — Todas las empresas
- **Adonis Posadas** — `aposadas310@gmail.com` — `compras` — Todas las empresas

## Estructura de Base de Datos

### Tablas principales:
```
centros_costo (antes "empresas")
├── id, nombre, rtn, codigo (TECH/YONK/TAXI/AUTO/TMAX), activa, tipo, es_corporativo
├── Tecnimax es_corporativo=true (entidad padre)
└── Los 4 centros son es_corporativo=false

usuarios
├── id, auth_user_id (FK auth.users), nombre, email, rol, centro_costo_id (nullable = todas), activo

proveedores
├── id, nombre, rtn, telefono, email, activo

catalogo_cuentas (555 cuentas cargadas del sistema anterior)
├── id, codigo, nombre, tipo (activo/pasivo/capital/ingreso/gasto/costo)
├── naturaleza (deudora/acreedora), nivel (1-5), cuenta_padre, es_detalle, activa
├── Formato de códigos: 1, 11, 1101, 110101, 110101-001
└── Importado de sistema anterior (Maatwebsite Excel)

facturas_compras
├── id, centro_costo_id, proveedor_id, registrado_por, foto_reemplazada_por
├── numero_factura, cai, fecha_factura, tipo_gasto, forma_pago (contado/credito/tarjeta)
├── banco, numero_cheque, subtotal, isv, total, foto_url, estado (pendiente/procesada/rechazada)
└── observaciones. Moneda: solo Lempiras (L.)

partidas_contables
├── id, centro_costo_id (nullable), generada_por, factura_id (nullable)
├── tipo_origen (compra/venta_alpha/entrega_taxi/gasto_autolote)
├── numero_documento (nuevo), descripcion, fecha_partida, numero_partida (serial)
├── estado (borrador/aprobada/rechazada), total
└── aprobada_at, aprobada_por

lineas_partida
├── id, partida_id, cuenta_id, cuenta_codigo, cuenta_nombre
├── tipo (debito/credito), monto, centro_costo_id (nullable)
├── descripcion (se copia del encabezado de la partida)
├── numero_documento (se copia del encabezado)
└── aplica_fiscal (boolean — checkbox que separa libro interno de fiscal)

periodos_contables
├── id, anio, mes, estado (abierto/cerrado), cerrado_por, cerrado_at
```

### Vistas SQL creadas:
- `v_libro_diario_interno` — todas las líneas de partidas
- `v_libro_diario_fiscal` — solo líneas con aplica_fiscal=true
- `v_balance_centro_costo` — balance agrupado por centro de costo

## Reglas de Negocio Implementadas

### Centro de costo obligatorio:
- Cuentas de tipo `gasto`, `ingreso`, `costo` → centro de costo **OBLIGATORIO**
- Cuentas de tipo `activo`, `pasivo`, `capital` → centro de costo **OPCIONAL**
- Validación en frontend antes de guardar partida

### Facturas de compras:
- Usuario de `compras` sube foto y llena datos generales
- `aux_contable` puede editar datos + reemplazar foto mientras estado = `pendiente`
- Una vez `procesada`, solo contador/super_admin pueden editar
- ISV se calcula automáticamente al 15%

### Partidas contables:
- Formato Debe/Haber en columnas separadas (sin selector D/C)
- Número de documento y descripción del encabezado se graban en CADA línea
- Esto permite buscar por número de documento y encontrar todas las cuentas afectadas
- Guardar como borrador (no requiere cuadre) o Aprobar (requiere débitos = créditos)
- Buscador de cuentas con filtrado en tiempo real del catálogo

## Módulos Funcionando
1. ✅ Login con Supabase Auth
2. ✅ Gestión de usuarios (crear, ver, roles)
3. ✅ Registro de compras (formulario + foto + ISV automático)
4. ✅ Facturas pendientes (lista con estados)
5. ✅ Catálogo de cuentas (árbol jerárquico, filtros, buscar, crear, editar, eliminar)
6. ✅ Partidas contables (crear, listar, Debe/Haber, fiscal checkbox, centro de costo)

## Módulos Pendientes (en orden de prioridad)

### 1. Control de Caja General (SIGUIENTE)
- Solo Super Admin puede hacer egresos de Caja General (créditos)
- Otros usuarios pueden registrar ingresos a Caja General (débitos) pero quedan como "pendiente_caja"
- Super Admin ve notificación estilo "Facturas Pendientes" con entregas pendientes de aprobar
- Super Admin aprueba → partida pasa a "aprobada"
- Esto protege el efectivo a cargo del Super Admin

### 2. Importar reportes
- CSV/Excel de Taller Alpha (ventas y compras del día anterior)
- Google Sheets de Taxis (entregas diarias de conductores)
- Generar partidas automáticamente desde estos reportes

### 3. Reportes financieros
- Balance general (interno y fiscal)
- Estado de resultados (interno y fiscal)
- Reportes por centro de costo
- Auxiliar de cuentas con búsqueda por número de documento

### 4. Hosting en producción
- Subir a Vercel o Netlify (gratis)
- Dominio personalizado si lo desean

### 5. Seguridad (RLS)
- Re-activar Row Level Security con políticas corregidas
- Crear políticas que funcionen con el esquema actual (centros_costo, no empresas)

## Archivos del Proyecto
- `contamax.html` — Frontend completo (archivo único HTML con CSS+JS embebido)
- `contamax_schema.sql` — Schema original de base de datos
- `migracion_centros_costo.sql` — Migración a centros de costo + doble contabilidad
- `carga_catalogo_556.sql` — Carga masiva de 555 cuentas del catálogo

## Decisiones de Diseño Importantes
1. Las "empresas" son centros de costo bajo Tecnimax (contabilidad corporativa)
2. Una sola cuenta de gasto (ej: Combustible) sirve para todos los centros — el centro de costo se asigna por línea de partida, no por cuenta
3. El checkbox "aplica_fiscal" está a nivel de LÍNEA, no de partida — así una partida puede tener líneas fiscales y no fiscales mezcladas
4. El número de documento se graba en cada línea para facilitar búsquedas en auxiliares
5. La descripción del encabezado se copia a cada línea del auxiliar
6. Moneda única: Lempiras (L.)
7. Formas de pago: contado, crédito, tarjeta de crédito

## Para continuar el desarrollo
El archivo HTML actual tiene todo el frontend. Para agregar módulos nuevos:
1. Agregar nav-item en el sidebar
2. Agregar la vista HTML dentro de `.content`
3. Agregar funciones JavaScript al final del `<script type="module">`
4. Actualizar `showView()` para cargar datos del nuevo módulo
5. Si hay nuevas tablas, ejecutar SQL en Supabase + grants + notify pgrst
