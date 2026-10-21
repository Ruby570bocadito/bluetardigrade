- **El lote de asignación respeta el techo real del motor.** El motor
  anuncia 500 ids para `POST /api/alerts/assign-batch`, pero su cap de
  cuerpo de 8 KiB (~19 bytes por id) es el techo efectivo: un lote de
  entre ~430 y 500 ids moría con 413 antes de llegar a la comprobación
  del 500 (hallazgo de SEG). El cliente ahora corta a 400
  (`MAX_ASSIGN_BATCH_IDS`), de modo que una selección gigante se
  degrada en dos lotes que siempre caben — con `assignee` y `by` en su
  máximo de 200 caracteres incluidos — y hay regresión que fija la
  aritmética del cuerpo completo bajo 8192 bytes.
