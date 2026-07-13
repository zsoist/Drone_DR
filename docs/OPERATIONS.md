# AeroBrain Operations

Objetivo: `vuelos.metislab.work` funciona siempre que el Mac Mini esté encendido y
la sesión FileVault esté desbloqueada. La web y el streaming conservan prioridad;
ODM/OpenSplat usan toda la máquina cuando no hay reproducción activa.

## SLO y definición de "up"

Una muestra cuenta como disponible sólo si pasan las tres pruebas públicas:

1. `GET /api/healthz` devuelve 200 y `{"ok": true}`.
2. `GET /` devuelve 200 y contiene `AeroBrain`.
3. Un proxy descubierto desde `flights.json` responde a `Range: bytes=0-0` con
   `206 Partial Content`, un byte y `Content-Range` válido.

Objetivo mensual: >=99%. En 30 días esto permite como máximo 7 h 18 min de caída.
El workflow `.github/workflows/uptime.yml` prueba desde infraestructura externa
cada 15 minutos. La disponibilidad aproximada mensual es:

```text
checks exitosos / checks programados * 100
```

El watchdog local cura procesos; el workflow externo detecta también Mac apagado,
internet caído, DNS o Cloudflare. Uptime Kuma en `127.0.0.1:3001` sirve como
dashboard local, pero no cuenta como monitor externo porque cae junto con el Mac.

## Arquitectura

```text
Browser/iPhone
    |
Cloudflare edge: TLS, HTTP/2+HTTP/3, Brotli, cache, Range
    |
cloudflared (QUIC preferido, fallback HTTP/2)
    |
127.0.0.1:8790  AeroBrain web origin (threads daemon)
    |                         |
static/video Range            SQLite jobs.db
                              |
                     worker único launchd
                       |             |
                  ODM/OrbStack   OpenSplat MPS
```

| Servicio | LaunchAgent | Función |
|---|---|---|
| Web origin | `com.aerobrain.web` | Sirve `/web`, `/data`, APIs y video Range |
| Worker | `com.aerobrain.worker` | Reclama un solo job `3d`/`splat` de SQLite |
| Tunnel | `com.metislab.tunnel` | Publica el origin por Cloudflare Tunnel |
| Watchdog | `com.aerobrain.watchdog` | Local 60 s, público 5 min, video 15 min |

Todos usan `RunAtLoad`; web, worker y tunnel usan `KeepAlive`. OrbStack tiene
`app.start_at_login=true` para volver después de iniciar sesión.

## Política de recursos

Hardware actual: Mac Mini M4, 10 cores (4P+6E), 16 GB RAM. OrbStack: 10 cores,
10 GB RAM. OpenSplat MPS está compilado y es el backend preferido.

| Estado | ODM | OpenSplat | Web/stream |
|---|---|---|---|
| Sin viewer | 10 cores disponibles | prioridad normal + MPS | base ligera |
| Video reproduciendo | límite dinámico 7 cores | `taskpolicy -b` | 3 cores reservados |
| 45 s sin heartbeat | vuelve a 10 cores | `taskpolicy -B` | base ligera |

El reproductor envía `/api/viewer_ping` cada 15 s. El origin también registra
requests MP4 reales, excluyendo probes. El worker revisa el heartbeat cada 5 s.

Contención de memoria:

- ODM estándar: 7 GB; alta/extra/ultra: 8.5 GB, concurrencia 2.
- La VM usa ~0.75 GB en otros contenedores; 8.5 GB evita exceder sus 10 GB.
- OpenSplat: `taskpolicy -m 11000` (MiB). Usa GPU/CPU al máximo, pero el proceso
  falla contenido antes de llevar al host de 16 GB a presión extrema.
- Cola única SQLite con claim atómico: nunca corren dos ODM/splats a la vez.
- Cancelación mata grupo de procesos y contenedor; timeouts terminan y registran error.

`pipeline/ops_status.py` falla si ve OpenSplat/ODM/ffmpeg sin job activo. En idle,
web+worker+tunnel deben quedar <15% CPU agregado y <500 MB RSS; normalmente son
~0-2% y <100 MB.

## Cloudflare

Config local requerida:

```yaml
tunnel: 20543a36-a318-415e-b292-b88dd5f4a041
credentials-file: /Users/daniel_serverm4/.cloudflared/20543a36-a318-415e-b292-b88dd5f4a041.json
ingress:
  - hostname: vuelos.metislab.work
    service: http://127.0.0.1:8790
  - hostname: www.metislab.work
    service: http://127.0.0.1:8790
  - service: http_status:404
```

Si el mismo túnel mantiene `workspace` u otros hostnames, sus reglas explícitas
van antes del catch-all; las dos reglas de AeroBrain deben permanecer antes de
cualquier wildcard.

Usar IPv4 explícito, no `localhost`: macOS puede resolverlo a `::1` mientras el
origin escucha en `127.0.0.1`. `cloudflared` negocia QUIC y mantiene conexiones
redundantes; si UDP falla, cae a HTTP/2.

Dashboard Cloudflare recomendado:

- SSL/TLS: `Full (strict)`, Always Use HTTPS, TLS mínimo 1.2, TLS 1.3 habilitado.
  El origin además fuerza `308` para HTTP externo y emite HSTS por defensa en profundidad.
- Network: HTTP/2, HTTP/3 y Brotli habilitados.
- No activar 0-RTT: existen POST autenticados y no necesitamos riesgo de replay.
- WAF/rate limit sólo para `/api/login`, uploads y mutaciones; no desafiar
  `/data/*`, `/api/healthz` ni video Range.
- Cache key conserva query string. El origin reescribe los placeholders `?v=`
  del HTML con `st_mtime_ns`; sólo el fingerprint exacto recibe `immutable`.

Política emitida por el origin:

| Asset | Cache-Control |
|---|---|
| HTML | `no-store, must-revalidate` |
| JS/CSS con fingerprint exacto | `public, max-age=31536000, immutable` |
| Vendor local | `public, max-age=86400, stale-while-revalidate=604800` |
| MP4, thumbs, fotos | `public, max-age=86400` |
| Modelos 3D mutables | `no-cache` + `Last-Modified` (304) |
| Manifests/API | `no-store` |

Cloudflare comprime JS/CSS con Brotli. MP4 no se recomprime y conserva Range.
El primer request puede ser `MISS`; los siguientes deben tender a `HIT`.

## Recovery y estabilidad

Configuración AC verificada:

```text
sleep=0  disksleep=0  autorestart=1  lowpowermode=0
```

El watchdog reintenta una vez antes de reiniciar. Un timeout aislado no mata un
ingest/edit activo. Si el proceso desaparece de launchd, sí se reinicia de inmediato.
Los logs rotan a 5 MB con una copia anterior.

Límite físico importante: FileVault está habilitado. Después de pérdida total de
energía, `autorestart=1` enciende el Mac, pero macOS exige desbloqueo manual antes
de iniciar los LaunchAgents. Desactivar FileVault permitiría auto-login, pero es
una decisión de seguridad, no un ajuste que este proyecto debe hacer solo.

Térmica:

- No usar fan-control ni undervolt no soportado; macOS gestiona el M4.
- Mantener entradas/salida de aire libres y no encerrar el Mini con el SSD.
- No aumentar OrbStack por encima de 10 GB en un host de 16 GB.
- Revisar durante un job largo: `pmset -g therm`, `memory_pressure`,
  `docker stats --no-stream` y la UI. El scheduler reduce CPU si aparece viewer.
- Fallbacks de ODM y límites de memoria prefieren un job degradado/failed a un host colgado.

## Operación

La pestaña **3D → Trabajos** es la consola operativa. El polling usa resúmenes acotados; el detalle
se obtiene bajo demanda. Cada job nuevo escribe un log completo append-only en
`vault/ops/job_logs/<job-id>.log`, mientras SQLite conserva solo la cola, el resumen y eventos
estructurados (fallbacks, diagnósticos, resolución y finalización). La vista de logs pagina, busca,
filtra niveles, pausa autoscroll, copia y descarga. Jobs históricos anteriores a esta política solo
pueden mostrar su cola SQLite truncada y se etiquetan como tales.

Los reportes DeepSeek son triage, no autoridad. `error_report.py` separa intentos de tuning de
workloads por escena+calidad solicitada, incorpora cámaras/producto/fallback, no suma eventos OOM
solapados y mantiene error histórico separado de su resolución. Medium es la baseline medida;
Cinematic/Ultra nunca se recomiendan como mitigación de memoria. Los cuerpos Markdown viven en
`ops/reports` (privado) y se leen mediante el endpoint autenticado, no por `/data` público.

```bash
python3 pipeline/ops_status.py
python3 pipeline/external_probe.py
curl http://127.0.0.1:8790/api/healthz
curl https://vuelos.metislab.work/api/healthz
curl -I -H 'Range: bytes=0-0' \
  https://vuelos.metislab.work/data/proxies/DJI_20260709145011_0101_D.mp4
tail -40 /tmp/aerobrain-watchdog.log
```

Restart seguro:

```bash
pipeline/safe_restart.sh web
pipeline/safe_restart.sh tunnel
pipeline/safe_restart.sh worker  # se niega si hay 3d/splat activo
pipeline/safe_restart.sh both
```

Prioridad de implementación/mantenimiento:

1. Mantener power settings, LaunchAgents, OrbStack login y Tunnel sanos.
2. Mantener watchdog local + workflow externo verdes.
3. No romper Range/cache; verificar `206`, Brotli y `HIT` tras deploy.
4. Mantener cola heavy única, caps 8.5/11 GB y prioridad adaptativa.
5. Revisar `ops_status.py` antes/después de jobs y después de cualquier reboot.
6. Para recovery totalmente desatendido tras corte: decidir conscientemente entre
   FileVault (seguridad) y auto-login (disponibilidad), o añadir UPS en el futuro.
