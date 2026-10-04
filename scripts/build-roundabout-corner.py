# Builds public/assets/models/roads/roundabout-corner.glb: the pavement piece that fills the grass wedge
# in one corner block of the roundabout.
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-roundabout-corner.py
#
# In an open Blender session, exec() this file (with __file__ set) and call build_corner(): it adds the
# piece to a "Roundabout corner" collection for review; build_corner(export_glb=True) also writes the GLB.
#
# The wedge is computed from public/assets/models/roads/road-roundabout.glb: the north-west corner block
# (x, z in [-1.5, -0.5]) minus the XZ footprint of every triangle of the roundabout model, solved as a
# constrained Delaunay triangulation of the block square and the footprints together. What remains is the
# block outside the roundabout's kerb ring, so the piece butts the kerb's own (faceted) outer wall exactly.
#
# Frame: origin at the centre of the corner block, the roundabout centre at (+1, +1) in glTF x, z. The game
# turns the piece in quarter turns about its origin for the other three corners. Top at y = 0.02, like the
# kerb tops and the pavement tiles; walls down to y = 0 only on the two block edges that face the outside
# (x = -0.5 and z = -0.5 in glTF); the arms' own walls already stand on the other two block edges, and
# the kerb wall on the curve, so the piece adds no wall and no underside there. Every face samples tile-low's
# one colormap.png texel, so the piece looks like the pavement tiles (and takes the same warm-stone tint).
import json
import math
import os
import struct

import bmesh
import bpy
from mathutils import Vector, geometry

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..')) if '__file__' in globals() else os.getcwd()
SRC = os.path.join(ROOT, 'public/assets/models/roads/road-roundabout.glb')
OUT = os.path.join(ROOT, 'public/assets/models/roads/roundabout-corner.glb')
NAME = 'roundabout-corner'

BLOCK_CENTRE = (-1.0, -1.0)           # glTF (x, z) of the north-west corner block in the roundabout's frame
HALF = 0.5                            # half a block
TOP_Z = 0.02                          # kerb top and pavement top
UV = (0.4062, 0.375)                  # tile-low's only texel (glTF (0.4062, 0.625)): cell column 6, row 2 from the top
SNAP = 1e-4                           # a vertex this close to a block edge sits on it
DIGITS = 6
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


def footprints():
    """The roundabout's triangles as XZ triangles in the block frame (origin at the block centre), counter-clockwise."""
    doc, blob = read_glb(SRC)
    prim = doc['meshes'][0]['primitives'][0]
    pos = accessor(doc, blob, prim['attributes']['POSITION'])
    idx = [i[0] for i in accessor(doc, blob, prim['indices'])]
    out = []
    for t in range(0, len(idx), 3):
        tri = [(pos[i][0] - BLOCK_CENTRE[0], pos[i][2] - BLOCK_CENTRE[1]) for i in idx[t:t + 3]]
        area = 0.5 * ((tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[2][0] - tri[0][0]) * (tri[1][1] - tri[0][1]))
        if abs(area) < MIN_AREA:
            continue
        if min(p[0] for p in tri) >= HALF or min(p[1] for p in tri) >= HALF or max(p[0] for p in tri) <= -HALF or max(p[1] for p in tri) <= -HALF:
            continue
        out.append(tri if area > 0 else [tri[0], tri[2], tri[1]])
    return out


def snap(v):
    for edge in (-HALF, HALF):
        if abs(v - edge) < SNAP:
            return edge
    return round(v, DIGITS)


def wedges():
    """Polygons (lists of (x, z)) covering the block outside every footprint, counter-clockwise."""
    verts = [Vector(p) for p in ((-HALF, -HALF), (HALF, -HALF), (HALF, HALF), (-HALF, HALF))]
    faces = [[0, 1, 2, 3]]
    for tri in footprints():
        faces.append([len(verts) + k for k in range(3)])
        verts += [Vector(p) for p in tri]
    out_v, _, out_f, _, _, orig_f = geometry.delaunay_2d_cdt(verts, [], faces, 3, 1e-7)
    polys = []
    for face, origins in zip(out_f, orig_f):
        if origins == [0]:
            polys.append([(snap(out_v[i].x), snap(out_v[i].y)) for i in face])
    return polys


def build_mesh():
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')

    def face(pts, outward):
        f = bm.faces.new([bm.verts.new(p) for p in pts])
        f.normal_update()
        if f.normal.dot(Vector(outward)) < 0:
            f.normal_flip()
        for loop in f.loops:
            loop[uvl].uv = UV
        return f

    # Blender is Z-up and its -Y becomes glTF +Z, so glTF (x, z) is Blender (x, -z)
    polys = wedges()
    for poly in polys:
        face([(x, -z, TOP_Z) for x, z in poly], (0, 0, 1))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.5), verts=bm.verts, edges=bm.edges)
    straight = [v for v in bm.verts if len(v.link_edges) == 2 and
                abs((v.link_edges[0].other_vert(v).co - v.co).normalized().dot(
                    (v.link_edges[1].other_vert(v).co - v.co).normalized()) + 1) < 1e-4]
    bmesh.ops.dissolve_verts(bm, verts=straight)
    # walls on the block edges that face the outside: glTF x = -0.5 (Blender -x) and z = -0.5 (Blender +y)
    top = [(f, [tuple(v.co) for v in f.verts]) for f in bm.faces]
    for _, pts in top:
        n = len(pts)
        for i in range(n):
            a, b = pts[i], pts[(i + 1) % n]
            wall = [(a[0], a[1], 0.0), (a[0], a[1], TOP_Z), (b[0], b[1], TOP_Z), (b[0], b[1], 0.0)]
            if a[0] == -HALF and b[0] == -HALF:
                face(wall, (-1, 0, 0))
            elif a[1] == HALF and b[1] == HALF:
                face(wall, (0, 1, 0))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    me = bpy.data.meshes.new(NAME)
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = False
    return me, len(polys)


def material():
    mat = bpy.data.materials.get('roundabout-corner')
    if mat is None:
        mat = bpy.data.materials.new('roundabout-corner')
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


def export(ob, path):
    bpy.context.view_layer.update()
    for o in bpy.context.view_layer.objects:
        o.select_set(o == ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=True, export_animations=False, export_cameras=False,
                              export_lights=False, export_materials='EXPORT')
    # rewrite like the roads kit's own files: the material block, texture and image of road-roundabout.glb
    # (relative Textures/colormap.png, nothing embedded)
    original, _ = read_glb(SRC)
    doc, blob = read_glb(path)
    for key in ('materials', 'textures', 'images', 'samplers', 'extensionsUsed'):
        doc[key] = plain(original[key])
    doc.pop('extensionsRequired', None)
    doc['asset'] = {'version': '2.0', 'generator': 'Blender glTF export, original model for Tiny Town'}
    doc['nodes'] = [{'mesh': 0, 'name': NAME}]
    doc['scenes'] = [{'nodes': [0], 'name': NAME}]
    doc['scene'] = 0
    doc['meshes'][0]['name'] = NAME
    js = json.dumps(doc, separators=(',', ':'), ensure_ascii=False).encode()
    js += b' ' * (-len(js) % 4)
    blob += b'\0' * (-len(blob) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(blob))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + blob
    with open(path, 'wb') as fh:
        fh.write(out)


def build_corner(export_glb=False, collection='Roundabout corner', location=(0.0, 0.0, 0.0)):
    coll = bpy.data.collections.get(collection) or bpy.data.collections.new(collection)
    if coll.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(coll)
    old = bpy.data.objects.get(NAME)
    if old:
        data = old.data
        bpy.data.objects.remove(old, do_unlink=True)
        if data.users == 0:
            bpy.data.meshes.remove(data)
    me, regions = build_mesh()
    me.materials.append(material())
    ob = bpy.data.objects.new(NAME, me)
    coll.objects.link(ob)
    ob.location = location
    report = {'tris': sum(len(p.vertices) - 2 for p in me.polygons), 'regions': regions,
              'size': [round(v, 4) for v in ob.dimensions]}
    if export_glb:
        loc = ob.location.copy()
        ob.location = (0, 0, 0)
        export(ob, OUT)
        ob.location = loc
        report['bytes'] = os.path.getsize(OUT)
    return report


if __name__ == '__main__' and bpy.app.background:
    print('roundabout-corner', build_corner(export_glb=True))
