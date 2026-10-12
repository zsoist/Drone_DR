// Keep bookmarked map URLs on the shared flight library.
const params = new URLSearchParams(location.search);
params.set('v', 'map');
location.replace(`index.html?${params}`);
