## Docs: la cifra de reglas pasa de 114 a 119 en toda la documentación

Barrido del hallazgo H-002 de TEST: el motor carga 119 reglas locales
(`engine doctor` y `/api/stats` lo confirman; verificado además con
`rg -c '^- name:' rules/`), pero la documentación seguía anclada en
114. Actualizados README (What you get), PHISHING, INSTALACION-Y-
ESTADO-SOC, ARCHITECTURE, OPERATIONS (ranura 119 de 2048) y
docs/ROADMAP, que además llevaba «11 cadenas» cuando hay 13. En
SOC-INTEGRACIONES-E-INFORMES la narración histórica (55 → 75 → 114)
se conserva tal cual y se añade la cifra vigente. El «114 pruebas de
consola» de INVESTIGACION-CLI-Y-TRIAJE es otra métrica y no se toca.
