    const main = renderShell('system.html');
    main.innerHTML = `
      <div class="page-head"><h1>Guía de operación</h1><span class="count">cómo hacer todo</span></div>
      <div class="fl-layout">
        <div>
          <div class="panel"><div class="ph">Flujo 1 — Vuelos del dron (SD)</div>
            <div class="pb"><table class="kv">
              <tr><td>1. Vuela</td><td>DJI Flip o Neo 2, graba normal</td></tr>
              <tr><td>2. Inserta la micro SD</td><td>en el Mac Mini</td></tr>
              <tr><td>3. Ingesta</td><td class="mono">python3 pipeline/ingest.py</td></tr>
              <tr><td>4. Procesa</td><td class="mono">python3 pipeline/process.py --all</td></tr>
              <tr><td>5. Analiza</td><td class="mono">python3 ai/analyze.py --all</td></tr>
              <tr><td>6. Índice</td><td class="mono">python3 pipeline/build_index.py</td></tr>
              <tr><td>Resultado</td><td>todo aparece aquí, con mapa y AI</td></tr>
            </table>
            <p class="footer-note">V5 del roadmap automatiza los pasos 3-6 al insertar la SD.</p></div>
          </div>
          <div class="panel" style="margin-top:16px"><div class="ph">Flujo 2 — Subir video (web)</div>
            <div class="pb"><table class="kv">
              <tr><td>1. Ve a Subir</td><td>desde cualquier dispositivo</td></tr>
              <tr><td>2. Arrastra el video</td><td>MP4, MOV, MKV, AVI, MTS, WEBM</td></tr>
              <tr><td>3. Token</td><td>la primera vez: está en <span class="mono">drone-vault/.token</span></td></tr>
              <tr><td>4. Espera</td><td>el M4 hace proxy + AI solo</td></tr>
            </table></div>
          </div>
          <div class="panel" style="margin-top:16px"><div class="ph">Flujo 3 — Video de propiedad en venta</div>
            <div class="pb"><table class="kv">
              <tr><td>1. Graba el recorrido</td><td>dron + interiores con teléfono</td></tr>
              <tr><td>2. Sube ambos</td><td>por SD (dron) y por Subir (teléfono)</td></tr>
              <tr><td>3. Edita</td><td>Studio → marca los mejores cortes → Exportar</td></tr>
              <tr><td>4. Comparte</td><td>el link del vuelo o descarga el reel</td></tr>
            </table>
            <p class="footer-note">El link de un vuelo (flight.html?id=…) es compartible tal cual:
            video + mapa + datos. Ideal para mostrar la ubicación real de la propiedad.</p></div>
          </div>
        </div>
        <div>
          <div class="panel"><div class="ph">Flujo 4 — Editar y reels</div>
            <div class="pb"><table class="kv">
              <tr><td>Editor manual</td><td>Studio → elegir clip → IN/OUT → Exportar</td></tr>
              <tr><td>Reel automático</td><td class="mono">python3 ai/reel.py --vertical</td></tr>
              <tr><td>Reel de un día</td><td class="mono">ai/reel.py --date 2026-07-04</td></tr>
              <tr><td>Formatos</td><td>16:9 (YouTube) o 9:16 (IG/TikTok)</td></tr>
            </table></div>
          </div>
          <div class="panel" style="margin-top:16px"><div class="ph">Flujo 5 — Buscar en tu archivo</div>
            <div class="pb"><table class="kv">
              <tr><td>Por contenido</td><td>Vuelos → escribe "selva", "atardecer", "canchas"</td></tr>
              <tr><td>Por lugar</td><td>Mapa → click en cualquier ruta</td></tr>
              <tr><td>Por viaje</td><td>Viajes → agrupado por día</td></tr>
              <tr><td>Atajo</td><td><span class="mono">/</span> enfoca la búsqueda</td></tr>
            </table></div>
          </div>
          <div class="panel" style="margin-top:16px"><div class="ph">Atajos del player</div>
            <div class="pb"><table class="kv">
              <tr><td class="mono">espacio</td><td>play / pausa</td></tr>
              <tr><td class="mono">← →</td><td>saltar 5s</td></tr>
              <tr><td class="mono">f</td><td>pantalla completa</td></tr>
              <tr><td>Click en ruta / gráfica / filmstrip</td><td>salta a ese momento</td></tr>
            </table></div>
          </div>
        </div>
      </div>`;
