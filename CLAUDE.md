# AeroBrain

## Pitfalls
- macOS ships **openrsync**, not GNU rsync: `--info=progress2` fails with exit 1.
  Use plain `rsync -a`; monitor progress with `du -sh` on the destination.
- DJI SD cards also carry a `HYPERLAPSE/` folder next to `DCIM/DJI_001/` — ingest
  copies all of DCIM; don't assume DJI_001 is the only source of media.
- wrangler (OAuth) refuses writes in non-interactive shells: wrap with `script -q /dev/null …` for a pseudo-TTY, and export CLOUDFLARE_ACCOUNT_ID.
- R2 requires one-time dashboard activation (error 10042) + card on file — AVOIDED by design: media is served from the vault via Cloudflare Tunnel ($0).
- `cloudflared tunnel route dns` uses the default cert zone (danielreyes.work); for metislab.work pass TUNNEL_ORIGIN_CERT=~/.cloudflared/zone-certs/metislab.work.pem. (A stray CNAME vuelos.metislab.work.danielreyes.work was created by the first attempt — harmless, delete in dash when convenient.)
- Media serving = python http.server behind the tunnel; if video seeking ever feels slow, swap to Caddy (proper Range support).
