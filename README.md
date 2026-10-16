# Última Compra

Un juego de terror cooperativo para 1 a 4 amigos: entráis de noche en un supermercado cerrado, tenéis que llenar la cesta con la lista de la compra y salir por las cajas antes de que el monstruo os atrape. Se juega en el navegador, en PC y en móvil.

## Cómo jugar

1. Uno crea la partida y comparte el enlace (o el código de 4 letras).
2. Los demás entran con el enlace o escriben el código y pulsan **Unirse**.
3. El anfitrión pulsa **Empezar**.

| Acción | PC | Móvil |
| --- | --- | --- |
| Moverse | WASD | Joystick izquierdo |
| Mirar | Ratón (clic para capturarlo) | Deslizar en la mitad derecha |
| Correr | Shift | Botón Correr, o joystick al borde |
| Agacharse | C | Botón Agachar |
| Linterna | F | Botón Linterna |
| Coger producto | E | Botón Coger (aparece al estar cerca) |

**El monstruo:** te oye si corres (14 m), andas (5 m) o te agachas (1,5 m), y te ve en un cono delante de él. Corre más que tú, pero cada 5 segundos de persecución se para y gira 360° buscando objetivos: es el momento de esconderse tras una estantería. Si te atrapa, susto y pasas a ser fantasma hasta la siguiente ronda.

## Ejecutarlo

Necesita Node.js 18 o superior. Antes de empezar, copia el monstruo de Mixamo en `public/models/` (instrucciones en [public/models/LEEME.md](public/models/LEEME.md)); sin él se usa una figura provisional.

```bash
npm install
npm run dev        # http://localhost:3000 (modo desarrollo)
```

Para jugar con amigos en la misma red, abrid `http://<IP-de-tu-PC>:3000`. Para producción:

```bash
npm run build
npm start          # sirve dist/ y el servidor multijugador en el puerto $PORT (3000 por defecto)
```

Se puede desplegar tal cual en cualquier servicio que ejecute Node y permita WebSocket (Render, Railway, Fly.io...).

## Publicar en Cloudflare

En Cloudflare el juego corre como un Worker (`worker/index.js`): cada sala es un Durable Object con la misma lógica que `server/game.js`, y los archivos del juego salen de `dist/`.

1. En el panel de Cloudflare, **Workers & Pages → Create application → GitHub**, elige este repositorio y despliega. El nombre del Worker tiene que ser `terror-game` (el de `wrangler.toml`). Cada push a `main` vuelve a publicar.
2. Sube el monstruo y sus animaciones (los de `public/models/LEEME.md`) al bucket de R2 `ultima-compra-models`, en la raíz y con los mismos nombres. El Worker los sirve desde ahí.

Para probar la versión de Cloudflare en local: `npx wrangler dev`.

```bash
npm test           # pruebas del servidor: salas, productos y la IA del monstruo
```

## Estructura

| Carpeta | Qué hay |
| --- | --- |
| `shared/` | Mapa del supermercado y ajustes de juego, compartidos por cliente y servidor |
| `server/` | Servidor HTTP + WebSocket, salas y la IA del monstruo (el servidor es el árbitro) |
| `src/` | Cliente Three.js: mundo, jugador, controles táctiles, sonido y el susto |
| `public/models/` | Donde va el monstruo de Mixamo (no se sube al repo) |

Los ajustes de velocidad, ruido, visión y tiempos del monstruo están en `shared/constants.js`.
