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

## Conectar Google Calendar

La web solo **lee** tus eventos (permiso `calendar.readonly`): no puede crear, cambiar ni borrar nada. Los eventos van de Google directamente a tu navegador.

### 1. Registrar la app en Google Cloud (una sola vez)

1. Entra en <https://console.cloud.google.com/> con tu cuenta de Google y crea un proyecto nuevo (el mío se llama `organizador`).
2. Menú → **APIs y servicios → Biblioteca** → busca **Google Calendar API** → **Habilitar**.
3. Menú → **Google Auth Platform** (o "Pantalla de consentimiento de OAuth") → **Comenzar**:
   - Nombre de la app: `organizador`. Correo de asistencia: el tuyo.
   - Público: **Externo**. Correo de contacto: el tuyo. Acepta y **Crear**.
4. En **Público** (Audience) → **Usuarios de prueba** → **Añadir usuarios** → tu Gmail. La app se queda en modo "Prueba": es lo correcto para uso personal.
5. En **Clientes** → **Crear cliente**:
   - Tipo: **Aplicación web**. Nombre: `Hoy web`.
   - **Orígenes autorizados de JavaScript**: `https://miguebersan28.github.io` y `http://localhost:8000`
   - **Crear** y copia el **ID de cliente** (termina en `.apps.googleusercontent.com`).
6. Pega ese ID en `js/config.js` (`GOOGLE_CLIENT_ID = '...'`).

### 2. Conectar

En el widget **Calendario** pulsa **Conectar Google Calendar**. Google avisará de que la app "no está verificada": es normal porque es tu propia app; pulsa **Continuar**.

### Cosas a saber

- El permiso de Google dura **1 hora**. Después, los eventos de hoy se siguen viendo (están guardados), y para actualizar pulsas **Reconectar** o el botón ↻: un clic.
- Con el engranaje del widget eliges qué calendarios se muestran, qué eventos se ocultan por nombre (viene con tu horario de clase) o desconectas tu cuenta.
- El widget enseña solo lo que está pasando y lo que queda. Púlsalo para ver el día completo, con lo terminado atenuado.
- Cuando falta menos de 1 hora para un evento, aparece un aviso en la tarjeta grande.
