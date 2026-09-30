# security-framework — Website

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
bun install        # o npm install
bun run dev        # http://localhost:3000
```

## Producción

```bash
bun run build
bun run start
```

## Notas

- Tema oscuro, tipografía Instrument Serif (display) + Geist (texto)
- Sin datos simulados en el camino del producto: todas las métricas mostradas son medidas
- Licencia del proyecto: Apache-2.0
