# Builds the stadium (public/assets/models/stadium/stadium.glb) on the Kenney City Kit (Roads) atlas.
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-stadium.py
#
# In an open Blender session, exec() this file and call build_stadium(): it adds the model to a
# "Stadium" collection for review; build_stadium(export_glb=True) also writes the GLB.
#
# Units are game world units (a cell = 0.5): 5 x 4, a 10 x 8 cell lot. Blender is Z-up and its -Y
# becomes glTF +Z, so the gate (Blender -Y) faces +Z at rotation 0 and the roofed main stand is at the
# back. Every face samples one colormap.png texel; the GLB references ../roads/Textures/colormap.png.
# The lamp panels, pitch, track and pitch paint keep texels nothing else on the model uses: the game's
# 'floodlight' night mask (src/render/nightGlow.ts) lights exactly those atlas cells.
import math
import os
import runpy

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
kit = runpy.run_path(os.path.join(HERE, 'build-parking.py'), run_name='kit')
OUT_DIR = os.path.join(kit['ROOT'], 'public/assets/models/stadium')

UV = {
    'concrete': (0.4062, 0.375),      # a0a8c9
    'concrete_lt': (0.4688, 0.475),   # bec7ee
    'concrete_md': (0.4688, 0.425),   # aeb6da
    'concrete_dk': (0.1562, 0.375),   # 868ba1
    'dark': (0.2812, 0.375),          # 4f5260
    'darkest': (0.0312, 0.375),       # 38383d
    'white': (0.5312, 0.375),         # ffffff
    'line': (0.5938, 0.440),          # efeff5: pitch paint and goals only, so the night mask can light them
    'seat': (0.5312, 0.625),          # cf534f
    'lamp': (0.0312, 0.625),          # fde4c7
    'track': (0.6562, 0.375),         # f1976c
    'pitch_a': (0.9062, 0.125),       # 61cb8b
    'pitch_b': (0.9688, 0.200),       # 53bd84
}

LOT = (5.0, 4.0)
PLINTH_Z = 0.02          # the road kerb height
FLOOR_Z = 0.03
# The bowl: octagons as (half x, half y, corner cut).
BOWL_IN = (1.50, 1.00, 0.26)
BOWL_OUT = (2.30, 1.80, 0.70)
WALL_OUT = (2.36, 1.86, 0.72)
TIERS = 6
TIER_Z0, TIER_STEP = 0.09, 0.14
RIM_Z = 0.90
BASE_Z, BAND_Z = 0.14, 0.78  # the outer wall's dark base ends, its seat-red band starts
ROOF_Z = 1.2
PITCH = (1.2, 0.75)      # half size
LINE_W = 0.025
STRIPE_W = 0.2
BOX_D, BOX_HALF = 0.30, 0.36
CIRCLE_R = 0.19          # apothem of the 12-gon centre circle
MAST_H = 2.0             # under the church (2.33)


def octagon(hx, hy, c):
    """Counter-clockwise from above; even segments are the straights (0 +x, 2 +y back, 4 -x, 6 -y front)."""
    return [(hx, -hy + c), (hx, hy - c), (hx - c, hy), (-hx + c, hy),
            (-hx, hy - c), (-hx, -hy + c), (-hx + c, -hy), (hx - c, -hy)]


def lerp_ring(a, b, t):
    return [(ax + (bx - ax) * t, ay + (by - ay) * t) for (ax, ay), (bx, by) in zip(a, b)]


CIRCLE_NORMALS = [(math.cos(math.radians(30 * i)), math.sin(math.radians(30 * i))) for i in range(12)]


def pitch_texel(x, y):
    """The colour of the arena floor at (x, y): track, a line, or a mowing stripe."""
    px, py = PITCH
    ax, ay = abs(x), abs(y)
    if ax > px or ay > py:
        return 'track'
    if ax > px - LINE_W or ay > py - LINE_W or ax < LINE_W / 2:
        return 'line'
    ring = max(x * nx + y * ny for nx, ny in CIRCLE_NORMALS)
    if CIRCLE_R - LINE_W < ring <= CIRCLE_R:
        return 'line'
    if ax >= px - BOX_D and ay <= BOX_HALF and (ax < px - BOX_D + LINE_W or ay > BOX_HALF - LINE_W):
        return 'line'
    return 'pitch_a' if int((x + px) / STRIPE_W) % 2 == 0 else 'pitch_b'


def pitch_cuts():
    """Every plane a floor colour changes across, as (point, normal)."""
    px, py = PITCH
    xs = [-px + STRIPE_W * k for k in range(int(round(2 * px / STRIPE_W)) + 1)]
    xs += [s * v for s in (-1, 1) for v in (px - LINE_W, LINE_W / 2, px - BOX_D, px - BOX_D + LINE_W)]
    ys = [s * v for s in (-1, 1) for v in (py, py - LINE_W, BOX_HALF, BOX_HALF - LINE_W)]
    cuts = [((x, 0, 0), (1, 0, 0)) for x in xs] + [((0, y, 0), (0, 1, 0)) for y in ys]
    for nx, ny in CIRCLE_NORMALS:
        for r in (CIRCLE_R, CIRCLE_R - LINE_W):
            cuts.append(((nx * r, ny * r, 0), (nx, ny, 0)))
    return cuts


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
        verts = [self.v(c) for c in cos]
        if len(set(verts)) < 3:
            return
        f = self.bm.faces.new(verts)
        for loop in f.loops:
            loop[self.uv].uv = UV[uv]

    def hexa(self, o, ax, ay, az, uv, faces=None, skip=()):
        """A box from a corner and three right-handed edge vectors; `faces` overrides texels per side."""
        o, ax, ay, az = Vector(o), Vector(ax), Vector(ay), Vector(az)
        p = lambda i, j, k: tuple(o + ax * i + ay * j + az * k)
        sides = {
            '-z': [p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)],
            '+z': [p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)],
            '-y': [p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)],
            '+y': [p(0, 1, 0), p(0, 1, 1), p(1, 1, 1), p(1, 1, 0)],
            '-x': [p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)],
            '+x': [p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)],
        }
        for name, pts in sides.items():
            if name not in skip:
                self.face(pts, (faces or {}).get(name, uv))

    def box(self, x0, y0, z0, x1, y1, z1, uv, faces=None, skip=('-z',)):
        self.hexa((x0, y0, z0), (x1 - x0, 0, 0), (0, y1 - y0, 0), (0, 0, z1 - z0), uv, faces, skip)

    def floor(self):
        """The arena floor inside the bowl, cut wherever its colour changes."""
        tmp = bmesh.new()
        tmp.faces.new([tmp.verts.new((x, y, FLOOR_Z)) for x, y in octagon(*BOWL_IN)])
        for co, no in pitch_cuts():
            bmesh.ops.bisect_plane(tmp, geom=tmp.verts[:] + tmp.edges[:] + tmp.faces[:], dist=1e-6,
                                   plane_co=co, plane_no=no)
        for f in tmp.faces:
            c = f.calc_center_median()
            self.face([tuple(v.co) for v in f.verts], pitch_texel(c.x, c.y))
        tmp.free()

    def bowl(self):
        inner, outer, wall = octagon(*BOWL_IN), octagon(*BOWL_OUT), octagon(*WALL_OUT)
        rings = [lerp_ring(inner, outer, k / TIERS) for k in range(TIERS + 1)]
        for i in range(8):
            j = (i + 1) % 8
            tread = 'seat' if i % 2 == 0 else 'white'
            for k in range(TIERS + 1):
                lo = FLOOR_Z if k == 0 else TIER_Z0 + TIER_STEP * (k - 1)
                hi = RIM_Z if k == TIERS else TIER_Z0 + TIER_STEP * k
                a, b = rings[k][i], rings[k][j]
                self.face([(*b, lo), (*a, lo), (*a, hi), (*b, hi)], 'concrete_lt')
                if k < TIERS:
                    c, d = rings[k + 1][i], rings[k + 1][j]
                    self.face([(*a, hi), (*c, hi), (*d, hi), (*b, hi)], tread)
            a, b, c, d = outer[i], outer[j], wall[i], wall[j]
            self.face([(*a, RIM_Z), (*c, RIM_Z), (*d, RIM_Z), (*b, RIM_Z)], 'concrete_lt')
            for lo, hi, uv in ((PLINTH_Z, BASE_Z, 'concrete_dk'), (BASE_Z, BAND_Z, 'concrete'), (BAND_Z, RIM_Z, 'seat')):
                self.face([(*c, lo), (*d, lo), (*d, hi), (*c, hi)], uv)

    def main_stand(self):
        """The back straight: a wall above the rim and a roof cantilevered over the seats."""
        hx = WALL_OUT[0] - WALL_OUT[2]
        y1 = WALL_OUT[1]
        self.box(-hx, y1 - 0.06, RIM_Z, hx, y1, ROOF_Z, 'concrete', faces={'+z': 'concrete_lt'})
        depth, rise, thick = 0.86, 0.16, 0.04
        self.hexa((-hx - 0.04, y1 + 0.03 - depth, ROOF_Z + rise), (2 * hx + 0.08, 0, 0), (0, depth, -rise), (0, 0, thick), 'concrete_md',
                  faces={'+z': 'white', '-z': 'concrete_dk'}, skip=())

    def gate(self):
        """The front straight: two pylons, a white lintel and a dark doorway."""
        y1 = -WALL_OUT[1]
        y0 = y1 - 0.10
        for x0, x1 in ((-0.38, -0.20), (0.20, 0.38)):
            self.box(x0, y0, PLINTH_Z, x1, y1, 0.38, 'concrete_md', faces={'+z': 'concrete_lt'}, skip=('-z', '+y'))
        self.box(-0.44, y0 - 0.02, 0.38, 0.44, y1, 0.52, 'white', faces={'+z': 'concrete_lt'}, skip=('+y',))
        self.box(-0.20, y1 - 0.03, PLINTH_Z, 0.20, y1, 0.38, 'darkest', skip=('-z', '+y', '+z'))

    def goals(self):
        t, half, h, d = 0.014, 0.10, 0.08, 0.06
        for s in (-1, 1):
            x0 = s * PITCH[0]
            xa, xb = sorted((x0, x0 + s * d))
            for y in (-half, half - t):
                self.box(xa, y, FLOOR_Z, xb, y + t, FLOOR_Z + h, 'line')
            self.box(xa, -half, FLOOR_Z + h, xb, half, FLOOR_Z + h + t, 'line', skip=())

    def floodlights(self):
        """A mast in each lot corner, its lamp panel tilted down at the pitch."""
        p, tilt = 0.02, math.radians(28)
        for sx in (-1, 1):
            for sy in (-1, 1):
                x, y = sx * (LOT[0] / 2 - 0.26), sy * (LOT[1] / 2 - 0.26)
                self.box(x - p, y - p, PLINTH_Z, x + p, y + p, MAST_H, 'dark')
                f = Vector((-x, -y, 0)).normalized()
                r = Vector((f.y, -f.x, 0))
                up = Vector((0, 0, 1))
                fwd = f * math.cos(tilt) - up * math.sin(tilt)
                top = f * math.sin(tilt) + up * math.cos(tilt)
                w, h, d = 0.34, 0.2, 0.05
                o = Vector((x, y, MAST_H)) - r * (w / 2) - top * (h / 2) - fwd * (d / 2)
                self.hexa(o, r * w, fwd * d, top * h, 'dark', faces={'+y': 'lamp'}, skip=())

    def mesh(self, name, material):
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.5), verts=list(bm.verts), edges=list(bm.edges),
                                 delimit={'UV'})
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for poly in me.polygons:
            poly.use_smooth = False
        me.materials.append(material)
        return me


def build_mesh(name, material):
    b = Builder()
    hx, hy = LOT[0] / 2 - 0.05, LOT[1] / 2 - 0.05
    b.box(-hx, -hy, 0, hx, hy, PLINTH_Z, 'concrete_md', faces={'+z': 'concrete_lt', '-z': 'concrete_dk'}, skip=())
    b.floor()
    b.bowl()
    b.main_stand()
    b.gate()
    b.goals()
    b.floodlights()
    return b.mesh(name, material)


def build_stadium(export_glb=False, collection='Stadium', location=(0.0, -9.0, 0.0)):
    name = 'stadium'
    coll = bpy.data.collections.get(collection) or bpy.data.collections.new(collection)
    if coll.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(coll)
    old = bpy.data.objects.get(name)
    if old:
        old_mesh = old.data
        bpy.data.objects.remove(old, do_unlink=True)
        if old_mesh.users == 0:
            bpy.data.meshes.remove(old_mesh)
    me = build_mesh(name, kit['atlas_material']())
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    ob.location = location
    report = {'tris': sum(len(p.vertices) - 2 for p in me.polygons), 'size': [round(v, 3) for v in ob.dimensions]}
    if export_glb:
        os.makedirs(OUT_DIR, exist_ok=True)
        path = os.path.join(OUT_DIR, f'{name}.glb')
        kit['export'](ob, path)
        report['bytes'] = os.path.getsize(path)
    return report


if __name__ == '__main__' and bpy.app.background:
    print('stadium', build_stadium(export_glb=True))
