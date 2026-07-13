# Multi-fuente 3D y escenas incrementales — estado (2026-07-13)

## Validado empíricamente ✅
- **Fusión funciona** con fuentes compatibles: test 0103+0104 (aéreo+aéreo, misma sesión, 31m,
  altura similar) → **169/169 = 100%, 1 componente, 17.006 matches cross-source, 2/2 fuentes**.
- **Falla predecible** con incompatibles: test 0106(1m suelo)+0101(90m aéreo) → 0 matches → 0106
  descartado (0/7). El 82% total era un FALSO pass. Diagnóstico: 0 features comunes (geometría),
  no config ni frames malos (538 features/img en ambos).
- **Discriminante = compatibilidad de vista (altura/ángulo)**, NO el punto de despegue.
- **video+FOTO PASA** (test #3): 0103 aéreo + 3 fotos de 0104 (misma sesión, fuente conocida-compatible)
  → 61/61, **3/3 fotos co-registradas, 24.152 matches foto↔video**. Fotos = stills del dron (foto4k),
  GPS heredado del track del clip padre.

## Rango VALIDADO (mapa honesto de lo que sé)
- Probado y PASA: misma sesión, ≤31m de separación de centros, solape de altitud ≥100m, mismo dron/cámara.
- Fuera de eso: SIN datos. No sé la frontera (¿150m? ¿4h de diferencia? ¿solape parcial de altura?).
- NO probado: fotos de OTRA cámara (celular) — eje distinto (perfil de cámara), su propia celda.

## Enviado
- odm_prep multi-fuente (--sources/--photos, prefijo por fuente, geotag por track, swap atómico).
- worker.odm_registration: merge report honesto (submitted/registered/ratio, fusionó=≥5 img Y ≥0.6).
- Gate: partial_merge → no auto-encolar splat phased. Modelo siempre sobrevive (label, no hard-fail).
- UI: modal Estudio 3D (multi-select por lugar, fotos, preset, phased). Score predictivo ELIMINADO;
  avisos de compatibilidad reales (suelo+aéreo, cross-sesión, alturas dispares).
- Fixture de regresión del path de geotag (el bug que me mordió).
- Entidad `reconstruction` estable (`recon_<hash>` por fuentes+fotos) y entidad `scene_<hash>`
  con manifiesto propio. Una escena conserva inventario, historial inmutable de versiones y una
  versión activa promovida explícitamente.
- “Mejorar esta escena” crea otra reconstrucción con capturas/fotos nuevas sin sobrescribir la
  activa. Una versión `PARTIAL` o sin artefactos requeridos no puede promoverse. La cercanía GPS
  es solo sugerencia; `FULL/PARTIAL` depende del registro real por fuente.
- La primera versión válida (`FULL` o `SINGLE`) se promueve automáticamente. Las siguientes se
  conservan como candidatas hasta promoción humana, con QA, calidad solicitada/efectiva y splat.

## Pendiente (honesto — NO validado / diferido)
1. ~~video+foto e2e~~ ✅ HECHO (test #3, 3/3 fotos, 24k matches). Falta: fotos de celular (otra cámara).
2. **Presupuesto global de frames + dedup INTRA-fuente**: poda hoy es por-fuente. OJO (hallazgo del
   review): NO deduplicar cross-source — esos near-duplicates son el pegamento del co-registro.
   Cap MAX_IMAGES + floor por-fuente (≥20).
3. **Sugerencia por compatibilidad**: calibrar la frontera con más pares. La UI ya ordena por
   centro geográfico y muestra distancia/altura, pero no promete compatibilidad.
4. **Preflight de disco** antes de encolar multi-fuente pesada.
