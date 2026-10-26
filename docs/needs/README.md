# Necesidades: compras de casa

La sección reúne Semana, En casa y Después. Mantiene un presupuesto semanal e historial propios; no usa cuentas, movimientos ni presupuestos de Finanzas.

- Las cantidades objetivo menos las existencias generan la lista del siguiente sábado (incluyendo el sábado actual). La compra se redondea al incremento configurado: por ejemplo, un paquete completo o 0.1 kg.
- En productos por cantidad, `packSize` convierte unidades de compra a existencias: un paquete de 30 huevos suma 30 piezas; 1 kg a granel usa contenido 1.
- En productos por estado, Queda poco o Se acabó propone reposición. Comprar cada sábado puede incluir productos aunque queden existencias; una compra confirmada satisface esa regla para ese sábado.
- Guardar lista conserva cantidades, exclusiones y precios planeados sin sumar existencias. Las exclusiones y cantidades manuales vencen al cambiar de semana.
- Cerrar compra registra sólo los productos seleccionados, los precios reales y el total; suma sus existencias en la misma escritura. Los productos no comprados siguen pendientes.
- El gasto ya comprado y el costo pendiente se descuentan juntos del presupuesto, sin contar dos veces una compra.
- Gusto es una etiqueta independiente de la categoría. En el resumen se muestra en un grupo separado y se excluye de los subtotales necesarios, evitando duplicaciones.
- El viernes y sábado aparece un reporte dentro de Faro al abrir o volver a la app. Puede cerrarse por cuenta y semana. No envía notificaciones con la app cerrada.
- Después guarda compras personales o de calidad de vida y permite pasarlas a la semana.

## Persistencia

`needs_households` guarda un documento por usuario con productos, presupuestos y compras. RLS restringe lectura y escritura al propietario. `save_needs_household` aplica una revisión esperada: ante cambios desde otro dispositivo se recarga y se solicita revisar la operación, sin sobrescribir silenciosamente.

La migración `20261026090000_needs_households.sql` es aditiva y no toca las tablas anteriores. La primera apertura importa necesidades activas conservando identificadores y notas. Cantidades libres, estimados por artículo, frecuencia y fecha anteriores quedan documentados en notas; no se interpretan como cantidades físicas ni como precios unitarios. Los datos y la memoria de precios anteriores permanecen en sus tablas.

Se guarda una copia local separada por usuario. Si falla la conexión se muestra sólo para consulta; las escrituras requieren confirmación de Supabase. No se agregaron colaboración entre cuentas ni permisos compartidos.

## PWA

Incluye acceso directo a Lista del sábado, caché de las miniaturas JPEG y comprobación del service worker al volver a primer plano, recuperar conexión y cada hora. La activación mantiene el botón explícito Actualizar para evitar recargar una captura en curso.

## Referencia y miniaturas

Diseño aprobado: [approved-mobile.png](approved-mobile.png). Miniaturas finales generadas con Imagegen integrado: `public/needs/rice.jpg`, `eggs.jpg`, `shampoo.jpg`, `deodorant.jpg`; cada una se optimizó a 192 px y las cuatro suman aproximadamente 29 KB. Se usan para nombres reconocibles y los demás productos usan iconos de categoría de la biblioteca existente.

Especificaciones de los prompts: una sola imagen cuadrada por producto, objeto completo centrado, fondo azul casi negro #101a26, luz suave, estilo fotográfico limpio, sin texto, marcas ni interfaz; bowl de madera con arroz blanco, tres huevos, botella blanca con dispensador azul y desodorante negro con tapa. Referencia visual: miniaturas de la imagen aprobada. Los originales permanecen en los resultados de Imagegen; el código consume únicamente los archivos del proyecto.

Consulta [design-qa.md](design-qa.md) para validación visual y funcional.
