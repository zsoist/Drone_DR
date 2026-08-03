export const VIEWER_MODES = Object.freeze(['cloud', 'mesh', 'splat']);

export function normalizeViewerMode(mode, availability = {}) {
  if (VIEWER_MODES.includes(mode) && availability[mode] !== false) return mode;
  return VIEWER_MODES.find(candidate => availability[candidate] !== false) || 'cloud';
}

export function shouldAutoloadViewer(mode, { mobile = false, cloudMB = 0 } = {}) {
  return mode !== 'cloud' || !mobile || Number(cloudMB) <= 25;
}

export function viewerHeaderState(mode, context = {}) {
  if (mode === 'mesh') {
    return {
      title: 'Malla texturizada',
      status: context.meshOk === false ? 'no concluyente' : `calidad ${context.meshQuality || 'lista'}`,
      loadLabel: 'Cargar malla',
    };
  }
  if (mode === 'splat') {
    const count = Number(context.splatCount || 0);
    const versionLabel = `${count} ${count === 1 ? 'versión' : 'versiones'}`;
    const detail = context.splatMB ? ` · ${Number(context.splatMB).toFixed(1)} MB` : '';
    const format = context.splatFormat ? ` · ${context.splatFormat}` : '';
    return {
      title: 'Gaussian splat',
      status: count ? `${versionLabel}${detail}${format}` : 'sin entrenar',
      loadLabel: 'Cargar Gaussian',
    };
  }
  return {
    title: 'Nube de puntos',
    status: context.cloudMB ? `${Math.round(context.cloudMB)} MB · PLY` : 'PLY',
    loadLabel: 'Cargar nube',
  };
}
