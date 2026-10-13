// Private archive lists use the backend choice, without requiring AI quality data.
export function thumbnailURL(clip) {
  const id = clip?.clip_id;
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id || '')) return '';
  const url = clip.thumbnail_url;
  return typeof url === 'string' && (url === `/data/thumbs/${id}.jpg`
    || new RegExp(`^/data/frames/${id}/f_\\d+\\.jpg$`).test(url))
    ? url : `/data/thumbs/${id}.jpg`;
}
