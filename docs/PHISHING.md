# Detección de phishing en correo EML

El collector importa un correo `.eml` observado y el motor evalúa sus indicadores.
El análisis es local: no abre enlaces, resuelve DNS, consulta reputación, ejecuta
adjuntos ni envía el correo a un modelo. Las alertas describen propiedades
comprobables y requieren triaje; ninguna afirma que el remitente sea auténtico o
que el mensaje contenga malware.

```powershell
# Ver primero los indicadores, sin conectar al motor:
sf-collector -source eml -file .\correo.eml -observer MAIL-GATEWAY -stdout

# Enviar la observación al motor local y ver sus alertas en la consola:
sf-collector -source eml -file .\correo.eml -observer MAIL-GATEWAY
```

El importador conserva el SHA-256 del EML original, remitente, asunto,
Message-ID, fecha declarada e instante de importación. El cuerpo y los bytes de
los adjuntos no se copian a la telemetría. Las URL observadas omiten userinfo,
query y fragmento; la evidencia de enlaces engañosos contiene solo hostnames.
Conservar el archivo original por separado permite revisar esos límites.

## Señales disponibles

| Indicador | Regla | Interpretación y límites |
|---|---|---|
| Extensión ejecutable o script | `soc-mail-risky-attachment` | Nombre de adjunto activo; no se ejecuta ni analiza su contenido. |
| `dmarc=fail` en Authentication-Results | `soc-mail-dmarc-fail` | Resultado declarado en una cabecera no verificada. Validarlo en un gateway de confianza. |
| URL HTTP(S) con IP literal | `soc-mail-ip-url` | Destino numérico observado; no implica reputación maliciosa. |
| From y Reply-To de distintos dominios | `soc-mail-reply-mismatch` | Señal débil; servicios legítimos también la presentan. |
| Texto completo de un enlace HTTP(S) apunta a un host distinto de `href` | `soc-mail-html-link-mismatch` | Evidencia `host mostrado -> host destino`. Trackers, redirects y subdominios legítimos pueden diferir. Severidad baja. |
| URL con userinfo antes de `@` | `soc-mail-url-credentials` | Puede presentar `dominio-confiable@otro-host`; comprobar el hostname real. |
| Hostname con etiqueta `xn--` | `soc-mail-url-punycode` | Dominio internacionalizado, alerta informativa. No calcula similitud con marcas ni afirma homografía. |
| Adjunto Office compatible con macros | `soc-mail-macro-attachment` | Extensión `.docm`, `.dotm`, `.xlsm`, `.xltm`, `.xlam`, `.xlsb`, `.pptm`, `.potm`, `.ppam` o `.sldm`. No verifica que existan macros. |
| Doble extensión documento/imagen + ejecutable/script | `soc-mail-double-extension` | Por ejemplo `factura.pdf.exe` o `imagen.jpg.lnk`. Revisar el nombre completo. |
| RIGHT-TO-LEFT OVERRIDE en nombre de adjunto | `soc-mail-bidi-filename` | U+202E puede invertir visualmente la extensión. Revisar el nombre original. |

Las seis reglas nuevas están en `rules/integrations/phishing.yaml`; las cuatro
señales originales permanecen en `rules/integrations/soc.yaml`. El pack total
contiene 75 reglas habilitadas. Se pueden suprimir alertas conocidas mediante
el flujo normal de supresiones y ajustar las reglas YAML al entorno.

## Cobertura

Se descodifican MIME text/plain y text/html en UTF-8/ASCII, con base64 o
quoted-printable. El scanner HTML reconoce enlaces explícitos y entidades, no
renderiza el documento ni evalúa JavaScript/CSS; no puede conocer el destino
final de una redirección. Ignora comentarios y script/style al comparar enlaces.
El contenido textual de un enlace debe ser una URL HTTP(S) completa; etiquetas
como «Iniciar sesión», enlaces relativos y contenido dinámico no permiten esa
comparación. Los hostnames se comparan exactamente tras normalizar mayúsculas y
el punto final, sin inferir identidad corporativa o dominio registrable.

Límites: EML de 10 MiB, cabeceras de 64 KiB, 100 partes MIME, 10 niveles, 256 KiB
por texto y 1 MiB total de texto descodificado. Se inspeccionan hasta 100 enlaces
HTML por parte y se conservan hasta 100 URL únicas y 20 pares de hostnames
distintos. El atributo `mail_parts_not_inspected=true` hace visible una inspección
incompleta. Los archivos comprimidos se marcan sin abrirlos.

Esto añade inspección EML, no un buzón monitorizado automáticamente. Para correo
en producción se necesita una exportación o integración explícita con el
gateway/proveedor, y preservar la procedencia de Authentication-Results.

## Verificación

```powershell
go test ./internal/collector ./internal/rules
```

Las pruebas usan MIME inerte y comprueban señales positivas, correo benigno,
codificaciones, redacción de secretos, límites y reglas contra eventos producidos
por el decodificador real. No se visita ningún dominio ni se ejecuta un ataque.
