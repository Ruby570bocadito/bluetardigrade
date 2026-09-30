"use client";

import { useEffect, useRef } from "react";

/**
 * Green dotted particle wave — a perspective dot-terrain that undulates
 * like the hero visual of premium dark agency sites.
 */
export default function ParticleWave({
  className = "",
  density = 1,
}: {
  className?: string;
  density?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const raf = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const ROWS = Math.max(18, Math.round(26 * density));
    const start = performance.now();

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, w, h);

      const horizon = h * 0.18;
      const gap = Math.max(10, Math.round(w / 110)); // horizontal dot spacing

      for (let i = 0; i < ROWS; i++) {
        const p = i / (ROWS - 1); // 0 at horizon, 1 at front
        const baseY = horizon + Math.pow(p, 1.6) * (h - horizon);
        const amp = 6 + p * 26;
        const speed = t * (0.5 + p * 0.35);

        for (let x = -gap; x <= w + gap; x += gap) {
          const y =
            baseY +
            Math.sin(x * 0.008 + speed * 1.4 + i * 0.32) * amp * 0.6 +
            Math.sin(x * 0.0035 - speed + i * 0.18) * amp;

          // green that brightens towards the front + shimmer on peaks
          const alpha = 0.05 + p * 0.5;
          const peak = 0.5 + 0.5 * Math.sin(x * 0.008 + speed * 1.4 + i * 0.32);
          const g = Math.round(150 + peak * 80);
          const size = 0.7 + p * 1.5;

          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${Math.round(g * 0.55)}, ${g}, ${Math.round(
            g * 0.45
          )}, ${alpha.toFixed(3)})`;
          ctx.fill();
        }
      }
      raf.current = requestAnimationFrame(draw);
    };

    raf.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf.current);
      ro.disconnect();
    };
  }, [density]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      style={{ display: "block" }}
    />
  );
}
