# SPLAT_PIPELINE — trainer y política estable (audit 2026-07-13)

> Auditado contra `956558b` (2026-07-11). Cada afirmación viene de `--help` real,
> `CMakeCache.txt` o file:line — nada de docs upstream.

## Identidad

**OpenSplat 1.1.5 (git 9fb62fd)**, binario C++ compilado localmente. Dos builds:

| Build | Runtime (CMakeCache) | Uso |
|---|---|---|
| `splat/OpenSplat/build-mps/opensplat` | **MPS** (Metal) | Default en este M4 |
| `splat/OpenSplat/build/opensplat` | CPU | Fallback (`--cpu`) |

Selección: `choose_splat_backend()` (worker.py) — MPS si `GPU_RUNTIME==MPS` y
`xcrun --find metal` responde; si no, CPU. Corre **nativo**, no Docker
(Docker es solo para ODM). `DYLD_LIBRARY_PATH=splat/libtorch/lib`.

## Invocación exacta (`opensplat_train_cmd`, worker.py)

```
/usr/sbin/taskpolicy -m <caps.opensplat_mib> \
  <BIN> <PROJECT_DIR> [--cpu] \
  -n <ITERS> -o <OUT>.splat \
  --sh-degree-interval <ITERS+1> \
  <preset train_args...> <oom-rung extra...>
```

- `taskpolicy -m`: cap duro de RSS → SIGKILL (-9) al superarlo. Valor en
  `config/hardware.json` → `caps.opensplat_mib` (11000 MiB calibrado a 16GB).
- **`--sh-degree-interval = iters+1` clava SH en grado 0 SIEMPRE** — workaround de
  una divergencia NaN real (el salto de armónicos del step 1000 mataba el loss en
  CPU, 3 corridas). Consecuencia: ningún splat entrenado tiene color
  view-dependent, incluido "ultra". Nota original: el formato `.splat` no exporta
  coeficientes SH, así que con exportación `.splat` no se pierde nada; si algún día
  se exporta `.ply`/`.spz` con SH, este workaround pasa de inocuo a limitante.
  → **Experimento 2.0 del plan frontier**: reproducir el NaN, causa, fix, medir.
- Política de intentos explícita:
  - Medium calibrado: full; si el preflight medido lo requiere, empieza en `-d 2`.
  - Cinematic/Ultra: “riesgo alto/no calibrado”; no se muestran proyecciones falsas de memoria.
  - Ultra grande empieza directamente en `-d 2`, evitando un intento full destinado a OOM.
  - `best_available=true`: solo después de OOM puede bajar Ultra→Cinematic→Medium, siempre en
    `-d 2`. En modo estricto no cambia el preset solicitado.
  - Cada intento guarda preset, escala de entrada, causa, rc, duración y pico observado.

## Presets (`pipeline/splat_presets.py`)

| Preset | iters | train_args |
|---|---|---|
| fast | 1000 | — |
| medium | 2000 | — |
| cinematic | 7000 | `--save-every 1000 --refine-every 150 --densify-grad-thresh 0.00035 --stop-screen-size-at 3000` |
| ultra | 15000 | `--save-every 1000 --refine-every 200 --densify-grad-thresh 0.0005 --stop-screen-size-at 2500` |

Sin cap absoluto de gaussianas — el presupuesto de densificación se acota
indirectamente (`--densify-grad-thresh`, `--refine-every`, `--stop-screen-size-at`).

## Qué expone el CLI (v1.1.5, `--help` verificado) — mapa de levers Phase 2

| Lever | ¿Flag? | Implicación |
|---|---|---|
| Pose refinement (2.1) | ❌ | Requiere swap de trainer |
| Appearance embeddings (2.2) | ❌ | Requiere swap |
| Antialiasing / mip (2.3) | ❌ trainer (el viewer pone `antialiased:true` al render — no es el fix) | Requiere swap |
| Depth regularization (2.4) | ❌ (solo `--ssim-weight`) | Requiere swap |
| Densification budget (2.5) | ⚠️ indirecto (flags de arriba) | Tuneable en sitio |
| SH degree (2.0, nuevo) | ✅ `--sh-degree`, `--sh-degree-interval` | Hoy anulado por el workaround NaN |
| Validación | ✅ `--val`, `--val-image <name>`, `--val-render <dir>` | **Jamás usados por el pipeline.** Un solo hold-out por corrida |

**Decisión de trainer (stay vs migrate a nerfstudio/gsplat): se toma con la
baseline de Phase 1 en la mano, no antes.**

## Datos de entrenamiento — cómo consume el proyecto ODM

- Entrena desde `opensfm/reconstruction.json`: **itera TODOS los shots**
  (`opensfm.cpp:75-126`). `image_list.txt` es solo un mapa filename→ruta.
- ⇒ Un split train/test **no** se expresa por manifest: requiere quitar shots de
  una **copia** de `reconstruction.json` (cirugía, nunca sobre el original).
- Poses por shot: `rotation` (axis-angle) + `translation` + cámara Brown —
  suficientes para renderizar vistas held-out.

## Ciclo de vida del artefacto

```
train → splats/.training/<job>/<cid>.splat
  → quality gate (splat_quality: convergencia + tamaño + cámaras)
  → publish_splat_stage: archiva versión anterior a splats/history/ (keep=6)
  → splats/<cid>.splat + <cid>.meta.json (sidecar)
  → crop_floaters (de-halo) → SOG comprimido con splat-transform
  → Spark carga sog > spz > ksplat legado > splat fuente > ply
```

**Retención**: el proyecto ODM (`images/` + `opensfm/`) SOBREVIVE al training —
solo se borra el stage. Eval retroactivo posible, con la trampa: los splats
existentes entrenaron con TODAS las vistas → cualquier eval sobre ellos es
*train-view reproduction*, no held-out. La baseline honesta sale de re-entrenar
con split.

## Sidecar del run (`splats/<cid>.meta.json`) — schema semilla de `splat_runs[]`

```json
{"passed", "reason", "bytes", "cameras", "final_loss", "last_step",
 "steps_logged", "target_iters", "preset", "requested_preset", "effective_preset",
 "input_scale", "fallback", "attempts", "preset_label", "backend",
 "backend_note", "duration_s",
 "peak_mib",       // ← nuevo 2026-07-11: phys_footprint_peak del kernel — ps RSS
 "peak_source",    //   subestima ~20× los procesos MPS (RSS 489 MiB vs 10 GB reales)
 "mem_cap_mib"}    // ← cap vigente al entrenar (contexto del peak)
```

El run también se añade a `reconstruction.splat_runs[]` y, si pertenece a una escena,
a las métricas de esa versión. Pendiente: `params_hash`, `eval:{psnr,ssim,lpips}`.

## Qué significa “el Mac es capaz”

El M4 de 16 GB ha completado Medium, Cinematic y Ultra con Metal/MPS (por ejemplo Ultra
15k/127 cámaras en ~2 h). Eso demuestra capacidad, no garantía universal: Cinematic/Ultra
pueden agotar memoria según cámaras, resolución, geometría y presión concurrente. El preflight
solo da número de pico para Medium, donde existe calibración; para los demás comunica el riesgo
y aplica la escalera observable anterior.

## Config de hardware (`config/hardware.json`)

`pipeline/hwconfig.py` — única fuente de verdad. `machine` = hechos detectados
(16GB, 4P+6E, 10 GPU cores, Docker 9.77 GiB); `caps` = límites operativos
calibrados (opensplat 11000 MiB, ODM 7g×4 / 8500m×2). `load()` chequea RAM real
vs registrada en cada arranque (~5ms); `--detect` regenera `machine`.

## Entorno de eval (verificado 2026-07-11)

Python 3.14.6 (`/Volumes/SSD/_system/venv`): torch 2.13.0 **MPS=True**,
torchvision 0.28.0, lpips 0.1.4 (forward pass probado, pesos AlexNet cacheados),
scikit-image 0.26.0 (PSNR/SSIM importables). LPIPS no es bloqueante — está.
