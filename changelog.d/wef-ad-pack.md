## Motor: pack AD de WEF — los IDs del controlador de dominio ya disparan detecciones (M-7)

Primera mitad del punto M-7 (TODO F3): las reglas que consumen los IDs
de Seguridad/System que la suscripción WEF reenvía desde controladores
de dominio y servidores. Los registros llegan como un tipo de evento
nuevo, `windows.event` (`pkg/model`; añadido al enum del OpenAPI), con
el equipo ORIGEN en `host` y los campos semánticos en `attributes`
bajo el espacio `win_*` — el contrato por ID está documentado en la
sección «Entrega al motor» de docs/AD-WEF-SUSCRIPCION.md, el hueco que
la propia guía reservaba para M-7.

`rules/windows/wef-security.yaml` (4 reglas): DCSync (4662 con GUIDs
de replicación DRSUAPI y cuenta no-máquina, critical),
Kerberoasting (4769 con cifrado RC4 0x17, high), alta en grupo
privilegiado (4728/4732/4756 con nombres de la familia de
administración en inglés o español, excluyendo cuentas máquina, high)
y servicio nuevo con intérprete o ruta escribible (7045, high). El
7045 genérico y el 4625 por evento quedan fuera a propósito (misma
doctrina de falsos positivos que el pack de endpoint): el rociado de
contraseñas es volumétrico y vive en `thresholds.yaml`
(`thr-ad-spray`: 25 fallos en 5 minutos agrupados por IP de origen,
medium). El pack sube el inventario a 123 reglas y 13 tipos de
evento; la prosa que cita la cifra 119 queda anotada a PUL.
