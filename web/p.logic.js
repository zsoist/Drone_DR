export function galleryFrames(property, clip) {
  const safe = path => /^data\/frames\/[\w-]+\/f_\d+\.jpg$/.test(path);
  if (Array.isArray(property.gallery)) return property.gallery.filter(safe).slice(0,12);
  const count = Math.max(0,Math.floor(Number(clip?.frame_count) || 0));
  return Array.from({length:Math.min(8,count)},(_,i)=>`data/frames/${clip.clip_id}/f_${String(Math.floor(i*count/Math.min(8,count))+1).padStart(4,'0')}.jpg`);
}
