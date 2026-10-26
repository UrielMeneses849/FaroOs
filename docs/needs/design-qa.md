# QA · Necesidades · 2026-10-26

final result: passed

## Artefactos y normalización

- Fuente visual: `docs/needs/approved-mobile.png`, 1315 × 1197 px, combinación aprobada de Semana y En casa.
- Implementación: módulo real `NeedsPage`, montado temporalmente bajo el `AuthProvider` real para capturar sólo su contenido. La identidad anónima se creó desde el laboratorio; se probaron persistencia y RLS en el mismo Supabase. El montaje temporal no forma parte del código publicado. El laboratorio también permite abrir el módulo real.
- Viewport móvil CSS: 390 × 844. El backend capturó contenido a 375 × 812 px (escala de captura aproximada 0.9615). Las comparaciones conservan la proporción, sin estirar tipografía. Se recortó únicamente el marco exterior de la imagen de referencia y se ajustó su ancho; las diferencias de alto se conservan.
- Evidencia móvil: `qa/week-mobile.png`, `qa/stock-mobile.png`; comparación conjunta de fuente e implementación: `qa/week-comparison.png`, `qa/stock-comparison.png`.
- Escritorio: viewport CSS 1200 × 1000; `qa/week-desktop.png`. Se comprobó que el ancho de contenido cabe en el viewport, sin desbordamiento horizontal. El diseño aprobado no incluía un escritorio nuevo; se adapta a dos columnas.
- Estado de las comparaciones: presupuesto de $1,500 y estimado de $1,240 con productos de laboratorio. La muestra usa tres alimentos, dos artículos de cuidado y un gusto; el mock mostraba nueve alimentos. Esta diferencia de conteo es intencional y no indica pérdida de registros.

## Comparación y ajustes

1. [P2 corregido] La primera captura (`qa/week-before.png`) dejaba la acción principal demasiado abajo. Se redujeron espacios en encabezado, presupuesto y filas; la acción principal de compra ahora está visible en el primer viewport móvil.
2. [P2 corregido] El tema global convertía el botón principal en blanco y reducía su fuente. Se añadieron reglas limitadas a Necesidades para conservar el azul aprobado, fuente legible y controles de al menos 44 px.
3. [P2 corregido] Las acciones de uso y edición añadían una segunda línea innecesaria al inventario. Se ajustaron en el extremo derecho y se retiró el subtítulo repetido de categoría. Los cuatro estados de la referencia quedan visibles, sin superposición.
4. Las capturas y comparaciones finales reflejan esas correcciones. No quedan diferencias P0/P1/P2 pendientes.

## Superficies revisadas

- Tipografía: Poppins existente; jerarquía de títulos, importes y cuerpo; controles principales de 14 px. No se sustituyó el texto por imágenes.
- Espaciado: filas agrupadas y divisores, sin tarjetas anidadas. El inventario largo permite scroll. La búsqueda y selector de categorías reemplazan las tres categorías fijas del mock para admitir todos los grupos pedidos.
- Color: fondo oscuro, azul de acciones y presupuesto, ámbar para reposición y rojo para agotados. Los estados incluyen texto y no dependen únicamente del color.
- Imágenes: miniaturas raster generadas para arroz, huevo, shampoo y desodorante. Sin logos ni texto. Los productos arbitrarios usan iconos de categoría, no dibujos que simulen fotos.
- Contenido: se agregaron precios reales con centavos, aviso de estimado parcial, gasto ya comprado y controles de edición. El consejo Antes de salir se mueve al final en móvil para priorizar la lista; ocupa la segunda columna en escritorio. Son adaptaciones funcionales explícitas de un mock, sin prometer fidelidad pixel por pixel.

## Interacciones comprobadas

- Navegación Semana / En casa / Después; formulario de producto, edición de presupuesto, consumo, estado y lista de compra.
- Prueba real en navegador: arroz 0.3 kg → consumir 0.1 kg → 0.2 kg; shampoo Queda poco → Tengo; compra parcial de 0.8 kg de arroz a $32/kg → 1 kg en casa, compra de $25.60 y resto de productos pendiente.
- Después de recargar se recuperan el gasto, la compra y las existencias desde Supabase. `qa/purchase-history.png` muestra el comprobante de laboratorio.
- Presupuesto antes y después: gasto + pendiente se mantienen sin duplicar el importe comprado.
- RLS activada con tres políticas; guardado atómico instalado y migración registrada. Otra identidad no puede leer el hogar de laboratorio.
- Pruebas automáticas de reposición, paquetes, consumos inválidos, migración anterior, cierre idempotente, compras parciales, precios pendientes, presupuesto, errores de red, cambios de cuenta, conflictos de revisión, reporte semanal y actualización de PWA.
- Suite del workspace: 91 archivos, 588 pruebas aprobadas. Typecheck y compilación PWA aprobados; lint aprobado tras retirar el montaje temporal de revisión.
- Consola tras recarga limpia: sin errores. Durante hot reload del montaje temporal apareció un aviso de createRoot, resuelto al recargar; no existe ese montaje en producción.

## Pulido opcional

- Permitir fotografías propias para otros productos y configurar la anticipación del reporte.
- Notificaciones fuera de la app y hogares compartidos entre cuentas quedan fuera de este alcance.
