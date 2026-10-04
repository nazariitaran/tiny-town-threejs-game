# Rebuilds public/assets/models/roads/road-roundabout.glb from the Kenney City Kit (Roads) original
# (CC0) with fewer triangles and the same look.
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-roundabout.py
#
# The original is read from assets-src/city-kit-roads/Models/GLB format/road-roundabout.glb.
# assets-src/ is gitignored (raw downloads, see docs/assets.md), so a fresh checkout has to put the
# City Kit (Roads) there first.
#
# The underside goes (road pieces cast no shadow), coplanar faces of one colour merge, and the round
# kerb, lane and marking chains lose vertices where they stay within a small angle of the true
# circle. Every face keeps its original colormap.png cell, so the palette and the wall gradients are
# untouched. The result is one mesh with the original material block; the file is rewritten to the
# Kenney shape (relative Textures/colormap.png, nothing embedded).
import collections
import json
import math
import os
import struct

import bmesh
import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..')) if '__file__' in globals() else os.getcwd()
SRC = os.path.join(ROOT, 'assets-src/city-kit-roads/Models/GLB format/road-roundabout.glb')
OUT = os.path.join(ROOT, 'public/assets/models/roads/road-roundabout.glb')
NAME = 'road-roundabout'

WELD_DIST = 1e-5
UNDERSIDE_NORMAL_Z = -0.9            # faces pointing down further than this are the unseen underside
TOP_NORMAL_Z = 0.9
HEIGHT_DIGITS = 3                    # top faces at different heights never merge
MERGE_ANGLE_DEG = 0.5                # coplanar tolerance for merging same-colour faces

# A chain of vertices on one circle keeps only the vertices a chord needs: the chord may sag at
# most radius * (1 - cos(theta)) below the arc.
CHAIN_THETA_DEG = 8                  # kerb arcs: 48 segments become 24
LANE_THETA_DEG = 4.5                 # lane markings and entry curves stay about twice as fine
LANE_RADII = (0.7, 1.1)              # chains whose mean radius falls in this range are lane lines
MIN_SAG = 0.0008
COLUMN_DIGITS = 4                    # vertices with equal rounded (x, y) form one column (top and bottom)


def cell_of(uvs):
    """colormap.png cell (column, row from the top) of a face's mean UV"""
    u = sum(x.x for x in uvs) / len(uvs)
    v = sum(x.y for x in uvs) / len(uvs)
    return (int(u * 16), int((1 - v) * 4))


def douglas_peucker(pts, eps):
    """the subset of a chain (ends included) that stays within eps of the chain"""
    if len(pts) < 3:
        return list(pts)
    a, b = pts[0], pts[-1]
    best, split = -1, 0
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    for i in range(1, len(pts) - 1):
        p = pts[i]
        d = abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / length if length > 1e-9 else math.hypot(p[0] - a[0], p[1] - a[1])
        if d > best:
            best, split = d, i
    if best > eps:
        return douglas_peucker(pts[:split + 1], eps)[:-1] + douglas_peucker(pts[split:], eps)
    return [a, b]


def column_key(v):
    return (round(v.co.x, COLUMN_DIGITS), round(v.co.y, COLUMN_DIGITS))


def decimate_chains(bm):
    """removes the vertices of straight-walled chains (kerb, lane line) that a chord can stand in for"""
    columns = collections.defaultdict(list)
    for v in bm.verts:
        columns[column_key(v)].append(v)
    neighbours, interior = {}, {}
    for key, verts in columns.items():
        around, ok, wall_edges = set(), True, []
        for v in verts:
            horizontal = vertical = 0
            for e in v.link_edges:
                other = column_key(e.other_vert(v))
                if other == key:
                    vertical += 1
                    wall_edges.append(e)
                else:
                    horizontal += 1
                    around.add(other)
            if horizontal != 2 or vertical > 1:
                ok = False
        wall_edges = list({e for e in wall_edges})
        if len(verts) > 2 or (len(verts) == 2 and len(wall_edges) != 1) or (len(verts) == 1 and wall_edges):
            ok = False
        for e in wall_edges:
            faces = e.link_faces
            if len(faces) != 2 or faces[0].material_index != faces[1].material_index:
                ok = False
        if len(around) != 2:
            ok = False
        neighbours[key] = around
        interior[key] = ok

    seen = set()
    keep = {k for k, ok in interior.items() if not ok}
    remove = set()

    def walk(start, prev, home):
        path, cur = [], start
        while True:
            if cur == home:
                return path, True
            path.append(cur)
            if not interior[cur]:
                return path, False
            onward = [n for n in neighbours[cur] if n != prev]
            if not onward:
                return path, False
            prev, cur = cur, onward[0]

    for key in columns:
        if not interior[key] or key in seen:
            continue
        n0, n1 = list(neighbours[key])
        path0, closed = walk(n0, key, key)
        if closed:
            ring = [key] + path0
            far = max(range(len(ring)), key=lambda i: math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]))
            runs = [ring[:far + 1], ring[far:] + [ring[0]]]
            keep.add(ring[0])
            keep.add(ring[far])
        else:
            path1, _ = walk(n1, key, key)
            runs = [list(reversed(path1)) + [key] + path0]
        for run in runs:
            seen.update(run)
            radius = sum(math.hypot(c[0], c[1]) for c in run) / len(run)
            theta = LANE_THETA_DEG if LANE_RADII[0] <= radius <= LANE_RADII[1] else CHAIN_THETA_DEG
            eps = max(MIN_SAG, radius * (1 - math.cos(math.radians(theta))))
            keep.update(douglas_peucker(run, eps)[1:-1])
        for run in runs:
            for c in run:
                if interior[c] and c not in keep:
                    remove.add(c)

    wall_edges, verts = [], []
    for key in remove:
        for v in columns[key]:
            verts.append(v)
            wall_edges += [e for e in v.link_edges if column_key(e.other_vert(v)) == key]
    wall_edges = list(set(wall_edges))
    if wall_edges:
        bmesh.ops.dissolve_edges(bm, edges=wall_edges, use_verts=False, use_face_split=False)
    verts = [v for v in verts if v.is_valid]
    bmesh.ops.dissolve_verts(bm, verts=verts, use_face_split=False, use_boundary_tear=False)


def optimise():
    """imports the original, returns the optimised object alone in the scene"""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    src = next(o for o in bpy.data.objects if o.type == 'MESH')
    bm = bmesh.new()
    bm.from_mesh(src.data)
    uvl = bm.loops.layers.uv.active
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=WELD_DIST)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < UNDERSIDE_NORMAL_Z], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')

    # a face's class is its palette cell, plus its height when it faces up; merges and chain walls stay inside a class
    def face_key(f):
        up = f.normal.z > TOP_NORMAL_Z
        return (cell_of([l[uvl].uv for l in f.loops]), 'up' if up else 'side', round(f.calc_center_median().z, HEIGHT_DIGITS) if up else 0)

    keys = {f: face_key(f) for f in bm.faces}
    index = {k: i for i, k in enumerate(sorted(set(keys.values()), key=str))}
    for f in bm.faces:
        f.material_index = index[keys[f]]
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(MERGE_ANGLE_DEG), verts=bm.verts, edges=bm.edges,
                             delimit={'MATERIAL'})
    decimate_chains(bm)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    for f in bm.faces:
        f.material_index = 0
        f.smooth = False

    me = bpy.data.meshes.new('roundabout-opt')
    bm.to_mesh(me)
    bm.free()
    mat = bpy.data.materials.new('colormap')
    mat.use_backface_culling = False
    me.materials.append(mat)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    ob = bpy.data.objects.new(NAME, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def read_glb(path):
    with open(path, 'rb') as fh:
        data = fh.read()
    jlen = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + jlen])
    blen = struct.unpack_from('<I', data, 20 + jlen)[0]
    return doc, data[28 + jlen:28 + jlen + blen]


def plain(x):
    """integral floats as ints, the way the Kenney files and JSON.stringify print them"""
    if isinstance(x, float) and x.is_integer():
        return int(x)
    if isinstance(x, dict):
        return {k: plain(v) for k, v in x.items()}
    if isinstance(x, list):
        return [plain(v) for v in x]
    return x


def export(ob, path):
    bpy.context.view_layer.update()
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=True, export_animations=False, export_cameras=False,
                              export_lights=False, export_materials='EXPORT')


def rewrite(path):
    original, _ = read_glb(SRC)
    doc, blob = read_glb(path)
    for key in ('materials', 'textures', 'images', 'samplers', 'extensionsUsed'):
        doc[key] = plain(original[key])
    doc.pop('extensionsRequired', None)
    doc['asset'] = {'version': '2.0', 'generator': 'Blender glTF export, optimised from the Kenney City Kit (Roads)'}
    doc['scenes'][0]['name'] = NAME
    js = json.dumps(doc, separators=(',', ':'), ensure_ascii=False).encode()
    js += b' ' * (-len(js) % 4)
    blob += b'\0' * (-len(blob) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(blob))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + blob
    with open(path, 'wb') as fh:
        fh.write(out)


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def build():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    ob = optimise()
    export(ob, OUT)
    rewrite(OUT)
    return {'tris': tris(ob), 'bytes': os.path.getsize(OUT)}


if __name__ == '__main__' and bpy.app.background:
    print('roundabout', build())
