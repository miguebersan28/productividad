# Hoy

Panel para organizar el día en una pantalla secundaria: tareas con prioridad, Pomodoro, modo foco y racha.

## Cómo se usa

| Acción | Cómo |
|---|---|
| Añadir tarea | Escribe en "Nueva tarea", elige prioridad (`!!!` alta, `!!` media, `!` baja) y pulsa **Enter** |
| Completar | Clic en el círculo |
| Poner una tarea "en curso" | Clic en la tarea (por defecto lo está la primera) |
| Reordenar | Arrastra la tarea (solo dentro de su prioridad: las altas siempre van arriba) |
| Borrar | Papelera al pasar el ratón → aparece **Deshacer** durante unos segundos |
| Tareas de días anteriores | Salen en **Atrasadas** con un botón **Pasar a hoy** |
| Pomodoro | 25 / 5 min y descanso largo de 15 cada 4 sesiones (todo se cambia en ⚙) |

**Atajos de teclado:** `Espacio` empezar/pausar · `N` nueva tarea · `F` modo foco · `Esc` salir.
En una tarea seleccionada con `Tab`: `Enter` ponerla en curso · `Espacio` completar · `Alt+↑/↓` moverla · `Supr` borrar.

**Racha:** suma un día cuando completas todas las tareas de prioridad alta de ese día. Un día sin tareas altas ni suma ni la rompe. Las atrasadas completadas no cuentan.

## Dónde se guardan los datos

En el `localStorage` de tu navegador (clave `hoy.dashboard.v1`). No salen de tu ordenador. Si borras los datos del navegador o usas otro navegador, empiezas de cero.

## Estructura

```
index.html        la página
css/styles.css    todo el diseño
js/main.js        arranca la app y conecta las piezas (reloj, modo foco, atajos)
js/store.js       el estado: guardar/cargar, cambio de día, atrasadas y racha
js/tasks.js       la lista de tareas: pintar, completar, borrar, arrastrar
js/timer.js       el Pomodoro: fases, sonido, notificaciones y ajustes
js/spring.js      física de muelle para las animaciones
js/ui.js          avisos (toast) y controles segmentados
```

## Probarla en tu ordenador

Los módulos de JavaScript no funcionan abriendo el archivo con doble clic; necesitan un servidor. Desde esta carpeta:

```bash
python -m http.server 8000
```

y abre <http://localhost:8000>.
