# Modelo del dron — spec para reemplazo (drone.glb)

Suelta tu modelo en **`web/assets/drone.glb`**, pon `"drone_glb": true` en
`web/assets/manifest.json`, y corre `python3 pipeline/bump_web_version.py`.
El juego lo usa automáticamente (fallback: el procedural).

## Instrucciones para un LLM/artista (copia-pega esto)
Genera un dron cuadricóptero estilo DJI Mini en formato **glTF binario
(.glb)** con estos requisitos EXACTOS:
- **Ejes**: nariz hacia **-Z**, arriba **+Y** (convención glTF/three).
  El gimbal/cámara mira a -Z.
- **Origen**: centro geométrico del cuerpo (el juego re-centra por bbox,
  pero un origen sano evita sorpresas).
- **Escala**: cualquier tamaño uniforme (el juego normaliza la envergadura
  X a 0.85 m). Proporciones reales de un Mini: cuerpo ~60% del span.
- **Presupuesto**: ≤ 20k triángulos, ≤ 2 materiales PBR, texturas ≤ 1024².
  Sin luces ni cámaras embebidas. Sin animaciones (se ignoran).
- **Hélices**: cada hélice como nodo separado llamado `prop_1`..`prop_4`
  con su pivote en el eje del motor — el juego las gira por nombre.
- **Materiales**: gris claro tipo plástico (metallic 0.1, roughness 0.5),
  detalles gris oscuro; puntas de hélice naranjas opcionales.
- **Nada de logos/marcas** (sin copyright).

## Verificación local
1. Copia a `web/assets/drone.glb` → `python3 pipeline/bump_web_version.py`
2. `python3 pipeline/flightverse_spike_gate.py --page volar.html --global __volar --extra '&autotest=1'`
   → el reporte debe traer `customDrone: true` y 0 errores.
3. Vista rápida: volar.html?m=<cid> — tecla C cicla cámaras para inspeccionarlo.
