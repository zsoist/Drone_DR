# AeroBrain: Experiencia de Juego v1 — "Vuela tus propios mapas"

> PLAN (no build). Congelado 2026-07-11. Tab nuevo: **Hangar**.
> Prime directive heredada: la experiencia solo promete lo que el backend
> demuestra — los "mapas cargados" son TUS modelos procesados, no assets ajenos.

## La tesis que lo hace posible SIN dependencias nuevas
Cada modelo procesado ya contiene el juego completo:
- **DSM** (heightmap real, GeoTIFF→bin ya servido al visor) = el TERRENO
- **Ortofoto** (hasta 2cm/px) = la TEXTURA del terreno
- **Splat** (.ksplat) = la escena héroe foto-realista
- **Track** (GPS 1Hz + altitudes del SRT) = el GHOST del vuelo real
- **three.js + MapLibre** ya vendorizados; el motor existe
Un "mapa de juego" = mesh de terreno (DSM como displacement + orto como textura)
— nuestros datos, cero terrenos externos, cero API keys nuevas.

## Principios de diseño (del artículo de referencia, aplicados)
Inmersión (terreno real tuyo > tiles genéricos) · Tema coherente (HUD de dron:
telemetría DJI real como lenguaje visual) · Landmarks (los edificios de TUS
vuelos son los puntos de memoria) · Navegación de memoria (mismo lugar, N
visitas) · Mapa-en-mano (minimapa MapLibre persistente) · Legibilidad (LOD:
lejos=orto plana, cerca=terreno 3D, héroe=splat).

## Las 3 pantallas (arquitectura Civ/CoD/FlightSim)

### G1 — SELECTOR DE MAPAS ("elige tu misión")
Carrusel 3D de tarjetas-mapa estilo Civ: cada modelo = una tarjeta con su
ortofoto como arte, chips reales (ha, cm/px, cámaras, splat sí/no, merge_label
de la entity), y el globo/mapa MapLibre de fondo volando (flyTo 60fps) al lugar
de la tarjeta enfocada. Filtros por lugar geocodificado (barrio·ciudad — ya
existe). "Cargar mapa" = transición cinematográfica (zoom del globo al bbox →
crossfade al terreno 3D). Mapas "bloqueados" = vuelos sin procesar (CTA honesto
al Estudio 3D con preflight).

### G2 — MODO VUELO (el juego)
three.js: terreno = PlaneGeometry subdividida con displacement del DSM +
textura orto (ambos YA en vault por modelo; el visor DSM actual ya lee el .bin).
- **Física-lite de dron**: WASD+mouse (o touch dual-stick móvil) con inercia,
  límites de pitch, altitud sobre DSM (colisión suave = rebote de altura).
  60fps: rAF + damping — sin librería de física, ~200 líneas.
- **GHOST del vuelo real**: el track GPS reproducido como estela/dron fantasma
  — "vuela contra tu vuelo" (el dato más honesto del juego: ESO voló ahí).
- **HUD de dron**: altitud AGL (DSM real), velocidad, distancia a home,
  telemetría del SRT en el ghost — el idioma DJI como estética.
- **Waypoints de interés**: los highlights manuales existentes (api/highlight)
  como anillos coleccionables; fotos foto4k como "fotos por descubrir".
- **LOD honesto**: terreno DSM para vuelo libre; al entrar al radio del splat
  (si existe) → crossfade al visor splat (GaussianSplats3D ya integrado) con
  la MISMA cámara — la escena héroe es el premio.

### G3 — DEBRIEF (post-vuelo)
Stats del vuelo virtual vs el real (distancia, tiempo, altitud máx —
comparados contra el track), foto-momentos capturados, botón compartir
(share.html ya existe). Cero puntajes inventados: solo métricas medibles.

## Stress-test pre-escrito (los 4 riesgos que matan esto)
1. **PERF móvil**: DSM 5221×4755 no entra como displacement directo — G2 exige
   pirámide de LOD del DSM (256²/512²/1024²) generada al publicar (tresd_publish
   +1 paso). Gate: 60fps en desktop M4, ≥30 en iPhone con el 1024².
2. **El splat-crossfade** puede marear: cámaras deben coincidir en pose exacta
   (el visor splat ya recibe cameras.json — verificar transform compartido).
3. **Scope-creep**: es EL tab de juego, no un juego-servicio. NO multiplayer,
   NO logros persistentes, NO assets externos. La vara son estos gates, no
   "se siente como CoD".
4. **El ghost necesita interpolación** (GPS 1Hz → 60fps): perf.py YA interpola
   a 60fps para el panel — reusar, no reescribir.

## Fases con gates
| Fase | Entrega | Gate |
|---|---|---|
| G0 | Pirámide LOD del DSM en publish + endpoint de heightmap | los 5 modelos regeneran su pirámide; bin 1024² < 4MB |
| G1 | Selector con globo + tarjetas + transición de carga | elegir mapa → terreno en <3s desktop; funciona con los 5 modelos reales |
| G2a | Terreno+vuelo libre+HUD+ghost | 60fps M4 / 30 iPhone; ghost reproduce el track real ±1s |
| G2b | Waypoints + crossfade a splat | crossfade sin salto de cámara en escena 1 |
| G3 | Debrief + share | stats vs track real correctos en 3 vuelos |

## Orden y colisión de agenda
G0-G1 = ~2 sesiones · G2a = 2-3 · G2b-G3 = 1-2. Compite con U2/U3 (spec v2)
y M1-msplat/M3. Recomendación: cerrar M1 (celdas c3/c3b + msplat) ANTES de
arrancar G0 — la decisión de trainer afecta qué splats alimentan G2b.
El Hangar es el escaparate; la tabla decide qué se exhibe.
