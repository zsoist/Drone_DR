export function galleryFrames(property, clip) {
  const safe = path => /^data\/frames\/[\w-]+\/f_\d+\.jpg$/.test(path);
  if (Array.isArray(property.gallery)) return property.gallery.filter(safe).slice(0,12);
  const count = Math.max(0,Math.floor(Number(clip?.frame_count) || 0));
  return Array.from({length:Math.min(8,count)},(_,i)=>`data/frames/${clip.clip_id}/f_${String(Math.floor(i*count/Math.min(8,count))+1).padStart(4,'0')}.jpg`);
}

// Local cover: DJI_20260315121003_0092_D.MP4, 2 s, 1600 × 900. Keep saved galleries first.
export function propertyCover(property, clip) {
  const frames = galleryFrames(property, clip);
  if (Array.isArray(property.gallery) && frames.length) return frames[0];
  if (property.clip === 'DJI_20260315121003_0092_D') return 'p.guaduas-cover.jpg';
  return frames[0] || (property.clip ? `data/thumbs/${encodeURIComponent(property.clip)}.jpg` : '');
}
