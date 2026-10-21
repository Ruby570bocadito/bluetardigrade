- **Aviso de sensores desactualizados en Equipos (C-5).** El latido ya
  trae la versión del sensor y el motor publica la suya en /api/stats;
  la consola compara ambas y avisa cuando difieren: chip ámbar en las
  filas del índice de Equipos y en la tarjeta del sensor, banda ámbar
  en la ficha del equipo con las dos versiones y cómo actualizar
  (security-sensor.exe de esta instalación), y recuento en el mosaico
  del inventario. Criterio honesto: desactualizado = «no coincide con
  la del motor», sin jerarquías semver inventadas; si el motor no
  publica versión o el sensor no declara la suya (latido antiguo,
  importación), no hay aviso. Helper puro en lib/fleet con su suite.
