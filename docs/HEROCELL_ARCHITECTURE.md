# Hero Cell R0: arquitectura operativa

Hero Cell R0 compila una versión inmutable de AeroBrain en una celda derivada de 100×100 m. La unidad canónica es `game_scene.v1.json`; Unreal, validadores y herramientas QA son consumidores, no fuentes de verdad.

## Input elegido

R0 usa `scene_0cadd1911f/recon_4e4245a1f4_aoi130`: versión activa y completa, con terrain, mesh, collider v3 y una reconstrucción OpenSfM local de 428 poses. La reconstrucción acumulativa más grande queda fuera porque no está activa, tiene splat sin alinear y collider v2. No se guardan coordenadas WGS84 en Git ni en los reportes del compilador.

## Flujo y límites

1. `WorldRepository` valida manifests y capacidades sin invocar builders mutantes; confina cada asset al vault y calcula hashes en streaming.
2. `HeroCellSelector` enumera cuadrados contenidos, mide mask/DSM/cobertura, combina rango vertical con planitud elevada para no confundir copas con cubiertas, penaliza vegetación mediante un proxy RGB de la ortofoto y deja cualquier métrica ausente en cero con razón explícita. El reporte conserva los diez mejores candidatos y los rechazos con sus razones.
3. `CoordinateContract` fija un único cambio AB metros (`+X east`, `+Y up`, `+Z south`) a Unreal centímetros (`X,Z,Y`), con matriz inversa y cambio de winding.
4. El estructurador conserva seis roles separados: referencia, ground, estructura limpia, estructura inferida, completion y colisión.
5. Truth Field transforma las poses OpenSfM a frame AeroBrain y proyecta cada muestra DSM a los frusta reales. Como R0 todavía no resuelve oclusión contra mesh ni valida sharpness/reproyección, confidence queda limitada a 0,49 y ninguna muestra puede promocionarse a multi-view.
6. Evidence Atlas y recetas PBR conservan fuente/confidence y presupuesto residente; las texturas de captura no se declaran normal o roughness verdaderas.
7. Completion sólo entra mediante hipótesis sembradas, escrow y render-to-refute. El build R0 real no genera completion porque falta evidencia por superficie.
8. `atomic_world_build` escribe en staging bajo `vault/worlds/<scene>` y promociona un directorio completo sólo si manifest y Truth Field validan.

## Resultado reproducible actual

El comando es:

```bash
/Volumes/SSD/_system/venv/bin/python3 -m world_compiler build \
  --scene scene_0cadd1911f \
  --version recon_4e4245a1f4_aoi130 \
  --size 100 --center auto --profile hero-r0 \
  --vault /Volumes/SSD/drone-vault
```

El output actual es `hero_68eca8767b533a51`, centrado en `(-30, -10)` m AB. Su identidad incorpora 14 hashes fuente y hashes SHA-256 reales de los árboles `world_compiler` y Unreal. Toda escritura derivada queda bajo `/Volumes/SSD/drone-vault/worlds`; los originales y manifests permanecen read-only.

## Gates

Los 77 tests Python cubren confinamiento, identidad, coordenadas, selección, Truth Field, separación de capas, presupuesto de materiales, completion, schema, vistas baseline, exclusión de copas, huellas irregulares, acuerdo punto-superficie, escrow de caras sin soporte, semántica conservadora y reproducibilidad. El proxy proyecta muestras deduplicadas sobre triángulos fuente cercanos; no sustituye ground truth independiente y todavía refuta la precisión requerida. Import Unreal, capturas finales, ruta de vuelo, FPS, 1% low y VRAM requieren un editor real y permanecen bloqueados externamente cuando no existe `UnrealEditor-Cmd`.
