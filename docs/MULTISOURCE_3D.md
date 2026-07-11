# Multi-fuente 3D — estado (2026-07-11)

## Validado empíricamente ✅
- **Fusión funciona** con fuentes compatibles: test 0103+0104 (aéreo+aéreo, misma sesión, 31m,
  altura similar) → **169/169 = 100%, 1 componente, 17.006 matches cross-source, 2/2 fuentes**.
- **Falla predecible** con incompatibles: test 0106(1m suelo)+0101(90m aéreo) → 0 matches → 0106
  descartado (0/7). El 82% total era un FALSO pass. Diagnóstico: 0 features comunes (geometría),
  no config ni frames malos (538 features/img en ambos).
- **Discriminante = compatibilidad de vista (altura/ángulo)**, NO el punto de despegue.

## Enviado
- odm_prep multi-fuente (--sources/--photos, prefijo por fuente, geotag por track, swap atómico).
- worker.odm_registration: merge report honesto (submitted/registered/ratio, fusionó=≥5 img Y ≥0.6).
- Gate: partial_merge → no auto-encolar splat phased. Modelo siempre sobrevive (label, no hard-fail).
- UI: modal Estudio 3D (multi-select por lugar, fotos, preset, phased). Score predictivo ELIMINADO;
  avisos de compatibilidad reales (suelo+aéreo, cross-sesión, alturas dispares).
- Fixture de regresión del path de geotag (el bug que me mordió).

## Pendiente (honesto — NO validado / diferido)
1. **video+foto e2e**: el headline de la feature. Fotos = otra resolución/perfil de cámara; un
   pass video+video NO se extrapola. Falta un test controlado (misma sesión, foto con EXIF GPS).
2. **Entidad `reconstruction` de 1ª clase**: hoy el modelo combinado hereda el clip_id del primario.
   Deuda: borrar el primario huérfana el combinado; re-correr single-source lo sobreescribe. Migrar
   a recon_<hash> con read-alias desde clip_id para links viejos.
3. **Presupuesto global de frames + dedup INTRA-fuente**: poda hoy es por-fuente. OJO (hallazgo del
   review): NO deduplicar cross-source — esos near-duplicates son el pegamento del co-registro.
   Cap MAX_IMAGES + floor por-fuente (≥20).
4. **Sugerencia por compatibilidad**: agrupar por altura+centroide (no solo home GPS). Hoy la UI
   agrupa por home pero AVISA de incompatibilidad — mitigado, no resuelto.
5. **Preflight de disco** antes de encolar multi-fuente pesada.
