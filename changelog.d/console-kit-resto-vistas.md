- **El kit POL-7 llega al resto de vistas.** Incidentes, Equipos,
  Directorio, Informes, Supresiones, Intel y Ruido montan sus controles
  sobre los primitivos compartidos (botón, campo, selección, tabla,
  pestañas). El kit gana la variante `solid` del botón (el relleno de
  acento `--primary-strong` que las vistas repetían a mano, regla
  THEME-2) y un primitivo `Textarea` con el mismo perfil de tokens que
  `Input`; el conmutador de tipos del explorador de directorio pasa a
  `ConsoleTablist` (tablist con roving tabindex del patrón WAI-ARIA) y
  las tablas de datos que quedaban a mano usan los primitivos `Table*`
  con caption propio (en la hoja imprimible el caption se mantiene
  visible a propósito: etiqueta la tabla en papel). Sin cambios de
  comportamiento; validado con la suite de consola, tsc y next build.
