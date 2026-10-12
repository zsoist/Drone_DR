// Shared state rules for the 3D surfaces. No DOM or network dependencies.
export function originalInputs(model, version) {
  const rows = version?.sources?.length ? version.sources : model?.reconstruction?.sources;
  const sources = (rows || []).map(row => typeof row === 'string' ? row : row?.clip_id).filter(Boolean);
  return {
    sources: [...new Set(sources.length ? sources : /^recon_/.test(model?.clip_id || '') ? [] : [model?.clip_id].filter(Boolean))],
    photos: [...(version?.photos ?? model?.reconstruction?.photos ?? [])],
  };
}
export const coverageRows = (scene, shape) => scene?.coverage?.shapes?.[shape] || [];
export const loadIsCurrent = (host, token) => host._loadToken === token;
export const mapLayerIds = id => id === 'ortho' ? ['ortho', 'ortho-hd'] : [id];
export function centerReplacement(root, THREE) {
  root.rotation.x = -Math.PI / 2;
  root.updateMatrixWorld(true);
  root.position.sub(new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3()));
}
export function analysisFor(model, flights = []) {
  if (model?.ai?.summary) return model.ai;
  const ids = originalInputs(model).sources;
  return flights.find(f => ids.includes(f.clip_id) && f.ai?.summary)?.ai || null;
}
