# bluetardigrade — Website

Sitio web oficial del proyecto: **Real-time threat detection for Windows endpoints**.

Landing page (Next.js 16 + Tailwind CSS 4 + shadcn/ui) con:

- **Hero** con onda de partículas animada (canvas)
- **Stats** del pipeline con contadores animados
- **Why** — las tres apuestas del proyecto + la regla de oro
- **Arquitectura** end-to-end (sensor Rust → motor Go → consola) con diagrama
- **Features** — todo lo que incluye el binario único
- **Console preview** — el dashboard de alertas del operador
- **Quickstart** — dos comandos hasta la primera alerta
- **Comparación honesta** (qué es / qué no es), **Roadmap** y **FAQ**

## Desarrollo

```bash
cd website
bun install        # el lockfile del paquete es bun.lock (único, sin deriva)
bun run dev        # http://localhost:3000
```

## Producción

```bash
bun run build
bun run start
```

## GitHub Pages

La misma web se publica como estática en
<https://ruby570bocadito.github.io/bluetardigrade/> con el workflow
`.github/workflows/pages.yml`, en cada cambio de `website/` en `main` (o a
mano desde Actions). Para probar la exportación en local:

```bash
PAGES_BASE_PATH=/bluetardigrade bun run build:pages   # deja el sitio en out/
```

Pages no envía cabeceras propias: la política CSP viaja como `<meta>` en la
página (sin `frame-ancestors`, que solo funciona como cabecera).

## Notas

- Tema oscuro, tipografía Instrument Serif (display) + Geist (texto)
- Sin datos simulados en el camino del producto: todas las métricas mostradas son medidas
- Licencia del proyecto: Apache-2.0
