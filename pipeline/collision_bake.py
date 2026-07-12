#!/usr/bin/env python3
"""Hornea el proxy de colisión del splat al frame del juego (FLIGHTVERSE).

Entrada: models/<cid>/collision.collision.glb (splat-transform, frame del
splat) + transforms.splat.matrix de scene.v2.json (splat->juego, Umeyama).
Salida: models/<cid>/collision.bin — Float32 posiciones YA en metros del
juego + Uint32 índices, con sidecar collision.json. El runtime lo carga a
BufferGeometry sin GLTFLoader ni transformación (patrón dsm_lod).

Uso:  python3 collision_bake.py <clip_id>
"""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

import numpy as np

VAULT = Path("/Volumes/SSD/drone-vault")


def parse_glb(p: Path) -> tuple[np.ndarray, np.ndarray]:
    raw = p.read_bytes()
    magic, _ver, _len = struct.unpack_from("<4sII", raw, 0)
    if magic != b"glTF":
        raise SystemExit(f"{p.name}: no es GLB")
    off = 12
    gltf, bin_chunk = None, b""
    while off < len(raw):
        clen, ctype = struct.unpack_from("<I4s", raw, off)
        data = raw[off + 8: off + 8 + clen]
        if ctype == b"JSON":
            gltf = json.loads(data)
        elif ctype == b"BIN\x00":
            bin_chunk = data
        off += 8 + clen

    prim = gltf["meshes"][0]["primitives"][0]

    def acc_array(idx: int) -> np.ndarray:
        acc = gltf["accessors"][idx]
        bv = gltf["bufferViews"][acc["bufferView"]]
        start = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
        comp = {5120: np.int8, 5121: np.uint8, 5122: np.int16,
                5123: np.uint16, 5125: np.uint32, 5126: np.float32}[acc["componentType"]]
        n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}[acc["type"]]
        a = np.frombuffer(bin_chunk, dtype=comp, count=acc["count"] * n, offset=start)
        return a.reshape(acc["count"], n) if n > 1 else a

    pos = acc_array(prim["attributes"]["POSITION"]).astype(np.float32)
    idx = acc_array(prim["indices"]).astype(np.uint32)
    return pos, idx


def bake(cid: str) -> dict:
    mdir = VAULT / "models" / cid
    glb = mdir / "collision.collision.glb"
    man = json.loads((mdir / "scene.v2.json").read_text())
    tr = man["transforms"]["splat"]
    if tr.get("status") != "aligned":
        raise SystemExit(f"{cid}: splat no alineado — el proxy no tiene frame")
    M = np.array(tr["matrix"], float).reshape(4, 4)

    pos, idx = parse_glb(glb)
    hom = np.hstack([pos, np.ones((len(pos), 1), np.float32)])
    game = (M @ hom.T).T[:, :3].astype("<f4")

    out = mdir / "collision.bin"
    out.write_bytes(game.tobytes() + idx.astype("<u4").tobytes())
    side = {
        "verts": int(len(game)), "tris": int(len(idx) // 3),
        "bytes_pos": int(game.nbytes), "bytes_idx": int(idx.nbytes),
        "bounds_y": [round(float(game[:, 1].min()), 1), round(float(game[:, 1].max()), 1)],
        "source": glb.name,
    }
    (mdir / "collision.json").write_text(json.dumps(side))
    return {"cid": cid, **side, "total_mb": round((game.nbytes + idx.nbytes) / 1e6, 1)}


if __name__ == "__main__":
    print(json.dumps(bake(sys.argv[1]), indent=1))
