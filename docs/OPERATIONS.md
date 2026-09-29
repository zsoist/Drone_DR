# AeroBrain Operations

Objetivo: `vuelos.metislab.work` funciona siempre que el Mac Mini esté encendido y
la sesión FileVault esté desbloqueada. La web y el streaming conservan prioridad: desde
2026-09-28 el Mac no ejecuta ODM ni entrenamiento de splats (política PC-only, ver
"Política de recursos"); el cómputo pesado va al PC GPU. La ruta legacy en que ODM/OpenSplat
usan toda la máquina cuando no hay reproducción activa sólo existe con `AEROBRAIN_COMPUTE=local`.

Ver también: [ARCHITECTURE.md](ARCHITECTURE.md) (cómo está armado hoy) y
[RUNBOOKS.md](RUNBOOKS.md) (procedimientos: restart, PC caído, rerun, promote, tests).

## SLO y definición de "up"

Una muestra externa cuenta como disponible sólo si pasan estas pruebas sin
credenciales:

1. `GET /api/healthz` devuelve 200 y `{"ok": true}`.
2. `GET /` termina en `login.html` y contiene `AeroBrain`.
3. `GET /api/whoami` devuelve 401 y no revela estado privado.
4. El manifest y una ruta media protegida devuelven 401 con cache privado y CDN
   `no-store`.

El watchdog del Mac complementa esa prueba: el último proxy real debe responder
`206 Partial Content` por loopback confiable, y el mismo URL debe responder 401
por el origen público. Un `206 HIT` público es una fuga de cache y pone
`ops_status.py` en FAIL.

Objetivo mensual: >=99%. En 30 días esto permite como máximo 7 h 18 min de caída.
El workflow `.github/workflows/uptime.yml` prueba desde infraestructura externa con cron
`*/15`, pero GitHub estrangula los cron programados: en la práctica corrió cada ~3-4 h
(99 ejecuciones en 15.5 días), así que es best-effort. El chequeo de nivel minuto es el
watchdog local (`com.aerobrain.watchdog`, 60 s). La disponibilidad aproximada mensual es:

```text
checks exitosos / checks programados * 100
```

El watchdog local cura procesos; el workflow externo detecta también Mac apagado,
internet caído, DNS o Cloudflare. No hay dashboard local (Uptime Kuma ya no corre; nada
escucha en `127.0.0.1:3001`): el estado se lee con `python3 pipeline/ops_status.py` y
`~/Library/Logs/AeroBrain/watchdog.log`. Si la sonda de frontera auth o la sonda local
fallan, el watchdog escribe `~/Library/Logs/AeroBrain/ALERT` y lanza una notificación
macOS (máx. 1/hora por causa); el archivo se borra al recuperarse.

## Arquitectura

```text
Browser/iPhone
    |
Cloudflare edge: TLS, HTTP/2+HTTP/3, Brotli
    |
Worker /*: puente HMAC de sesión + bypass de cache
    |
cloudflared (QUIC preferido, fallback HTTP/2)
    |
127.0.0.1:8790  AeroBrain web origin (threads daemon)
    |                         |
static/video Range            SQLite jobs.db
                              |
                     worker único launchd
                       |                     |
              Mac (bajo demanda)       SSH/WSL2 PC RTX (todo el cómputo)
              OrbStack: GDAL/PDAL/     ODM CUDA + gsplat 1K–40K
              OpenSfM post-proceso
```

| Servicio | LaunchAgent | Función |
|---|---|---|
| Web origin | `com.aerobrain.web` | Sirve `/web`, `/data`, APIs y video Range |
| Worker | `com.aerobrain.worker` | Reclama un solo job `3d`/`splat` de SQLite |
| Tunnel | `com.metislab.tunnel` | Publica el origin por Cloudflare Tunnel |
| Watchdog | `com.aerobrain.watchdog` | Local 60 s, público 5 min, stream+auth 15 min |
| Cola PC genérica | `com.macmini.pc-queue` | No es código de AeroBrain: cada 120 s drena JSON de `~/.local/pc-jobs/queue/` en el PC (WoL, `ssh pc`). El carril GPU de AeroBrain (`gpu_lane.py`) no la usa. |

`aerobrain-private-data-edge` no es un LaunchAgent: es el Worker de Cloudflare
versionado en `edge/`, limitado a `vuelos.metislab.work/*`.

Todos usan `RunAtLoad`; web, worker y tunnel usan `KeepAlive`. OrbStack **no**
arranca al iniciar sesión (`app.start_at_login=false`, desde 2026-09-28): el worker
lo enciende sólo cuando un job necesita un contenedor local (ver abajo).

## Política de recursos

Decisión del operador (2026-09-28): **todo el cómputo pesado corre en el PC GPU**.
El Mac sirve la web y el video y sólo hace post-proceso ligero bajo demanda.

- `pipeline/compute_policy.py` enruta cada job: ODM → CUDA `strict` (un fallo en el
  PC nunca cae al Mac, ni siquiera en presets rápidos) y todo splat → CUDA. Se aplica
  en `/api/odm`, `/api/scene_improve`, `build_splat_job_spec` y, como red de
  seguridad, al iniciar `run_3d`. `AEROBRAIN_COMPUTE=local` reactiva los caminos
  legacy (Metal 1K/2K, ODM local) para una corrida puntual.
- `pipeline/docker_ondemand.py`: OrbStack se enciende justo antes de un contenedor
  local (`sh_in_odm` de publicación, AOI, export OpenSfM→COLMAP) y el loop ocioso del
  worker lo detiene tras 5 min sin uso y sin contenedores. Arranque en frío medido:
  1.3 s. En reposo el Mac no paga la VM. Cuidado: cualquier comando `docker` enciende
  OrbStack; las sondas deben mirar `orb status` primero.
- OrbStack: tope `memory_mib=8192` (es un límite, no una reserva) y la imagen
  `opendronemap/odm` presente (GDAL 3.11, PDAL 2.9, OpenSfM) para el post-proceso.

Hardware: Mac Mini M4 (10 cores, 16 GB). PC: i7-3770S 4c/8t, 32 GB, RTX 4060 Ti 8 GB
— la GPU es el músculo, la CPU del PC es el cuello de botella en pasos no-CUDA.

- Cola única SQLite con claim atómico: nunca corren dos ODM/splats a la vez.
- Cancelación mata grupo de procesos y contenedor (local o remoto vía WSL).
- El Mac conserva request, vault y publicación. El PC sólo recibe staging, entrena y devuelve
  resultados; ningún asset remoto reemplaza `current` sin conversión, QA y browser gate en el Mac.

## Nodo PC GPU (fuerza de trabajo)

| Qué | Dónde |
|---|---|
| Red | `192.168.1.5` (MAC `BC:5F:F4:45:7E:B8`), alias `ssh pc`, WoL por `pc-wake` (si no responde: RUNBOOKS, "PC unreachable"; no confundir con `.3`) |
| WSL | distro `Ubuntu`, disco `D:\WSL\Ubuntu\ext4.vhdx` (sparse), imagen `opendronemap/odm:gpu` |
| Scratch de jobs | `/root/gpu-jobs/{data,runs,checkpoints,odm}` + `splat-env` (entorno, no tocar) |
| Puente WSL↔Mac | `D:\gpu-vault\transfer` = `/mnt/d/gpu-vault/transfer` (antes C:, que vive al 94%) |
| Config WSL | `%USERPROFILE%\.wslconfig`: 24 GB, 8 CPUs, `vmIdleTimeout=60000`, `autoMemoryReclaim=gradual`, `sparseVhd=true` |

Retención (`pipeline/pc_janitor.py`, corre al inicio de cada job GPU — sin agenda):
jobs activos nunca; `retain-until` futuro se respeta; job terminal (done/error/
cancelled) expira a los 7 días; restos sin job en el Mac, a los 30. Borra por ruta
exacta sólo hijos directos de las raíces conocidas y termina con `fstrim` para
devolver el espacio a D:. Manual: `python3 pipeline/pc_janitor.py` (dry-run) /
`--apply`. Primera pasada 2026-09-28: 64 restos de jul–ago, 110.5 GB.

Compactar el `.vhdx` a fondo requiere PowerShell **como administrador** en el PC:
`wsl --shutdown` y luego `diskpart` → `select vdisk file="D:\WSL\Ubuntu\ext4.vhdx"`,
`attach vdisk readonly`, `compact vdisk`, `detach vdisk`. Revertir sparse:
`wsl --manage Ubuntu --set-sparse false`.

`pipeline/ops_status.py` falla si ve OpenSplat/ODM/ffmpeg sin job activo. En idle,
web+worker+tunnel deben quedar <15% CPU agregado y <500 MB RSS; normalmente son
~0-2% y <100 MB.

## Cloudflare

Config local real (`~/.cloudflared/metislab-work.yml`, la que carga `com.metislab.tunnel`;
`ops_status.py` exige que contenga los dos hostnames de AeroBrain apuntando a `http://127.0.0.1:8790`):

```yaml
tunnel: 20543a36-a318-415e-b292-b88dd5f4a041
credentials-file: /Users/daniel_serverm4/.cloudflared/20543a36-a318-415e-b292-b88dd5f4a041.json

ingress:
  - hostname: vuelos.metislab.work
    service: http://127.0.0.1:8790
  - hostname: www.metislab.work
    service: http://127.0.0.1:8790
  - hostname: workspace.metislab.work
    service: http://localhost:4310
  - hostname: "*.metislab.work"
    service: http://localhost:4310
  - service: http_status:404
```

Las dos reglas de AeroBrain deben permanecer antes de cualquier wildcard (`*.metislab.work` va
a otro servicio local en `:4310`, externo a AeroBrain y hoy sin proceso escuchando: esos hostnames devuelven 502 hasta que ese backend se levante).

Existe un segundo túnel independiente, `com.cloudflare.cloudflared` (`~/.cloudflared/config.yml`,
tunnel `2b64631e-...`), que sólo publica `ssh.danielreyes.work` hacia `ssh://localhost:22`. Es de
acceso SSH al Mac, no lleva tráfico de AeroBrain y no debe reiniciarse para arreglar la web.

Para AeroBrain usar IPv4 explícito, no `localhost`: macOS puede resolverlo a `::1` mientras el
origin escucha en `127.0.0.1` (la regla `:4310` de `workspace` usa `localhost` porque ese servicio no es AeroBrain). `cloudflared` negocia QUIC y mantiene conexiones
redundantes; si UDP falla, cae a HTTP/2.

Dashboard Cloudflare recomendado:

- SSL/TLS: `Full (strict)`, Always Use HTTPS, TLS mínimo 1.2, TLS 1.3 habilitado.
  El origin además fuerza `308` para HTTP externo y emite HSTS por defensa en profundidad.
- Network: HTTP/2, HTTP/3 y Brotli habilitados.
- No activar 0-RTT: existen POST autenticados y no necesitamos riesgo de replay.
- WAF/rate limit sólo para `/api/login`, uploads y mutaciones; no desafiar
  `/api/healthz` ni video Range después del gate de sesión.
- Cache key conserva query string. El origin reescribe los placeholders `?v=`
  del HTML con `st_mtime_ns`; sólo el fingerprint exacto recibe `immutable`.
- No retirar la ruta Worker `vuelos.metislab.work/*`. Cloudflare elimina `Cookie`
  después del Worker; éste la convierte en un sobre HMAC de 30 s que el origin
  valida. Limitarlo otra vez a `/data/*` rompe el login aunque el formulario parezca
  funcionar.
- La clave compartida existe sólo como Worker secret `AEROBRAIN_EDGE_AUTH_KEY` y
  `/Volumes/SSD/drone-vault/.edge-auth-key` (`0600`). Un cliente nunca puede aportar
  headers de puente: el Worker los elimina y vuelve a firmar desde la cookie.

Deploy y comprobación del Worker:

```bash
node --test edge/test_private_data_worker.mjs
npx wrangler deploy --config edge/wrangler.toml
curl -I -H 'Range: bytes=0-0' \
  https://vuelos.metislab.work/data/proxies/DJI_20260709145011_0101_D.mp4
# anónimo: 401, CF-Cache-Status DYNAMIC, X-AeroBrain-Edge private-data-v1
```

Política emitida por el origin:

| Asset | Cache-Control |
|---|---|
| Login HTML | `private, no-store` + CDN `no-store` |
| Login JS/CSS/iconos | `private, no-cache` en el Worker |
| HTML/API autenticado | `private, no-store` + CDN `no-store` |
| MP4, fotos, mapas, splats y modelos autenticados | `private, no-cache` + CDN `no-store` |
| Respuesta 401 | `private, no-cache` + CDN `no-store` |

Cloudflare puede comprimir los assets públicos del login. Los assets privados
conservan Range y revalidación en el navegador de Daniel, pero nunca deben ser
un `HIT` compartido en el edge.

## Recovery y estabilidad

Configuración AC verificada:

```text
sleep=0  disksleep=0  autorestart=1  lowpowermode=0
```

El watchdog reintenta una vez antes de reiniciar. Un timeout aislado no mata un
ingest/edit activo. Si el proceso desaparece de launchd, sí se reinicia de inmediato.
Los logs rotan a 5 MB con una copia anterior.

Ubicación de logs (cambió el 2026-09-28): stdout/stderr de los LaunchAgents van a
`~/Library/Logs/AeroBrain/{web,worker,tunnel,watchdog.launchd}.log` (antes
`/tmp/aerobrain-web.log`, `/tmp/aerobrain-worker.log`, `/tmp/metislab-tunnel.log`,
`/tmp/aerobrain-watchdog.launchd.log`, que `/tmp` borraba en cada reinicio);
`watchdog.log` vive ahí desde antes. `ops_status.py` y la rotación del watchdog usan
las rutas nuevas.

Degradado conocido: la búsqueda semántica respaldada por Supabase está degradada — el
proyecto Supabase (`ehmfpq…`) no resuelve DNS (NXDOMAIN desde 2026-09), por lo que
`sync_supabase.py` no puede sincronizar. El esquema vive en `supabase/migrations/`.

Límite físico importante: FileVault está habilitado. Después de pérdida total de
energía, `autorestart=1` enciende el Mac, pero macOS exige desbloqueo manual antes
de iniciar los LaunchAgents. Desactivar FileVault permitiría auto-login, pero es
una decisión de seguridad, no un ajuste que este proyecto debe hacer solo.

Evidencia 2026-09-28 (upgrade a macOS 27.0): apagado ~05:50, arranque 06:18, login
07:14 → ~80 min de caída real; el workflow externo la detectó (run 36412081105).
Desde ese día el log del watchdog vive en `~/Library/Logs/AeroBrain/` y sobrevive
reinicios (antes `/tmp`, que borraba justo la evidencia de la caída).

La deriva detectada ese día (OrbStack en 4 GB, sin imagen ODM local) se resolvió con
la política PC-only + OrbStack bajo demanda descrita en "Política de recursos".

Térmica:

- No usar fan-control ni undervolt no soportado; macOS gestiona el M4.
- Mantener entradas/salida de aire libres y no encerrar el Mini con el SSD.
- No subir el tope de OrbStack por encima de 8 GB: en este host sólo hace post-proceso.
- Revisar durante un job largo: `pmset -g therm`, `memory_pressure` y la UI. Con PC-only el
  cómputo pesado está en el PC. (`docker stats` enciende OrbStack: mirar `orb status` antes.)
- **Legacy (`AEROBRAIN_COMPUTE=local`):** el scheduler reduce CPU si aparece viewer y los fallbacks de
  ODM/límites de memoria (caps 8.5/11 GB) prefieren un job degradado/failed a un host colgado.

## Operación

### Consola de jobs y reportes

La pestaña **3D → Trabajos** es la consola operativa. El polling usa resúmenes acotados; el detalle
se obtiene bajo demanda. Cada job nuevo escribe un log completo append-only en
`vault/ops/job_logs/<job-id>.log`, mientras SQLite conserva solo la cola, el resumen y eventos
estructurados (fallbacks, diagnósticos, resolución y finalización). La vista de logs pagina, busca,
filtra niveles, pausa autoscroll, copia y descarga. Jobs históricos anteriores a esta política solo
pueden mostrar su cola SQLite truncada y se etiquetan como tales.

Los reportes DeepSeek son triage, no autoridad. `error_report.py` separa intentos de tuning de
workloads por escena+calidad solicitada, incorpora cámaras/producto/fallback, no suma eventos OOM
solapados y mantiene error histórico separado de su resolución. Medium es la baseline local medida;
ningún tier CUDA 7K–40K se recomienda como mitigación de memoria de otro. Los cuerpos Markdown viven en
`ops/reports` (privado) y se leen mediante el endpoint autenticado, no por `/data` público.

### Comandos de estado

```bash
python3 pipeline/ops_status.py
python3 pipeline/external_probe.py
curl http://127.0.0.1:8790/api/healthz
curl https://vuelos.metislab.work/api/healthz
curl -I -H 'Range: bytes=0-0' \
  https://vuelos.metislab.work/data/proxies/DJI_20260709145011_0101_D.mp4
tail -40 ~/Library/Logs/AeroBrain/watchdog.log
```

### Restart seguro

```bash
pipeline/safe_restart.sh web
pipeline/safe_restart.sh tunnel
pipeline/safe_restart.sh worker  # se niega si hay 3d/splat activo
pipeline/safe_restart.sh both
```

### Campaña CUDA

Usar **3D → Procesamiento → Campaña CUDA**. El dry-run enumera sitios
activos/modelos sueltos, cámaras, bytes, tier actual, nodo, entorno CUDA y disco. La confirmación
es todo-o-nada y encola jobs strict sequentiales; `auto` conserva tier y sólo pasa `d1→d2` por
OOM CUDA clasificado. Nunca reiniciar worker mientras exista un job `queued|running`.

### Gates post-ODM y recuperación multi-fuente

Gate post-ODM para escenas multi-fuente: antes de encolar un splat, auditar el
`opensfm/reconstruction.json` persistido con la lógica actual de componente compartido.
Exigir componente elegido, cámaras exactas y aporte por prefijo. `PARTIAL`, archivo ausente o
evidencia generada por un worker anterior al gate detienen el handoff; nunca se compensan con
fallback al Mac. En el caso de OOM de splat estricto, el único retry automático permitido es
CUDA `d1→d2` conservando tier, iteraciones y `params_hash`.

ODM CUDA multi-fuente siempre usa `--sfm-no-partial`: el merge interno de reconstrucciones
parciales puede colisionar IDs de shots/landmarks y terminar con `rc=139`. Si OpenSfM ya dejó
features, matches y `tracks.csv`, una recuperación desde `opensfm` sólo es válida cuando el
conteo remoto de los tres artefactos coincide exactamente con las imágenes recién preparadas.
La recuperación archiva únicamente el `reconstruction.json` truncado y arranca ODM sin
`--rerun-from opensfm` (esa opción borraría también los caches verificados). Conserva el
workdir ante otro fallo y sigue obligada a pasar el gate post-ODM; por sí sola nunca autoriza
ni encola un splat.

OpenMVS también puede terminar con `rc=139` después de haber escrito por completo el cloud
filtrado. Eso no se clasifica como OOM sin `memory.events`/`oom_kill` positivos. La única
recuperación aceptable valida primero el PLY (header, conteo y tamaño), valida el magic `MVSI`
del MVS y persiste el diagnóstico inmutable; sólo entonces puede reanudar ODM desde
`odm_filterpoints`. En la evidencia de `recon_60b23208db`, el artefacto post-write contiene
37.473.907 puntos y la recuperación produjo 37.386.157 puntos tras el filtro estadístico.
Un archivo parcial, un magic incorrecto o una discrepancia de conteo obliga a reconstruir la
fase; nunca se publica ni abre la compuerta de splat.

### Documentación y monitoreo

La documentación no es el monitor de un job vivo. Para etapa, memoria, progreso y fallos manda
**3D → Trabajos**, `jobs.db`, `job_events` y `ops/job_logs/`. Los Markdown actuales conservan
sólo contratos y hitos cerrados con fecha/evidencia, evitando estados “corriendo” que envejecen.

### Prioridad de mantenimiento

1. Mantener power settings, LaunchAgents y Tunnel sanos; OrbStack apagado en reposo.
2. Mantener watchdog local + workflow externo verdes.
3. No romper Range/cache; verificar `206`, Brotli y `HIT` tras deploy.
4. Mantener cola heavy única (un solo job pesado a la vez). Los caps 8.5/11 GB y la prioridad adaptativa son legacy (`AEROBRAIN_COMPUTE=local`).
5. Revisar `ops_status.py` antes/después de jobs y después de cualquier reboot.
6. Para recovery totalmente desatendido tras corte: decidir conscientemente entre
   FileVault (seguridad) y auto-login (disponibilidad), o añadir UPS en el futuro.
