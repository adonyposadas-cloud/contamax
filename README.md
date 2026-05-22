# CONTAMAX · Sistema Contable

Sistema contable a medida para **Tecnimax** — grupo empresarial en Honduras con 4 centros de costo.

## Stack
- **Frontend**: HTML / CSS / JS vanilla (tema oscuro)
- **Backend**: Supabase (PostgreSQL) — Plan Pro
- **Auth**: Supabase Auth (email/password)
- **Storage**: Bucket `facturas-compras`

## Estructura
```
contamax/
├── index.html          ← Punto de entrada
├── css/
│   └── styles.css      ← Estilos globales
├── js/
│   └── app.js          ← Lógica principal (módulos, auth, Supabase)
├── docs/
│   └── RESUMEN.md      ← Documentación del proyecto
└── sql/
    └── migracion_caja.sql  ← SQL para módulo de Caja General
```

## Módulos
- ✅ Login con Supabase Auth
- ✅ Gestión de usuarios (4 roles)
- ✅ Registro de compras + foto de factura
- ✅ Facturas pendientes
- ✅ Catálogo de cuentas (555 cuentas)
- ✅ Partidas contables (Debe/Haber, fiscal, centro de costo)
- ✅ Control de Caja General (aprobación de entregas)
- 🔲 Importar reportes (Alpha, Taxis)
- 🔲 Reportes financieros
- 🔲 RLS de seguridad

## Deploy
Abrir `index.html` en navegador o deploy estático en Netlify/Vercel.

## Desarrollo
No requiere build. Editar archivos y refrescar el navegador.
