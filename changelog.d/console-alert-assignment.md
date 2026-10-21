- **La consola reparte las alertas (TEAM-3).** La cola gana una lente de
  asignación («Mis alertas» y «Sin asignar», además de toda asignación), un
  chip de responsable en cada fila y un bloque de asignación en el detalle:
  tomársela, asignarla a otro analista o reasignarla/quitarla. La barra de
  selección gana «Asignar» en lote (tope 500 del motor, con los fallos por
  id listados en el diálogo). Todo viaja por las rutas del M-1
  (`POST /api/alerts/{id}/assign`, `POST /api/alerts/assign-batch`), se
  filtra en consola sobre el anillo en vivo y las páginas del histórico (el
  objeto Alert lleva el trío en ambas vías) y se actualiza en vivo con el
  tema `alert_lifecycle`, cuyo payload ahora incluye el trío
  `assignee`/`assigned_by`/`assigned_at`. Con esto TEAM-3 queda cerrado de
  punta a punta: motor (M-1, PR #45) y consola (C-2).
