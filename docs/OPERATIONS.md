# AeroBrain Operations

Objetivo: `vuelos.metislab.work` debe funcionar siempre que el Mac Mini este encendido,
sin gastar CPU fuerte salvo cuando Daniel lanza ODM/OpenSplat/edicion.

## Servicios

| Servicio | LaunchAgent | Funcion |
|---|---|---|
| Web origin | `com.aerobrain.web` | Sirve `127.0.0.1:8790`, `/web` y `/data` con Range para video |
| Worker | `com.aerobrain.worker` | Ejecuta jobs pesados `3d` y `splat` fuera del server web |
| Tunnel | `com.metislab.tunnel` | Cloudflare Tunnel hacia `http://127.0.0.1:8790` |
| Watchdog | `com.aerobrain.watchdog` | `/api/healthz` local cada 60s, publico cada 5 min, Range de video cada 15 min |

El tunel de vuelos debe apuntar a IPv4 explicito:

```yaml
- hostname: vuelos.metislab.work
  service: http://127.0.0.1:8790
```

No usar `localhost`: en macOS puede resolver a `::1` primero, mientras el server
escucha en `127.0.0.1`.

## Health checks

```bash
curl http://127.0.0.1:8790/api/healthz
curl https://vuelos.metislab.work/api/healthz
curl -I https://vuelos.metislab.work/tresd.html
curl -I -H 'Range: bytes=0-1048575' \
  https://vuelos.metislab.work/data/proxies/DJI_20260706133809_0101_D.mp4
tail -20 /tmp/aerobrain-watchdog.log
```

Expected video response: `206 Partial Content`, `Accept-Ranges: bytes`,
`Content-Range`, and Cloudflare `cf-cache-status` eventually `HIT`.
The watchdog uses the same idea but cheaper: `Range: bytes=0-0` against the
latest proxy video, so streaming failures are detected without downloading video.

## Safe restarts

```bash
pipeline/safe_restart.sh web      # backend/server code, does not touch jobs
pipeline/safe_restart.sh server   # alias for web
pipeline/safe_restart.sh tunnel   # Cloudflare only
pipeline/safe_restart.sh worker   # refuses while 3d/splat is running
pipeline/safe_restart.sh both     # worker + web, also refuses if heavy jobs run
```

The web server can restart during ODM/OpenSplat because heavy jobs live in the
worker and SQLite queue. Restarting the worker during a heavy job is intentionally
blocked by `safe_restart.sh`.

## Resource policy

- Idle web + tunnel + worker should sit near zero CPU.
- Video playback is served as static MP4 with HTTP Range and Cloudflare cache.
- Code and manifests are `no-store` or revalidated to avoid stale UI.
- Proxies/thumbs/photos are cacheable for 24h to avoid repeated Mac disk reads.
- ODM/OpenSplat are single-worker heavy jobs; they only consume Mac power when a
  user explicitly queues processing.

## Logs

```bash
tail -80 /tmp/aerobrain-web.log
tail -80 /tmp/aerobrain-worker.log
tail -80 /tmp/metislab-tunnel.log
tail -80 /tmp/aerobrain-watchdog.log
```

Normal: Cloudflare may log client-cancelled streams when a browser navigates away.
The web server suppresses socket-reset tracebacks so logs stay useful.

Actionable:

- repeated local probe failures in watchdog log -> web origin issue
- repeated public probe failures while local is OK -> tunnel/Cloudflare path issue
- repeated `stream_probe` failures -> public video Range path is broken or too slow
- `/api/healthz` 503 -> vault, manifest, disk free, or jobs DB issue
- worker running job with no progress -> inspect `/api/jobs` log tail before restart
