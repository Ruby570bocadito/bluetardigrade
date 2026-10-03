'use client'

// Process tree of a forensic bundle (EDR "storyline" view): nested lists
// with elbow connectors drawn in CSS. The process that raised the alert
// carries the accent and a label; parents captured only by name are
// marked as outside the window. Rows enter in cascade (React Bits
// AnimatedItem) and stay static under reduced motion.

import { GearSix, Warning } from '@phosphor-icons/react'
import { AnimatedItem } from '@/components/reactbits/animated-list'
import type { ProcessNode } from '@/lib/entity-graph'
import { formatTime } from '@/lib/console-types'

const MAX_ROWS = 60

export function ProcessTree({ roots, label = 'Árbol de procesos' }: { roots: ProcessNode[]; label?: string }) {
  let budget = MAX_ROWS
  let index = 0
  let hidden = 0

  const render = (nodes: ProcessNode[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      if (budget <= 0) {
        hidden += 1 + count(node.children)
        return null
      }
      budget--
      const order = index++
      return (
        <li key={`${node.pid}:${node.name}:${node.timestamp ?? ''}`} className={depth > 0 ? 'relative pl-5 before:absolute before:left-[9px] before:top-0 before:h-[18px] before:w-[10px] before:rounded-bl-md before:border-b before:border-l before:border-zinc-700' : ''}>
          <AnimatedItem index={order}>
            <div
              className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-1 ${
                node.focus ? 'border border-red-400/30 bg-red-500/[0.08]' : node.external ? 'opacity-70' : ''
              }`}
              title={node.commandLine ?? node.name}
            >
              {node.focus ? (
                <Warning size={13} weight="fill" aria-hidden className="shrink-0 text-red-300" />
              ) : (
                <GearSix size={13} aria-hidden className={`shrink-0 ${node.external ? 'text-zinc-600' : 'text-violet-300/80'}`} />
              )}
              <span className={`shrink-0 font-mono text-[11px] ${node.focus ? 'font-semibold text-zinc-50' : 'text-zinc-200'}`}>{node.name}</span>
              {node.external ? (
                <span className="shrink-0 text-[10px] text-zinc-500">padre fuera de la ventana</span>
              ) : (
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-500">pid {node.pid}</span>
              )}
              {node.focus && <span className="shrink-0 rounded bg-red-500/15 px-1 text-[10px] text-red-200">disparó la alerta</span>}
              {node.commandLine && <span className="min-w-0 truncate font-mono text-[10px] text-zinc-500">{node.commandLine}</span>}
              {node.timestamp && <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-zinc-600">{formatTime(node.timestamp)}</span>}
            </div>
          </AnimatedItem>
          {node.children.length > 0 && (
            <ul className="relative ml-[9px] border-l border-zinc-800">{render(node.children, depth + 1)}</ul>
          )}
        </li>
      )
    })

  const tree = render(roots, 0)
  return (
    <div className="min-w-0 overflow-x-auto">
      <ul aria-label={label} className="min-w-[420px] space-y-0.5">{tree}</ul>
      {hidden > 0 && <p className="mt-1 text-[10px] text-zinc-500">{hidden} procesos más en el bundle (ver la línea de tiempo o la exportación).</p>}
    </div>
  )
}

function count(nodes: ProcessNode[]): number {
  return nodes.reduce((n, c) => n + 1 + count(c.children), 0)
}
