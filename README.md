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

**El monstruo:** no ve en la oscuridad: te oye si te mueves con el carrito y ve tu linterna si le apuntas con ella (si apunta a otro lado, solo de muy cerca) (corriendo 16 m, andando 7 m, agachado 3 m) y ve la luz de tu linterna. Si te quedas totalmente quieto no te ataca, aunque lo tengas delante... pero cada 15 segundos o así se te escapa una tos que se oye a 8 m. Corre más que tú, pero cada 5 segundos de persecución se para y gira 360° buscando objetivos: es el momento de esconderse tras una estantería o quedarse quieto. Si doblas una esquina y deja de verte, va a donde te vio por última vez y desde ahí solo te sigue por el oído, más despacio. Cuantos más productos de la lista os lleváis, más se enfada: corre más, oye más lejos y persigue más rato. Si te atrapa, susto y pasas a ser fantasma hasta la siguiente ronda.

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
