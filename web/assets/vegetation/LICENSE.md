# Vegetation assets (W5 scatter)

`tree_round.glb`, `tree_conifer.glb`, `tree_oak.glb`, `bush.glb` derive from **Nature Kit 2.1** by
Kenney (www.kenney.nl), released under **CC0 1.0 Universal** (public domain dedication):
http://creativecommons.org/publicdomain/zero/1.0/  - the original licence text is
`kenney-nature-kit-LICENSE.txt` in this folder. Source: https://kenney.nl/assets/nature-kit
(files `tree_default`, `tree_pineTallA`, `tree_oak`, `plant_bushLarge`).

Modifications (mechanical): node transforms baked, base moved to y=0 and height normalised to 1,
material colours replaced by baked vertex colours (bark brown; foliage white with a crown
ambient-occlusion gradient, tinted per instance at runtime), meshes merged into one primitive,
repacked with gltfpack (`-noq -kn`). Total size ~10 KB. Attribution is not required by CC0.
