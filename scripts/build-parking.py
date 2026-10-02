# Builds the parking lots and their road joints (public/assets/models/parking/*.glb) from the Kenney
# City Kit (Roads) atlas and road pieces.
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-parking.py
#
# In an open Blender session, exec() this file and call build_all() / build_joints(): they add the
# models to the "Parking" / "Parking joints" collections for review; export_glb=True also writes them.
#
# Units are game world units (a road tile = 1, a cell = 0.5). Blender is Z-up; the exporter's +Y-up
# conversion turns Blender -Y into glTF +Z, so the entrance (front, Blender -Y) faces +Z at rotation 0.
# Every face samples one colormap.png texel, like the Kenney road pieces, and the GLBs reference
# ../roads/Textures/colormap.png, so the game shares the road material (and its warm-stone tint).
import json
import math
import os
import struct

import bmesh
import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..')) if '__file__' in globals() else os.getcwd()
OUT_DIR = os.path.join(ROOT, 'public/assets/models/parking')
ATLAS = os.path.join(ROOT, 'public/assets/models/roads/Textures/colormap.png')
ATLAS_URI = '../roads/Textures/colormap.png'

# colormap.png texels (Blender UV, v up). The light periwinkle ones are warmed to stone in game; the
# sign blue sits below the warm tint's luminance cut so it stays blue.
UV = {
    'asphalt': (0.2812, 0.125),    # 666b80, the road carriageway
    'bay': (0.0312, 0.125),        # 515566, the road's darker kerb-side strip
    'paint': (0.4062, 0.125),      # 8e95b3, lane paint
    'walk_top': (0.4688, 0.475),   # sidewalk top
    'kerb_face': (0.4688, 0.375),  # kerb face
    'base': (0.4688, 0.275),       # underside
    'slab_side': (0.3438, 0.125),  # asphalt edge
    'pole': (0.2812, 0.375),       # 4f5260
    'sign_blue': (0.7200, 0.560),  # 5b64c3
    'white': (0.5300, 0.375),      # ffffff
    'grass': (0.9062, 0.125),      # 61cb8b
    'leaf_lo': (0.9688, 0.060),
    'leaf_hi': (0.9688, 0.200),
}

ASPHALT_Z = 0.01  # road surface height
KERB_Z = 0.02     # road kerb / sidewalk height
KERB_W = 0.1      # road sidewalk width
STALL_W = 0.35    # cars are 0.22-0.255 wide
STALL_D = 0.6     # cars are 0.43-0.48 long
LINE_W = 0.02     # road centre-line width
APRON_D = 0.5     # drive-in strip behind the entrance
ISLAND_D = 0.3
AISLE_W = 0.6     # the road carriageway width

# blocks: (across, deep) road blocks; the front row of blocks is the entrance side.
VARIANTS = {
    'parking-small': dict(blocks=(2, 1), kind='bays', groups=(4,)),
    'parking-medium': dict(blocks=(2, 2), kind='aisle', groups=(4,)),
    'parking-large': dict(blocks=(2, 3), kind='aisle', groups=(3, 3)),
}


def stall_lines(x0, x1, y0, n, along_y):
    """Dividers at every boundary of n stalls starting at y0 (or x0 when the stalls run along x)."""
    out = []
    for k in range(n + 1):
        c = y0 + k * STALL_W
        a = min(max(c - LINE_W / 2, y0), y0 + n * STALL_W - LINE_W)
        out.append((x0, a, x1, a + LINE_W) if along_y else (a, x0, a + LINE_W, x1))
    return out


def layout(spec):
    """Lot space: x in [0, W], y in [0, D], y = 0 the open front. Returns W, D, ground rects (later wins),
    planters (raised beds with bushes) and the sign position."""
    bw, bd = spec['blocks']
    W, D = float(bw), float(bd)
    K = KERB_W
    rects, planters = [], []

    def kerb(x0, y0, x1, y1):
        rects.append((x0, y0, x1, y1, KERB_Z, 'walk_top'))

    if spec['kind'] == 'bays':
        # nose-in bays straight off the street, a planted kerb behind them
        n = spec['groups'][0]
        run = n * STALL_W
        side = (W - 2 * K - run) / 2
        kerb(0, 0, K, D)
        kerb(W - K, 0, W, D)
        kerb(0, STALL_D, W, D)
        rects.append((K + side, 0, K + side + run, STALL_D, ASPHALT_Z, 'bay'))
        for l in stall_lines(0.04, STALL_D, K + side, n, along_y=False):
            rects.append((*l, ASPHALT_Z, 'paint'))
        for x0 in (K, W - K - side):
            kerb(x0, 0, x0 + side, STALL_D)
            planters.append((x0, 0, x0 + side, STALL_D, 1))
        planters.append((K, STALL_D, W - K, D, 4))
        sign = (K + side / 2, 0.08)
    else:
        # entrance apron across the front, an aisle down the middle, stalls on both sides
        kerb(0, 0, K, D)
        kerb(W - K, 0, W, D)
        kerb(0, D - K, W, D)
        for b in range(1, bw):
            kerb(b - K, 0, b + K, K)  # matches the kerbs of two road tiles joining side by side
        cols = ((K, K + STALL_D), (W - K - STALL_D, W - K))
        for x0, x1 in cols:
            y = APRON_D
            for gi, n in enumerate(spec['groups']):
                rects.append((x0, y, x1, y + n * STALL_W, ASPHALT_Z, 'bay'))
                for l in stall_lines(x0, x1, y, n, along_y=True):
                    rects.append((*l, ASPHALT_Z, 'paint'))
                y += n * STALL_W
                if gi < len(spec['groups']) - 1:
                    kerb(x0, y, x1, y + ISLAND_D)
                    planters.append((x0, y, x1, y + ISLAND_D, 2))
                    y += ISLAND_D
        sign = (W / 2, K / 2)
    return W, D, rects, planters, sign


class Builder:
    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.verts = {}

    def v(self, co):
        key = tuple(round(c, 5) for c in co)
        vert = self.verts.get(key)
        if vert is None:
            vert = self.verts[key] = self.bm.verts.new(key)
        return vert

    def face(self, cos, uv):
        f = self.bm.faces.new([self.v(c) for c in cos])
        for loop in f.loops:
            loop[self.uv].uv = UV[uv]

    def box(self, x0, y0, z0, x1, y1, z1, top, side, sides=None, bottom=None):
        s = sides or {}
        self.face([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], top)
        self.face([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], s.get('-y', side))
        self.face([(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)], s.get('+y', side))
        self.face([(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)], s.get('-x', side))
        self.face([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], s.get('+x', side))
        if bottom:
            self.face([(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)], bottom)

    def ground(self, W, D, rects):
        """Cuts the lot into a grid at every rect edge, so paint and kerbs never overlap the asphalt."""
        xs = sorted({round(v, 5) for v in (0.0, W, *[r[0] for r in rects], *[r[2] for r in rects])})
        ys = sorted({round(v, 5) for v in (0.0, D, *[r[1] for r in rects], *[r[3] for r in rects])})
        cell = {}
        for i in range(len(xs) - 1):
            for j in range(len(ys) - 1):
                cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
                h, uv = ASPHALT_Z, 'asphalt'
                for x0, y0, x1, y1, rh, ruv in rects:
                    if x0 <= cx <= x1 and y0 <= cy <= y1:
                        h, uv = rh, ruv
                cell[i, j] = (h, uv)
        for (i, j), (h, uv) in cell.items():
            self.face([(xs[i], ys[j], h), (xs[i + 1], ys[j], h), (xs[i + 1], ys[j + 1], h), (xs[i], ys[j + 1], h)], uv)
        for (i, j), (h, _) in cell.items():
            x0, x1, y0, y1 = xs[i], xs[i + 1], ys[j], ys[j + 1]
            # each side as (neighbour, a, b): a -> b runs with the outside on the right
            for nb, a, b in (((i, j - 1), (x0, y0), (x1, y0)), ((i + 1, j), (x1, y0), (x1, y1)),
                             ((i, j + 1), (x1, y1), (x0, y1)), ((i - 1, j), (x0, y1), (x0, y0))):
                if nb in cell:
                    lo, uv = cell[nb][0], 'kerb_face'
                    if lo >= h:
                        continue
                else:
                    lo, uv = 0.0, 'walk_top' if h >= KERB_Z else 'slab_side'
                self.face([(a[0], a[1], lo), (b[0], b[1], lo), (b[0], b[1], h), (a[0], a[1], h)], uv)
        self.face([(0, 0, 0), (0, D, 0), (W, D, 0), (W, 0, 0)], 'base')

    def bush(self, cx, cy, r, z0):
        tmp = bmesh.new()
        bmesh.ops.create_icosphere(tmp, subdivisions=1, radius=r)
        bmesh.ops.scale(tmp, vec=(1, 1, 0.8), verts=tmp.verts)
        bmesh.ops.translate(tmp, vec=(cx, cy, z0 + r * 0.7), verts=tmp.verts)
        for f in tmp.faces:
            self.face([v.co.copy() for v in f.verts], 'leaf_hi' if f.normal.z > 0.35 else 'leaf_lo')
        tmp.free()

    def planter(self, x0, y0, x1, y1, bushes):
        m = 0.04
        self.box(x0 + m, y0 + m, KERB_Z, x1 - m, y1 - m, KERB_Z + 0.012, 'grass', 'grass')
        long_x = (x1 - x0) >= (y1 - y0)
        span = (x1 - x0) if long_x else (y1 - y0)
        r = min(0.09, ((y1 - y0) if long_x else (x1 - x0)) / 2 - m)
        for k in range(bushes):
            t = (k + 0.5) / bushes
            rr = r * (0.8 if k % 2 else 1.0)
            if long_x:
                self.bush(x0 + span * t, (y0 + y1) / 2, rr, KERB_Z)
            else:
                self.bush((x0 + x1) / 2, y0 + span * t, rr, KERB_Z)

    def sign(self, x, y, z0):
        """A blue 'P' sign facing the entrance; the P is drawn on both faces."""
        pw, ph, pt = 0.15, 0.15, 0.02
        p = 0.008  # the pole is thinner than the plate and ends inside it
        zb = z0 + 0.2
        self.box(x - p, y - p, z0, x + p, y + p, zb + ph / 2, 'pole', 'pole')
        self.box(x - pw / 2, y - pt / 2, zb, x + pw / 2, y + pt / 2, zb + ph, 'white', 'white',
                 sides={'-y': 'sign_blue', '+y': 'sign_blue'}, bottom='white')
        u, s = 0.1 / 5, 0.075 / 3  # the P on a 3 x 5 grid
        px0, pz0 = x - 0.0375, zb + (ph - 0.1) / 2
        quads = ((0, 0, 1, 5), (1, 4, 3, 5), (1, 2, 3, 3), (2, 3, 3, 4))
        for back, yy in ((False, y - pt / 2 - 0.0015), (True, y + pt / 2 + 0.0015)):
            for c0, r0, c1, r1 in quads:
                xa, xb = px0 + c0 * s, px0 + c1 * s
                if back:
                    xa, xb = 2 * x - xb, 2 * x - xa
                za, zc = pz0 + r0 * u, pz0 + r1 * u
                pts = [(xa, yy, za), (xb, yy, za), (xb, yy, zc), (xa, yy, zc)]
                self.face(list(reversed(pts)) if back else pts, 'white')

    def mesh(self, name, material, offset):
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.5), verts=list(bm.verts), edges=list(bm.edges),
                                 delimit={'UV'})
        bmesh.ops.translate(bm, vec=offset, verts=bm.verts)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for poly in me.polygons:
            poly.use_smooth = False
        me.materials.append(material)
        return me


def build_mesh(name, spec, material):
    W, D, rects, planters, sign = layout(spec)
    b = Builder()
    b.ground(W, D, rects)
    for x0, y0, x1, y1, n in planters:
        b.planter(x0, y0, x1, y1, n)
    b.sign(*sign, KERB_Z)
    return b.mesh(name, material, Vector((-W / 2, -D / 2, 0))), W, D


def atlas_material():
    mat = bpy.data.materials.get('parking-colormap')
    if mat:
        return mat
    mat = bpy.data.materials.new('parking-colormap')
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 1.0
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(ATLAS, check_existing=True)
    tex.interpolation = 'Closest'
    mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    return mat


def kenney_style(path, name):
    """Rewrites an exported GLB like the Kenney kit's: the atlas as an external image, no embedded copy,
    a metalness-0 double-sided material named colormap."""
    with open(path, 'rb') as fh:
        data = fh.read()
    jlen = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + jlen])
    blen = struct.unpack_from('<I', data, 20 + jlen)[0]
    blob = data[28 + jlen:28 + jlen + blen]
    drop = {im['bufferView'] for im in doc.get('images', []) if 'bufferView' in im}
    remap, views, chunks, offset = {}, [], [], 0
    for i, view in enumerate(doc['bufferViews']):
        if i in drop:
            continue
        piece = blob[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']]
        chunks.append(piece + b'\0' * (-len(piece) % 4))
        remap[i] = len(views)
        views.append({**view, 'byteOffset': offset})
        offset += len(piece) + (-len(piece) % 4)
    for acc in doc.get('accessors', []):
        acc['bufferView'] = remap[acc['bufferView']]
    doc['bufferViews'] = views
    bin_out = b''.join(chunks)
    doc['buffers'] = [{'byteLength': len(bin_out)}]
    doc['images'] = [{'uri': ATLAS_URI, 'name': 'colormap'}]
    doc['samplers'] = [{'minFilter': 9987}]
    doc['textures'] = [{'sampler': 0, 'source': 0, 'name': 'colormap'}]
    doc['materials'] = [{'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0.0},
                         'doubleSided': True, 'name': 'colormap'}]
    for key in ('extensionsUsed', 'extensionsRequired'):
        doc.pop(key, None)
    doc['nodes'] = [{'mesh': 0, 'name': name}]
    doc['scenes'] = [{'nodes': [0], 'name': name}]
    doc['scene'] = 0
    doc['meshes'][0]['name'] = name
    js = json.dumps(doc, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(bin_out))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bin_out), 0x004E4942) + bin_out
    with open(path, 'wb') as fh:
        fh.write(out)


def export(obj, path):
    location = obj.location.copy()
    obj.location = (0, 0, 0)
    for o in bpy.context.view_layer.objects:
        o.select_set(o == obj)
    bpy.context.view_layer.objects.active = obj
    try:
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                                  export_apply=True, export_animations=False, export_cameras=False,
                                  export_lights=False, export_materials='EXPORT')
    finally:
        obj.location = location
    kenney_style(path, obj.name)


def build_all(export_glb=False, collection='Parking', y=3.0):
    mat = atlas_material()
    coll = bpy.data.collections.get(collection) or bpy.data.collections.new(collection)
    if coll.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(coll)
    report, x = {}, 0.0
    for name, spec in VARIANTS.items():
        old = bpy.data.objects.get(name)
        if old:
            old_mesh = old.data
            bpy.data.objects.remove(old, do_unlink=True)
            if old_mesh.users == 0:
                bpy.data.meshes.remove(old_mesh)
        me, W, D = build_mesh(name, spec, mat)
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        ob.location = (x + W / 2, y + D / 2, 0)
        x += W + 0.75
        report[name] = {'size': [W, D], 'cells': [W / 0.5, D / 0.5],
                        'tris': sum(len(p.vertices) - 2 for p in me.polygons),
                        'stalls': sum(spec['groups']) * (1 if spec['kind'] == 'bays' else 2)}
        if export_glb:
            os.makedirs(OUT_DIR, exist_ok=True)
            path = os.path.join(OUT_DIR, f'{name}.glb')
            export(ob, path)
            report[name]['bytes'] = os.path.getsize(path)
    return report


# --- Road joints ---------------------------------------------------------------------------------
# A road block that joins a car park's entrance draws its Kenney piece with no centre line on the
# sides facing a lot: the same geometry, with those centre-line faces cut at the junction and
# recoloured to asphalt. One model per (piece, set of lot sides), the sides in the game's canonical
# frame (src/town/roadTiles.ts: N=1 E=2 S=4 W=8, after the piece's rotationOffset); sets that a
# symmetric piece turns into each other share the one with the smallest mask (roadJointFor).

N, E, S, W = 1, 2, 4, 8

# piece: (Kenney roads file, rotationOffset, canonical connections, quarter turns that keep its shape)
JOINT_BASES = {
    'straight': ('road-straight', 1, N | S, (0, 2)),
    'corner': ('road-bend-square', 1, E | S, (0,)),
    'tee': ('road-intersection-line', 0, E | S | W, (0,)),
    'cross': ('road-crossroad-line', 0, N | E | S | W, (0, 1, 2, 3)),
    'end': ('road-end-round', 3, S, (0,)),
    'zebra-straight': ('road-crossing', 1, N | S, (0, 2)),
}

# Native side -> outward direction in Blender (glTF -Z, north, imports as Blender +Y).
SIDE_AXIS = {0: (0, 1), 1: (1, 0), 2: (0, -1), 3: (-1, 0)}
LINE_HALF = 0.0105  # the kit's centre line is 0.02 wide


def rotate_mask(mask, turns):
    """Quarter turns counter-clockwise from above: E->N, N->W, W->S, S->E (roadTiles.rotateMask)."""
    for _ in range(turns % 4):
        mask = sum(1 << ((i + 3) % 4) for i in range(4) if mask & (1 << i))
    return mask


def joint_sides(piece):
    _, _, connections, symmetry = JOINT_BASES[piece]
    return sorted({min(rotate_mask(sides, s) for s in symmetry)
                   for sides in range(1, 16) if not sides & ~connections})


def joint_name(piece, sides):
    return f"road-joint-{piece}-{''.join(c for i, c in enumerate('nesw') if sides & (1 << i))}"


def build_joint_mesh(piece, sides, material):
    file, rotation_offset, connections, _ = JOINT_BASES[piece]
    native = rotate_mask(sides, (4 - rotation_offset) % 4)
    before = {kind: set(getattr(bpy.data, kind)) for kind in ('objects', 'materials', 'images')}
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'public/assets/models/roads', f'{file}.glb'))
    imported = [o for o in bpy.data.objects if o not in before['objects']]
    source = next(o for o in imported if o.type == 'MESH')
    bm = bmesh.new()
    bm.from_mesh(source.data)
    for o in imported:
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if data is not None and data.users == 0:
            bpy.data.meshes.remove(data)
    for kind in ('materials', 'images'):
        block = getattr(bpy.data, kind)
        for d in [d for d in block if d not in before[kind] and d.users == 0]:
            block.remove(d)
    uv = bm.loops.layers.uv.active

    def paint(f):
        return f.normal.z > 0.9 and all(abs(l[uv].uv[0] - UV['paint'][0]) < 1e-3 and abs(l[uv].uv[1] - UV['paint'][1]) < 1e-3
                                        for l in f.loops)

    def on_line(f, ax, ay):
        return paint(f) and all(abs(v.co.x * ay - v.co.y * ax) <= LINE_HALF for v in f.verts)

    def asphalt(f):
        for loop in f.loops:
            loop[uv].uv = UV['asphalt']

    for i, (ax, ay) in SIDE_AXIS.items():
        if not native & (1 << i):
            continue
        faces = [f for f in bm.faces if on_line(f, ax, ay)]
        geom = list({*faces, *(e for f in faces for e in f.edges), *(v for f in faces for v in f.verts)})
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(ax * 0.01, ay * 0.01, 0), plane_no=(ax, ay, 0), dist=1e-5)
        for f in bm.faces:
            c = f.calc_center_median()
            if on_line(f, ax, ay) and c.x * ax + c.y * ay > LINE_HALF:
                asphalt(f)
    if not connections & ~sides:
        # every arm faces a lot: no lone dot of paint left in the middle
        for f in bm.faces:
            if paint(f) and all(abs(v.co.x) <= LINE_HALF and abs(v.co.y) <= LINE_HALF for v in f.verts):
                asphalt(f)
    me = bpy.data.meshes.new(joint_name(piece, sides))
    bm.to_mesh(me)
    bm.free()
    for name in [a.name for a in me.attributes if 'normal' in a.name]:
        me.attributes.remove(me.attributes[name])
    for poly in me.polygons:
        poly.use_smooth = False
    me.materials.clear()
    me.materials.append(material)
    return me


def build_joints(export_glb=False, collection='Parking joints', y=8.0):
    mat = atlas_material()
    coll = bpy.data.collections.get(collection) or bpy.data.collections.new(collection)
    if coll.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(coll)
    report, x = {}, 0.0
    for piece in JOINT_BASES:
        for sides in joint_sides(piece):
            name = joint_name(piece, sides)
            old = bpy.data.objects.get(name)
            if old:
                old_mesh = old.data
                bpy.data.objects.remove(old, do_unlink=True)
                if old_mesh.users == 0:
                    bpy.data.meshes.remove(old_mesh)
            me = build_joint_mesh(piece, sides, mat)
            ob = bpy.data.objects.new(name, me)
            coll.objects.link(ob)
            ob.location = (x, y, 0)
            x += 1.25
            report[name] = {'tris': sum(len(p.vertices) - 2 for p in me.polygons)}
            if export_glb:
                os.makedirs(OUT_DIR, exist_ok=True)
                path = os.path.join(OUT_DIR, f'{name}.glb')
                export(ob, path)
                report[name]['bytes'] = os.path.getsize(path)
    return report


if __name__ == '__main__' and bpy.app.background:
    for model, info in {**build_all(export_glb=True), **build_joints(export_glb=True)}.items():
        print(model, info)
