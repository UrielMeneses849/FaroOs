# Vault: recuperación del desbloqueo con Touch ID

El Diario usa LocalAuthentication con `DeviceOwnerAuthenticationWithBiometrics`. Vault ya usaba esa misma política, pero después intentaba leer la llave legacy con la interacción del Llavero deshabilitada y obligaba a copiarla a otro item antes de abrir el contenido. La captura del usuario corresponde al fallo de lectura legacy posterior a la autenticación, no a una huella rechazada.

El desbloqueo conserva la llave original y su ACL del Llavero. Touch ID sigue siendo obligatorio para obtener la llave; no hay retorno de una llave antes de autenticar. No se crea una llave sustitutiva ni se elimina la existente durante esta ruta. Se permite el diálogo nativo de autorización del Llavero y se restaura la política de interacción anterior. Una cancelación o fallo conserva el bloqueo. Los errores indican la etapa y OSStatus, sin revelar datos de la llave. El timeout de Touch ID invalida su contexto.

Una firma distinta puede requerir autorización del usuario para acceder al item antiguo. LocalAuthentication y las ACL del Llavero son controles distintos: la aplicación no puede prometer que una huella sustituya esa autorización. FARO no recibe la contraseña de macOS. Mantener la identidad estable de firma evita cambiar intencionalmente la identidad en cada instalación.

Referencias: [Apple TN3137](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains), [ACL del Llavero](https://developer.apple.com/documentation/security/access-control-lists).

Validación: 15 pruebas nativas aprobadas, incluidas integridad, cifrado/descifrado y conservación de Vault no vacío. TypeScript y ESLint de VaultPage aprobados. La validación del diálogo real y la huella requiere la interacción del usuario en su Mac; no se extrajeron credenciales para probar.


## Acceso local solo con huella — 9 de septiembre de 2026

Por solicitud explícita del usuario se sustituyó la consulta repetida al Llavero por una llave local con permisos 0600 dentro del directorio privado de Vault (0700). Touch ID sigue siendo la puerta de entrada de la aplicación, sin opción de contraseña alternativa. Este modo reduce la protección: la llave depende de los permisos del usuario del sistema, y ya no de la ACL del Llavero. Un proceso con acceso a esos archivos puede obtener la llave.

La primera apertura de una bóveda anterior obtiene la llave original por la ruta existente y comprueba que descifra la bóveda antes de persistirla localmente. macOS puede requerir una última autorización de su Llavero; FARO no elude ese permiso. No se elimina la llave antigua ni se recrean las credenciales. Las aperturas posteriores autentican la huella y leen la llave local, sin consultas al Llavero. Los errores de lectura o una llave local inválida no generan una sustituta. Las solicitudes simultáneas de autenticación se rechazan para evitar acumular diálogos.

Se verifican con datos sintéticos la lectura tras persistencia, permisos del archivo, conservación de contenido cifrado, rechazo de llaves truncadas y rechazo de sobrescritura con una llave diferente. La migración real y la huella requieren interacción del propietario en macOS; las pruebas no leen credenciales reales.
