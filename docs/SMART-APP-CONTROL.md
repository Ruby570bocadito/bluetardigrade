# Windows bloquea el instalador o un ejecutable

Un archivo puede tener un SHA-256 correcto y seguir sin tener una firma de editor confiable. El instalador desde fuentes compila EXE locales sin firma; no puede garantizar que Smart App Control los permita.

[Microsoft explica](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions) que Smart App Control pertenece a Windows 11, combina reputación con firma y no ofrece una excepción individual para una aplicación bloqueada. En Windows Server también puede haber políticas corporativas de [App Control for Business](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/deployment/use-code-signing-for-better-control-and-protection) o AppLocker. Una tarea SYSTEM o una consola elevada también debe respetar esas políticas.

## Identificar el archivo que falla

1. Conserva el nombre exacto y el mensaje del archivo bloqueado: puede ser `git.exe`, Go, Node, Bun, el motor, el sensor o un PS1.
2. Consulta, sin cambiar políticas, `citool.exe -lp` cuando esa herramienta esté disponible. Microsoft documenta las políticas `VerifiedAndReputableDesktop` y `VerifiedAndReputableDesktopEvaluation` para [comprobar el modo de SAC](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/test-your-app-with-smart-app-control).
3. En Visor de eventos revisa **Microsoft > Windows > CodeIntegrity > Operational**. El evento **3077** indica bloqueo aplicado; **3076** indica auditoría. Revisa el archivo indicado por el evento. Que no aparezca un evento no demuestra que todos los controles permitan el programa.
4. Examina los artefactos descargados antes de ejecutarlos:

```powershell
Get-FileHash .\install.ps1 -Algorithm SHA256
Get-AuthenticodeSignature .\install.ps1 | Format-List Status,StatusMessage,SignerCertificate
Get-AuthenticodeSignature .\bin\engine.exe | Format-List Status,StatusMessage,SignerCertificate
```

Si PowerShell muestra `ConstrainedLanguage`, el script no tiene la autorización necesaria para usar las funciones de .NET de este instalador. [Microsoft documenta las restricciones de App Control en PowerShell](https://learn.microsoft.com/en-us/powershell/scripting/security/app-control/how-app-control-works).

## Distribución que respeta la protección

El editor debe compilar en un entorno autorizado, firmar sus EXE y PS1 y publicar esos mismos bytes junto con sus hashes. Usa [scripts/release/sign-windows.ps1](../scripts/release/sign-windows.ps1) con un certificado real disponible en el almacén Windows. No inventa una identidad ni obtiene un certificado por sí mismo. Cualquier modificación posterior exige volver a firmar y recalcular los hashes.

Prepara un directorio de entrega con los binarios finales y todos los scripts
que se ejecutarán (incluidas las copias de `runtime.ps1` y `server-runner.ps1`).
No vuelvas a compilar los EXE después de firmarlos. En el equipo de publicación:

```powershell
# Ver certificados de firma disponibles, sin exportar sus claves privadas.
Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Select-Object Subject,Thumbprint,NotAfter
# Sustituye la huella por la del certificado RSA real del editor (40 hex).
.\scripts\release\sign-windows.ps1 -PackageRoot C:\Release\bluetardigrade `
  -CertificateThumbprint '<huella-del-certificado>' -SignToolPath 'C:\SDK\signtool.exe' -WhatIf
# Tras revisar, ejecuta el mismo comando sin -WhatIf y verifica:
.\scripts\release\sign-windows.ps1 -PackageRoot C:\Release\bluetardigrade -VerifyOnly
```

La herramienta firma scripts con SHA-256 y EXE/DLL mediante SignTool del SDK
de Windows. Conserva firmas RSA válidas con timestamp y comprueba el resultado.
`-VerifyOnly` falla si faltan firmas/timestamps, sin modificar bytes. No recibe
contraseñas ni archivos de claves. La verificación Authenticode local es un paso
de distribución; todavía hay que probar la política SAC/App Control del destino.

Para SAC, [Microsoft exige un certificado RSA de un proveedor confiable](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control). Un certificado autofirmado local no convierte una descarga pública en un editor confiable para SAC. En una organización, el administrador decide qué firmantes o hashes admite su política App Control; no se añade una regla desde este instalador.

`Unblock-File`, cambiar `ExecutionPolicy`, ejecutar como administrador o crear una tarea de arranque no establecen la confianza criptográfica de un EXE. Este proyecto no desactiva SAC/Defender/App Control ni añade exclusiones como reparación. Hasta disponer de una distribución firmada y validada, una máquina con SAC aplicado puede rechazar los artefactos del proyecto.
