# ViceLens

Filtro de cámara para grabar a una persona real con un minimapa interactivo. Encuadra a la persona de cuerpo entero. Cuando camina, el mapa virtual avanza por las calles. Cuando se detiene o sale de cuadro, el recorrido se pausa.

## Abrir en Windows

1. Extrae el ZIP completo.
2. En la carpeta ViceLens, haz doble clic en **Iniciar-Windows.cmd**. Requiere [Node.js 18 o posterior](https://nodejs.org/).
3. Pulsa **Activar cámara** en el navegador y permite el acceso. Mantén abierta la ventana del servidor mientras grabas.

En Windows, macOS o Linux también puedes abrir una terminal en esta carpeta y ejecutar:

```sh
npm start
```

Abre la dirección local que aparezca en la terminal. El proyecto incluye el código, el modelo y las dependencias del navegador. El servidor usa los módulos integrados de Node.js.

## Usar en iPhone o Android

Publica **el contenido de dist** en un alojamiento estático con HTTPS. Si usas cPanel, puedes colocarlo en una carpeta propia como `public_html/vicelens/` y abrir esa ruta de tu dominio en Safari o Chrome. Conserva la estructura de `assets/` y de los módulos JavaScript. El navegador necesita un sitio HTTPS para acceder a la cámara del teléfono.

Pulsa **Activar cámara**. El visor ocupa todo el espacio disponible. El botón de las esquinas devuelve al estudio. En iPhone también puedes añadir el sitio a la pantalla de inicio desde el menú Compartir de Safari.

## Grabar y usar el mapa

- **Recorrido virtual.** Mantén visibles las rodillas y los pies. El ritmo de los pasos controla el avance por un circuito ficticio, incluso al grabar con el celular fijo.
- **Minimapa estilo GTA.** Ciudad costera ficticia con bahía, puentes, isla de playa, autopista e iconos de lugares. El mapa gira para que la dirección de la marcha quede siempre arriba, con perspectiva inclinada, ruta GPS magenta y aguja del norte. Al cambiar de zona aparece el nombre del distrito y de la calle.
- **Zoom.** Toca el minimapa (o pulsa M) para alternar entre 1×, 2× y 4×. El mapa se aleja un poco al caminar más rápido.
- **Pantalla completa.** Doble toque o tecla F para entrar o salir. Los controles se ocultan solos y vuelven al tocar. En pantalla completa, la barra espaciadora dispara. La pantalla no se apaga mientras la cámara está activa.
- **GPS opcional.** Activa **Usar GPS** para seguir el desplazamiento real del dispositivo. Las calles cercanas se descargan de OpenStreetMap cuando hay conexión.
- **Foto o video.** Elige el tipo de toma y pulsa el obturador. Para incluir sonido, activa antes el micrófono. En **Galería** puedes reproducir y descargar tus tomas.
- **Calidad.** La aplicación solicita hasta 3840 × 2160 a 30 fotogramas por segundo, o su equivalente vertical. La salida utiliza los píxeles disponibles de la cámara para el encuadre y se adapta al codificador del navegador. Los 192 × 192 píxeles del detector se usan únicamente para analizar los pasos. Se activan enfoque, exposición y balance de blancos continuos cuando la cámara lo permite. En Chrome para Android las fotos se toman con la resolución completa del sensor. El filtro añade realce de nitidez, curva de tono y viñeta. El estilo **Natural** ofrece el aspecto más realista.

Las tomas y el análisis de movimiento permanecen en el navegador. Descarga las tomas que quieras conservar antes de borrar sus datos.

## Archivos principales

| Archivo o carpeta | Función |
| --- | --- |
| dist/index.html y dist/style.css | Estudio, visor y galería |
| dist/app.js y dist/gallery.js | Cámara, grabación, fotos y almacenamiento |
| dist/scene.js, dist/grade-gl.js y dist/quality.js | Color, composición y resolución de captura |
| dist/city-map.js y dist/radar.js | Calles del circuito, ruta y modo GPS |
| dist/walker.js, dist/gait.js y dist/pose-*.js | Detección de la postura y estimación del movimiento |
| dist/assets/motion | Modelo MoveNet, TensorFlow.js, WebAssembly y licencias |
| servidor.mjs | Servidor local para desarrollo |
