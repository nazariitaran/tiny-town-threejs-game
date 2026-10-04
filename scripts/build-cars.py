# Rebuilds the four cars (public/assets/models/cars/{hatchback-sports,van,taxi,sedan}.glb) from the
# Kenney Car Kit 3.1 (CC0) originals by removing the faces nothing can see and rebuilding the wheels.
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-cars.py
#
# The originals are read from assets-src/car-kit/Models/GLB format/<car>.glb. assets-src/ is gitignored
# (raw downloads, see docs/assets.md), so a fresh checkout has to put the Car Kit there first.
#
# Per car: the body keeps every face a ray from the outside can reach (underside, wheel-arch interiors
# and anything behind a wheel go), a one-quad underside lid stays because shadows are cast from back
# faces, and the four wheels are rebuilt as 16-sided tyres with a hub dish. All faces keep their
# original colormap.png cells, so the night-glow cells (headlights, tail lights) are untouched. The
# result is one mesh with the original material block; the file is rewritten to the Kenney shape
# (relative Textures/colormap.png, nothing embedded).
import collections
import json
import math
import os
import struct

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..')) if '__file__' in globals() else os.getcwd()
SRC_DIR = os.path.join(ROOT, 'assets-src/car-kit/Models/GLB format')
OUT_DIR = os.path.join(ROOT, 'public/assets/models/cars')

# Wheel centre offset from the car centre along the length (Blender y; the nose is -Y, glTF +Z).
WHEEL_Y = {'hatchback-sports': 0.81, 'van': 0.76, 'taxi': 0.76, 'sedan': 0.66}
WHEEL_Z = 0.30                       # wheel centre height
SIDES = 16                           # tyre polygon sides
SMOOTH_ANGLE_DEG = 14                # faces meeting at less than this share smooth normals

# Tyre profile: tread x range, shoulder x, outer face x, dish x; radii of tread, shoulder, rim, hub cap.
TREAD_IN_X, TREAD_OUT_X, FACE_X = 0.35, 0.50, 0.60
DISH_X = 0.555
R_TREAD, R_SHOULDER, R_RIM, R_HUB = 0.30, 0.255, 0.18, 0.09

# colormap.png cells (column, row from the top).
ARCH_CELL = (5, 2)                   # wheel-arch liners and the tyre
UNDERSIDE_Z = 0.15                   # height of the shadow lid
LID_INSET_Y = 0.3                    # lid distance from the body's front and rear ends
LID_HALF_X = 0.5
ARCH_INBOARD_X = 0.4                 # the arch wall that sits inside the tyre

VIEW_DIRS = 160                      # rays per face for the visibility test
MIN_FACING = 0.15                    # a ray must leave the face at least this far off its plane


def cell_of(uvs):
    u = sum(x.x for x in uvs) / len(uvs)
    v = sum(x.y for x in uvs) / len(uvs)
    return (int(u * 16), int((1 - v) * 4))


def cell_uvs(me):
    """cell -> mean UV of the faces using it"""
    uv = me.uv_layers.active.data
    acc = collections.defaultdict(list)
    for p in me.polygons:
        us = [uv[i].uv for i in p.loop_indices]
        acc[cell_of(us)].append((sum(x.x for x in us) / len(us), sum(x.y for x in us) / len(us)))
    return {c: Vector((sum(a[0] for a in lst) / len(lst), sum(a[1] for a in lst) / len(lst))) for c, lst in acc.items()}


def hemisphere(n=VIEW_DIRS):
    """near-uniform (golden spiral) directions over the upper hemisphere and a little below"""
    out = []
    for i in range(n):
        z = 1 - 2 * (i + 0.5) / n
        r = math.sqrt(1 - z * z)
        a = i * 2.399963
        d = Vector((r * math.cos(a), r * math.sin(a), z))
        if d.z > -0.05:
            out.append(d)
    return out


def import_car(name):
    """imports the original into an empty scene; returns (body, [wheels])"""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC_DIR, f'{name}.glb'))
    body = bpy.data.objects['body']
    wheels = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('wheel')]
    return body, wheels


def body_mesh(body, wheels):
    """the original body with hidden faces removed, in the car frame (origin at the centre, on the ground)"""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.transform(Matrix.Translation(body.location))
    uvl = bm.loops.layers.uv.active
    # occluders: the body and the four original wheels
    occ = bm.copy()
    for w in wheels:
        m = w.data.copy()
        m.transform(w.matrix_world)
        occ.from_mesh(m)
        bpy.data.meshes.remove(m)
    occ.faces.ensure_lookup_table()
    bvh = BVHTree.FromBMesh(occ)
    dirs = hemisphere()
    hidden = []
    for f in bm.faces:
        if cell_of([l[uvl].uv for l in f.loops]) == ARCH_CELL:
            continue                     # arch liners: partial fans would leave holes, keep them whole
        c = f.calc_center_median()
        nrm = f.normal
        seen = False
        for d in dirs:
            if d.dot(nrm) < MIN_FACING:
                continue
            if bvh.ray_cast(c + nrm * 0.003, d)[0] is None:
                seen = True
                break
        if not seen:
            hidden.append(f)
    # the inboard wall of each arch sits inside the tyre
    for f in bm.faces:
        if (cell_of([l[uvl].uv for l in f.loops]) == ARCH_CELL and abs(f.normal.x) > 0.9
                and all(abs(abs(v.co.x) - ARCH_INBOARD_X) < 0.01 for v in f.verts)):
            hidden.append(f)
    down_uv = [l[uvl].uv.copy() for f in hidden if f.normal.z < -0.9 for l in f.loops]
    lid_uv = sum(down_uv, Vector((0, 0))) / len(down_uv)
    y_min = min(v.co.y for v in bm.verts)
    y_max = max(v.co.y for v in bm.verts)
    bmesh.ops.delete(bm, geom=hidden, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    # shadows are cast from back faces, so the underside has to exist
    pts = ((-LID_HALF_X, y_min + LID_INSET_Y), (LID_HALF_X, y_min + LID_INSET_Y),
           (LID_HALF_X, y_max - LID_INSET_Y), (-LID_HALF_X, y_max - LID_INSET_Y))
    lid = bm.faces.new([bm.verts.new(Vector((x, y, UNDERSIDE_Z))) for x, y in pts])
    lid.normal_update()
    if lid.normal.z > 0:
        lid.normal_flip()
    for l in lid.loops:
        l[uvl].uv = lid_uv
    occ.free()
    return bm


def add_wheels(bm, name, wheel_mesh):
    """16-sided tyres with a hub dish; returns the tread and shoulder faces (smooth-shaded)"""
    uvl = bm.loops.layers.uv.active
    smooth = {'tread': [], 'shoulder': []}
    cells = cell_uvs(wheel_mesh)
    tyre_uv = cells[ARCH_CELL]
    hub_uv = [v for c, v in cells.items() if c != ARCH_CELL][0]

    def face(pts, uv, outward, tag=None):
        f = bm.faces.new([bm.verts.new(Vector(p)) for p in pts])
        f.normal_update()
        if f.normal.dot(Vector(outward)) < 0:
            f.normal_flip()
        for l in f.loops:
            l[uvl].uv = uv
        if tag:
            smooth[tag].append(f)

    for sx in (1, -1):
        for sy in (1, -1):
            cy = sy * WHEEL_Y[name]

            def P(x, r, k):
                a = 2 * math.pi * (k + 0.5) / SIDES
                r = r / math.cos(math.pi / SIDES)      # flat on the ground and flat on top
                return (sx * x, cy + r * math.cos(a), WHEEL_Z + r * math.sin(a))

            for k in range(SIDES):
                k2 = (k + 1) % SIDES
                my = (P(0.45, R_TREAD, k)[1] + P(0.45, R_TREAD, k2)[1]) / 2 - cy
                mz = (P(0.45, R_TREAD, k)[2] + P(0.45, R_TREAD, k2)[2]) / 2 - WHEEL_Z
                face([P(TREAD_IN_X, R_TREAD, k), P(TREAD_OUT_X, R_TREAD, k), P(TREAD_OUT_X, R_TREAD, k2), P(TREAD_IN_X, R_TREAD, k2)],
                     tyre_uv, (0, my, mz), 'tread')
                face([P(TREAD_OUT_X, R_TREAD, k), P(FACE_X, R_RIM, k), P(FACE_X, R_RIM, k2), P(TREAD_OUT_X, R_TREAD, k2)],
                     tyre_uv, (sx * 0.8, my, mz), 'shoulder')
                face([P(FACE_X, R_RIM, k), P(DISH_X, R_HUB, k), P(DISH_X, R_HUB, k2), P(FACE_X, R_RIM, k2)],
                     hub_uv, (sx * 0.5, -my * 0.5, -mz * 0.5))
            face([P(DISH_X, R_HUB, k) for k in range(SIDES)], hub_uv, (sx, 0, 0))
    return smooth


def shade(bm, smooth):
    """smooth only across near-coplanar faces so gentle ridges read flat; the tyres are round"""
    bm.normal_update()
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) != 2 or e.link_faces[0].normal.angle(e.link_faces[1].normal) > math.radians(SMOOTH_ANGLE_DEG):
            e.smooth = False
    tread, shoulder = set(smooth['tread']), set(smooth['shoulder'])
    for e in bm.edges:
        if len(e.link_faces) != 2:
            continue
        a, b = e.link_faces
        if (a in tread and b in tread) or (a in shoulder and b in shoulder):
            e.smooth = True
        elif (a in tread and b in shoulder) or (a in shoulder and b in tread):
            e.smooth = False


def build(name):
    """builds the optimised car in the current scene; returns the object and the original material block"""
    body, wheels = import_car(name)
    wheel = next(w for w in wheels if w.name.startswith('wheel-front-left'))
    bm = body_mesh(body, wheels)
    smooth = add_wheels(bm, name, wheel.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    shade(bm, smooth)
    me = bpy.data.meshes.new(f'{name}-v2')
    bm.to_mesh(me)
    bm.free()
    mat = bpy.data.materials.new('colormap')
    mat.use_backface_culling = False
    me.materials.append(mat)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    ob = bpy.data.objects.new(name, me)
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


def rewrite(path, name):
    original, _ = read_glb(os.path.join(SRC_DIR, f'{name}.glb'))
    doc, blob = read_glb(path)
    for key in ('materials', 'textures', 'images', 'samplers', 'extensionsUsed'):
        doc[key] = plain(original[key])
    doc.pop('extensionsRequired', None)
    doc['asset'] = {'version': '2.0', 'generator': 'Blender glTF export, optimised from the Kenney Car Kit'}
    doc['scenes'][0]['name'] = name
    js = json.dumps(doc, separators=(',', ':'), ensure_ascii=False).encode()
    js += b' ' * (-len(js) % 4)
    blob += b'\0' * (-len(blob) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(blob))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + blob
    with open(path, 'wb') as fh:
        fh.write(out)


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def build_all():
    os.makedirs(OUT_DIR, exist_ok=True)
    report = {}
    for name in WHEEL_Y:
        ob = build(name)
        path = os.path.join(OUT_DIR, f'{name}.glb')
        export(ob, path)
        rewrite(path, name)
        report[name] = {'tris': tris(ob), 'bytes': os.path.getsize(path)}
    return report


if __name__ == '__main__' and bpy.app.background:
    for car, info in build_all().items():
        print('car', car, info)
