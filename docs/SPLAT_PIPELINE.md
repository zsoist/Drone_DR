# SPLAT_PIPELINE — trainer y política estable (audit 2026-07-14, reorganizado 2026-09-28)

> Contrato vigente. **Camino de producción = CUDA en el PC RTX** (desde 2026-09-28 la política por defecto es
> **PC-only**, `pipeline/compute_policy.py`). Todo lo de OpenSplat/MPS/Metal quedó en el apéndice
> [Legacy Mac path](#legacy-mac-path-opensplat--mps) y sólo aplica con `AEROBRAIN_COMPUTE=local`.
> Arquitectura general: [ARCHITECTURE.md](ARCHITECTURE.md); procedimientos: [RUNBOOKS.md](RUNBOOKS.md).

## Camino de producción (CUDA)

| Pieza | Detalle |
|---|---|
| Trainer | `nerfstudio` splatfacto + gsplat 1.4 (CUDA 12.4) en WSL2 Ubuntu del PC, RTX 4060 Ti 8 GB |
| Carril | `pipeline/gpu_lane.py` (SSH `pc`, WoL, sesión SSH sostenida); ODM en `pipeline/odm_gpu_lane.py` |
| Tiers | Fast 1K y Medium 2K también corren en CUDA bajo PC-only; Cinematic 7K a Grandmaster 40K sólo CUDA |
| Autoridad | El Mac publica; el PC es un acelerador desechable. Retención del scratch: `pipeline/pc_janitor.py` |
| Cola auxiliar | `com.macmini.pc-queue` (LaunchAgent, 120 s) drena JSON de `~/.local/pc-jobs/queue/` hacia el PC; es una cola genérica ajena a este carril |


## Presets (`pipeline/splat_presets.py`, única fuente de verdad)

| Preset | iters | train_args |
|---|---|---|
| fast | 1000 | — |
| medium | 2000 | — |
| cinematic | 7000 | CUDA estricto · foto-real compartible |
| ultra | 15000 | CUDA estricto · crecimiento completo |
| ultra20 | 20000 | CUDA estricto · refinamiento post-densificación |
| frontier | 30000 | CUDA estricto · schedule completo (default interactivo) |
| grandmaster | 40000 | CUDA estricto · campaña máxima |
| mcmc1m / mcmc3m | 15000 | opt-in (W2): splatfacto + MCMC con tope de 1M / 3M gaussianas; ver SPLAT_EXPERIMENTS.md |

Fast/Medium aceptan Metal/CPU (sólo `AEROBRAIN_COMPUTE=local`, legacy) o CUDA; bajo PC-only van a CUDA. Los otros cinco sólo aceptan CUDA. En CUDA,
`auto = d1 → d2 únicamente por OOM clasificado`; `full = d1`; `half = d2`. Nunca existe
Ultra→Medium ni CUDA→Mac implícito. El sidecar conserva solicitado/efectivo, resolución,
intentos, GPU/driver, duración, gaussianas, parámetros y hash.

Los requests legacy `custom` conservan Metal/CPU sólo entre 500 y 2.000 iteraciones, dentro
del sobre local Fast/Medium. Cualquier custom por encima de 2.000 es CUDA estricto; omitir el
backend selecciona CUDA y pedir Metal/CPU se rechaza antes de encolar.

## Mac ↔ PC

`UI → API Mac → SQLite → worker Mac → SSH/WSL → RTX → PLY → Mac → .splat/SOG → gate`.
El dataset se copia primero a ext4 WSL; NTFS es sólo puente. Tras recuperar/verificar el PLY,
los staging remotos se limpian. El Mac conserva poses ODM, request, metadatos, current/history
y es el único que puede publicar. La campaña `/api/splat_campaign` hace dry-run sobre sitios
activos/modelos sueltos, verifica entorno/disco, estima cola y encola todo o nada.

Sin cap absoluto de gaussianas en el camino legacy OpenSplat (presupuesto de densificación acotado con flags, ver apéndice).

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
a las métricas de esa versión. `params_hash`, `trainer`, `stage_timings`, intentos y
telemetría CUDA ya se persisten. Sigue opcional/no universal: `eval:{psnr,ssim,lpips}`.

## Evidencia medida

Las corridas CUDA medidas (7K a 40K, tiempos, gaussianas, VRAM pico, `params_hash`) viven en un único lugar:
[README, "Evidencia medida"](../README.md#evidencia-medida-registro-único). No se duplican aquí.

## Legacy Mac path (OpenSplat / MPS)

> **Legacy.** Sólo con `AEROBRAIN_COMPUTE=local`; el build local de OpenSplat está roto hoy (dylibs de opencv).
> Reglas y gotchas: [archive/LEGACY_MAC_TRAINER.md](archive/LEGACY_MAC_TRAINER.md).
> Nota: `taskpolicy -m`, `--sh-degree-interval` y demás detalles de abajo describen ese camino.
> El límite de SH grado 0 también aplica a la ruta pública `.splat` -> SOG.

### Identidad

El contrato de producción tiene dos familias de trainer:

| Build | Runtime (CMakeCache) | Uso |
|---|---|---|
| `splat/OpenSplat/build-mps/opensplat` | **MPS** (Metal) | Fast 1K/Medium 2K local |
| `splat/OpenSplat/build/opensplat` | CPU | Fallback (`--cpu`) |
| PC WSL2 `nerfstudio-splatfacto` + gsplat 1.4 | CUDA 12.4 / RTX 4060 Ti | Único camino 7K–40K |

Selección: `choose_splat_backend()` (worker.py) — MPS si `GPU_RUNTIME==MPS` y
`xcrun --find metal` responde; si no, CPU. Corre **nativo**, no Docker
(Docker es solo para ODM). `DYLD_LIBRARY_PATH=splat/libtorch/lib`.

### Invocación exacta (`opensplat_train_cmd`, worker.py)

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
  - Fast/Medium local usan el preflight de memoria M4 y pueden recomendar `-d2`.
  - Los runs Metal antiguos de Cinematic/Ultra conservan su escalera histórica en metadata,
    pero ya no son una ruta encolable desde producto.
  - CUDA 7K–40K mantiene tier/backend: `auto` hace `d1→d2` sólo por OOM clasificado.
  - Cada intento guarda preset, escala de entrada, causa, rc, duración y pico observado.

### Qué expone el CLI (v1.1.5, `--help` verificado) — mapa de levers Phase 2

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

### Config de hardware (`config/hardware.json`)

`pipeline/hwconfig.py` — única fuente de verdad. `machine` = hechos detectados
(16GB, 4P+6E, 10 GPU cores, Docker 9.77 GiB); `caps` = límites operativos
calibrados (opensplat 11000 MiB, ODM 7g×4 / 8500m×2). `load()` chequea RAM real
vs registrada en cada arranque (~5ms); `--detect` regenera `machine`.

### Entorno de eval (verificado 2026-07-11)

Python 3.14.6 (`/Volumes/SSD/_system/venv`): torch 2.13.0 **MPS=True**,
torchvision 0.28.0, lpips 0.1.4 (forward pass probado, pesos AlexNet cacheados),
scikit-image 0.26.0 (PSNR/SSIM importables). LPIPS no es bloqueante — está.

### Medición legacy: "el Mac es capaz"

El M4 de 16 GB fue fallback local sólo para Fast 1K y Medium 2K (con `AEROBRAIN_COMPUTE=local`). Los tiers de
7K a 40K nunca fueron rutas Mac vigentes; ver la evidencia CUDA enlazada arriba.
