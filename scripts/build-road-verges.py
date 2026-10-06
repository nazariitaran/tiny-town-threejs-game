# Builds the grass that fills what a road model leaves open in its block, in public/assets/models/roads/:
#   road-end-verge.glb           the two corners of a block outside road-end-round's rounded end
#   roundabout-corner-grass.glb  the wedge of a roundabout corner block outside the kerb ring (the same
#                                wedge as roundabout-corner.glb, which paves it)
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-road-verges.py
#
# In an open Blender session, exec() this file (with __file__ set) and call build_verges(): it adds the
# pieces to a "Road verges" collection for review; build_verges(export_glb=True) also writes the GLBs.
#
# A verge is computed from the road model itself: the block square minus the XZ footprint of every
# triangle of the model, solved as a constrained Delaunay triangulation of the square and the footprints
# together (a solved triangle stays when no footprint holds its centroid). What remains is the block outside the model's kerb, and every vertex on that kerb is the
# model's own (the same float32), so the verge butts the kerb with no gap and no overlap.
#
# Frame: the road model's own, moved so the block centre is the origin (road-end-round: unchanged, so the
# game draws the verge with the road end's matrix; the roundabout: its north-west corner block, the
# roundabout centre at (+1, +1) in glTF x, z, turned in quarter turns for the other corners). A verge is
# one flat face at ground level (y = 0.02, the kerb tops): no walls and no underside, so it can be squashed
# along the road with its road end. It samples the field's green swatch of the roads atlas.
import json
import math
import os
import struct

import bmesh
import bpy
from mathutils import Vector, geometry

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..')) if '__file__' in globals() else os.getcwd()
ROADS = os.path.join(ROOT, 'public/assets/models/roads')
ATLAS = os.path.join(ROADS, 'Textures/colormap.png')
ATLAS_PX = 512
BLOCK_PX = 32

# name -> (the road model, glTF (x, z) of the block's centre in that model's frame)
VERGES = {
    'road-end-verge': ('road-end-round.glb', (0.0, 0.0)),
    'roundabout-corner-grass': ('road-roundabout.glb', (-1.0, -1.0)),
    'roundabout-island-grass': ('road-roundabout.glb', (0.0, 0.0)),
}

HALF = 0.5                            # half a block
GROUND_Y = 0.02                       # ground level: the field, the kerb tops and the pavement
FIELD = (4, 0, '84c27c')              # the field's green: atlas column, 32 px row from the top, hex (build-pond.py)
UV = ((FIELD[0] * BLOCK_PX + 16.5) / ATLAS_PX, 1 - (FIELD[1] * BLOCK_PX + 16.5) / ATLAS_PX)
WELD = 1e-6                           # a solved vertex this close to a model vertex or a block edge is that one
MIN_AREA = 1e-9                       # footprints thinner than this are walls seen edge-on


def read_glb(path):
    with open(path, 'rb') as fh:
        data = fh.read()
    jlen = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + jlen])
    blen = struct.unpack_from('<I', data, 20 + jlen)[0]
    return doc, data[28 + jlen:28 + jlen + blen]


def accessor(doc, blob, index):
    acc = doc['accessors'][index]
    view = doc['bufferViews'][acc['bufferView']]
    off = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[acc['type']]
    fmt, size = {5126: ('f', 4), 5123: ('H', 2), 5125: ('I', 4), 5121: ('B', 1)}[acc['componentType']]
    stride = view.get('byteStride') or n * size
    return [struct.unpack_from('<' + fmt * n, blob, off + i * stride) for i in range(acc['count'])]


def footprints(src, centre):
    """The model's triangles as XZ triangles in the block frame (origin at the block centre), counter-clockwise."""
    doc, blob = read_glb(src)
    node = doc['nodes'][doc['scenes'][doc.get('scene', 0)]['nodes'][0]]
    if len(doc['nodes']) != 1 or any(key in node for key in ('matrix', 'translation', 'rotation', 'scale')):
        raise RuntimeError(f'{os.path.basename(src)}: expected one untransformed node')
    prim = doc['meshes'][0]['primitives'][0]
    pos = accessor(doc, blob, prim['attributes']['POSITION'])
    idx = [i[0] for i in accessor(doc, blob, prim['indices'])]
    out = []
    for t in range(0, len(idx), 3):
        tri = [(pos[i][0] - centre[0], pos[i][2] - centre[1]) for i in idx[t:t + 3]]
        area = 0.5 * ((tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[2][0] - tri[0][0]) * (tri[1][1] - tri[0][1]))
        if abs(area) < MIN_AREA:
            continue
        if min(p[0] for p in tri) >= HALF or min(p[1] for p in tri) >= HALF or max(p[0] for p in tri) <= -HALF or max(p[1] for p in tri) <= -HALF:
            continue
        out.append(tri if area > 0 else [tri[0], tri[2], tri[1]])
    return out


def open_polygons(src, centre):
    """Triangles (lists of (x, z)) covering the block outside every footprint, counter-clockwise."""
    prints = footprints(src, centre)
    verts = [Vector(p) for p in ((-HALF, -HALF), (HALF, -HALF), (HALF, HALF), (-HALF, HALF))]
    faces = [[0, 1, 2, 3]]
    for tri in prints:
        faces.append([len(verts) + k for k in range(3)])
        verts += [Vector(p) for p in tri]
    out_v, _, out_f, _, _, _ = geometry.delaunay_2d_cdt(verts, [], faces, 0, 1e-7)
    model = sorted({(v.x, v.y) for v in verts[4:]})

    def weld(v):
        near = min(model, key=lambda p: (p[0] - v.x) ** 2 + (p[1] - v.y) ** 2)
        x, z = near if math.hypot(near[0] - v.x, near[1] - v.y) < WELD else (v.x, v.y)
        on_edge = lambda c: next((e for e in (-HALF, HALF) if abs(c - e) < WELD), c)
        return (on_edge(x), on_edge(z))

    def covered(p):
        for a, b, c in prints:
            if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0
                    and (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]) >= 0
                    and (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]) >= 0):
                return True
        return False

    # every solved triangle lies wholly inside or outside each footprint, so its centroid decides
    out = []
    for face in out_f:
        tri = [out_v[i] for i in face]
        mid = ((tri[0].x + tri[1].x + tri[2].x) / 3, (tri[0].y + tri[1].y + tri[2].y) / 3)
        area = 0.5 * ((tri[1].x - tri[0].x) * (tri[2].y - tri[0].y) - (tri[2].x - tri[0].x) * (tri[1].y - tri[0].y))
        if area > MIN_AREA and max(abs(mid[0]), abs(mid[1])) < HALF and not covered(mid):
            out.append([weld(v) for v in tri])
    return out


def build_mesh(name, src, centre):
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    made = {}

    def vert(co):
        if co not in made:
            made[co] = bm.verts.new(co)
        return made[co]

    # Blender is Z-up and its -Y becomes glTF +Z, so glTF (x, z) is Blender (x, -z)
    polys = open_polygons(src, centre)
    for poly in polys:
        corners = []
        for x, z in poly:
            v = vert((x, -z, GROUND_Y))
            if v not in corners:
                corners.append(v)
        if len(corners) < 3:
            continue
        f = bm.faces.new(corners)
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
    # one face per flat region; the outline keeps every vertex, so each kerb vertex has its twin on the verge
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.5), verts=[], edges=bm.edges)
    regions = len(bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    for f in bm.faces:
        for loop in f.loops:
            loop[uvl].uv = UV
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = False
    return me, regions


def check_swatch():
    """Fails if the field swatch is not where this script samples it."""
    image = bpy.data.images.load(ATLAS, check_existing=True)
    image.reload()
    w, h = image.size
    x, y = FIELD[0] * BLOCK_PX + 16, h - 1 - (FIELD[1] * BLOCK_PX + 16)
    got = ''.join(f'{round(c * 255):02x}' for c in image.pixels[(y * w + x) * 4:(y * w + x) * 4 + 3])
    if got != FIELD[2]:
        raise RuntimeError(f'colormap.png swatch at cell block {FIELD[:2]} is {got}, expected {FIELD[2]}')


def material():
    mat = bpy.data.materials.get('road-verge')
    if mat is None:
        mat = bpy.data.materials.new('road-verge')
        mat.diffuse_color = (0.231, 0.539, 0.202, 1.0)      # viewport only: the swatch, linear
    mat.use_backface_culling = False
    return mat


def plain(x):
    """integral floats as ints, the way the Kenney files and JSON.stringify print them"""
    if isinstance(x, float) and x.is_integer():
        return int(x)
    if isinstance(x, dict):
        return {k: plain(v) for k, v in x.items()}
    if isinstance(x, list):
        return [plain(v) for v in x]
    return x


def export(ob, src, path):
    bpy.context.view_layer.update()
    for o in bpy.context.view_layer.objects:
        o.select_set(o == ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=True, export_animations=False, export_cameras=False,
                              export_lights=False, export_materials='EXPORT')
    # rewrite like the roads kit's own files: the material block, texture and image of the road model
    # (relative Textures/colormap.png, nothing embedded)
    original, _ = read_glb(src)
    doc, blob = read_glb(path)
    for key in ('materials', 'textures', 'images', 'samplers', 'extensionsUsed'):
        doc[key] = plain(original[key])
    doc.pop('extensionsRequired', None)
    doc['asset'] = {'version': '2.0', 'generator': 'Blender glTF export, original model for Tiny Town'}
    doc['nodes'] = [{'mesh': 0, 'name': ob.name}]
    doc['scenes'] = [{'nodes': [0], 'name': ob.name}]
    doc['scene'] = 0
    doc['meshes'][0]['name'] = ob.name
    js = json.dumps(doc, separators=(',', ':'), ensure_ascii=False).encode()
    js += b' ' * (-len(js) % 4)
    blob += b'\0' * (-len(blob) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(blob))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + blob
    with open(path, 'wb') as fh:
        fh.write(out)


def build_verges(export_glb=False, collection='Road verges', origin=(0.0, 0.0, 0.0), pitch=1.5):
    """Builds every verge into `collection`, in a row from `origin`; returns triangles, regions and area per piece."""
    check_swatch()
    coll = bpy.data.collections.get(collection) or bpy.data.collections.new(collection)
    if coll.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(coll)
    for old in [o for o in coll.objects]:
        data = old.data
        bpy.data.objects.remove(old, do_unlink=True)
        if data and data.users == 0:
            bpy.data.meshes.remove(data)
    report = {}
    for i, (name, (model, centre)) in enumerate(VERGES.items()):
        src = os.path.join(ROADS, model)
        me, regions = build_mesh(name, src, centre)
        me.materials.append(material())
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        ob.location = (origin[0] + i * pitch, origin[1], origin[2])
        report[name] = {'tris': len(me.polygons), 'regions': regions, 'area': round(sum(p.area for p in me.polygons), 6)}
        if export_glb:
            location = ob.location.copy()
            ob.location = (0, 0, 0)
            path = os.path.join(ROADS, f'{name}.glb')
            try:
                export(ob, src, path)
            finally:
                ob.location = location
            report[name]['bytes'] = os.path.getsize(path)
    return report


if __name__ == '__main__' and bpy.app.background:
    for piece, info in build_verges(export_glb=True).items():
        print(piece, info)
