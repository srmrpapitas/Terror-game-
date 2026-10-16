// Ajustes de juego compartidos por cliente y servidor (ver el documento de diseño).

export const TICK_RATE = 20; // simulaciones por segundo en el servidor
export const MAX_PLAYERS = 4;

export const PLAYER = {
  radius: 0.35,
  eyeHeight: 1.65,
  crouchEyeHeight: 1.0,
  speed: { crouch: 1.8, walk: 3.5, run: 6.5 },
  // Radio (m) en el que el monstruo oye cada forma de moverse (con el carrito traqueteando)
  noise: { idle: 0, crouch: 3, walk: 7, run: 16 },
  staminaSeconds: 6,
  staminaRegen: 0.12, // fracción de la barra recuperada por segundo (~8 s para llenarla)
  pickupRange: 2.2,
  coughEvery: 15, // s (±25 %) entre toses involuntarias
  coughNoise: 8, // m a los que se oye una tos
};

export const MONSTER = {
  radius: 0.5,
  height: 2.6,
  patrolSpeed: 2.5,
  investigateSpeed: 4,
  chaseSpeed: 7.4, // algo más que tú corriendo (6,5): en recta te alcanza, en las esquinas lo puedes despistar
  chaseBeforeScan: 5, // s persiguiendo antes de pararse
  scanDuration: 2, // s girando 360°
  fov: (110 * Math.PI) / 180,
  sightRangeFlashlight: 24, // solo ve la luz de las linternas: si le apuntas, de lejos
  sightRangeGlow: 5, // si la linterna apunta a otro lado, solo el resplandor de cerca
  beamAngle: (70 * Math.PI) / 180,
  closeSense: 2.5, // a esta distancia te detecta sin linterna, si te mueves
  catchRange: 1.3,
  loseSightAfter: 1.2, // s sin verte antes de dejar de perseguir (va a donde te vio por última vez)
  hearingError: 0.3, // al oírte solo sabe tu posición aproximada (fracción de la distancia)
  startDelay: 10, // s quieto al empezar la ronda
  feedDuration: 4, // s quieto tras atrapar a alguien
  turnSpeed: 6, // rad/s
  // Con toda la lista cogida: +15 % de velocidad, +50 % de oído y 1 s más persiguiendo
  anger: { speed: 0.15, hearing: 0.5, chaseLonger: 1 },
};

export const JUMPSCARE_MS = 2600;
