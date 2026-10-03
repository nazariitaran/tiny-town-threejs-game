# Builds the stadium (public/assets/models/stadium/stadium.glb) on the Kenney City Kit (Roads) atlas.
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-stadium.py
#
# In an open Blender session, exec() this file and call build_stadium(): it adds the model to a
# "Stadium" collection for review; build_stadium(export_glb=True) also writes the GLB.
#
# Units are game world units (a cell = 0.5): 7 x 5.5, a 14 x 11 cell lot. Blender is Z-up and its -Y
# becomes glTF +Z, so the gate (Blender -Y) faces +Z at rotation 0 and the roofed main stand is at the
# back. Every face samples one colormap.png texel; the GLB references ../roads/Textures/colormap.png.
# The lamps, pitch, track, pitch paint and scoreboard digits keep texels nothing else on the model uses:
# the game's 'floodlight' night mask (src/render/nightGlow.ts) lights exactly those atlas cells.
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
    'yellow': (0.2812, 0.625),        # ffc044: flags
    'score': (0.3438, 0.680),         # ffc356: the scoreboard digits only (lit at night)
    'lamp': (0.0312, 0.625),          # fde4c7: the floodlight lamps only
    'track': (0.6562, 0.375),         # f1976c
    'pitch_a': (0.9062, 0.125),       # 61cb8b
    'pitch_b': (0.9688, 0.200),       # 53bd84
}

LOT = (7.0, 5.5)
PLINTH_Z, FLOOR_Z = 0.02, 0.03
BOWL_IN = (2.03, 1.28, 0.30)
RUN = 1.20                   # stand depth, inner wall to the back row
BOWL_OUT = (BOWL_IN[0] + RUN, BOWL_IN[1] + RUN, 1.00)
WALL_OUT = (BOWL_OUT[0] + 0.10, BOWL_OUT[1] + 0.10, 1.04)
# Rows from the pitch outwards: (run, tread height, texel). A concourse splits the two tiers.
PROFILE = [(0.11, 0.10, 'seat'), (0.11, 0.22, 'seat'), (0.11, 0.34, 'seat'), (0.11, 0.46, 'seat'),
           (0.20, 0.58, 'concrete_lt'),
           (0.14, 0.76, 'seat'), (0.14, 0.94, 'seat'), (0.14, 1.12, 'seat'), (0.14, 1.30, 'seat')]
RIM_Z = 1.42
WALL_BANDS = [(PLINTH_Z, 0.16, 'concrete_dk'), (0.16, 0.50, 'concrete'), (0.50, 0.64, 'dark'),
              (0.64, 1.24, 'concrete'), (1.24, RIM_Z, 'seat')]
ROOF_Z = 1.85
PITCH = (1.7, 1.05)
LINE_W = 0.03
STRIPE_W = 0.2
BOX_D, BOX_HALF = 0.42, 0.52
SIX_D, SIX_HALF = 0.16, 0.24
CIRCLE_R = 0.25
MAST_H = 2.7
BLOCKS = {0: 3, 2: 5, 4: 3, 6: 5}   # seat blocks per straight
AISLE = 0.014                        # half an aisle, as a fraction of the straight
STEP_D = 0.10
BOWL_SHIFT = 0.06                    # the bowl sits this far back on its lot, so the gate and its step stay inside


def octagon(hx, hy, c):
    """Counter-clockwise from above; even segments are the straights (0 +x, 2 +y back, 4 -x, 6 -y front)."""
    return [(hx, -hy + c), (hx, hy - c), (hx - c, hy), (-hx + c, hy),
            (-hx, hy - c), (-hx, -hy + c), (-hx + c, -hy), (hx - c, -hy)]


def lerp2(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


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
    for d, half in ((BOX_D, BOX_HALF), (SIX_D, SIX_HALF)):
        if ax >= px - d and ay <= half and (ax < px - d + LINE_W or ay > half - LINE_W):
            return 'line'
    return 'pitch_a' if int((x + px) / STRIPE_W) % 2 == 0 else 'pitch_b'


def pitch_cuts():
    """Every plane a floor colour changes across, as (point, normal)."""
    px, py = PITCH
    xs = [-px + STRIPE_W * k for k in range(int(round(2 * px / STRIPE_W)) + 1)]
    xv = [px - LINE_W, LINE_W / 2, px - BOX_D, px - BOX_D + LINE_W, px - SIX_D, px - SIX_D + LINE_W]
    yv = [py, py - LINE_W, BOX_HALF, BOX_HALF - LINE_W, SIX_HALF, SIX_HALF - LINE_W]
    xs += [s * v for s in (-1, 1) for v in xv]
    ys = [s * v for s in (-1, 1) for v in yv]
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
        try:
            f = self.bm.faces.new(verts)
        except ValueError:
            return
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

    def shift(self, dy):
        """Moves everything built so far along y."""
        bmesh.ops.translate(self.bm, vec=(0, dy, 0), verts=self.bm.verts)
        self.verts = {}

    def bowl(self):
        inner, outer, wall = octagon(*BOWL_IN), octagon(*BOWL_OUT), octagon(*WALL_OUT)
        cum, rings = 0.0, [inner]
        for run, _, _ in PROFILE:
            cum += run
            rings.append([lerp2(a, b, cum / RUN) for a, b in zip(inner, outer)])
        for i in range(8):
            j = (i + 1) % 8
            n = BLOCKS.get(i)
            # block and aisle spans along a straight; a corner is one white span
            if n:
                edges = [0.0]
                for k in range(1, n):
                    edges += [k / n - AISLE, k / n + AISLE]
                edges.append(1.0)
                spans = [(edges[m], edges[m + 1], m % 2 == 1) for m in range(len(edges) - 1)]
            else:
                spans = [(0.0, 1.0, False)]
            prev_z = FLOOR_Z
            for k, (run, z, texel) in enumerate(PROFILE):
                a, b = rings[k][i], rings[k][j]
                c, d = rings[k + 1][i], rings[k + 1][j]
                self.face([(*b, prev_z), (*a, prev_z), (*a, z), (*b, z)], 'concrete_lt')
                for t0, t1, aisle in spans:
                    uv = texel if texel != 'seat' else ('concrete_lt' if aisle else ('seat' if n else 'white'))
                    p0, p1 = lerp2(a, b, t0), lerp2(a, b, t1)
                    q0, q1 = lerp2(c, d, t0), lerp2(c, d, t1)
                    self.face([(*p0, z), (*q0, z), (*q1, z), (*p1, z)], uv)
                prev_z = z
            a, b = outer[i], outer[j]
            c, d = wall[i], wall[j]
            self.face([(*b, prev_z), (*a, prev_z), (*a, RIM_Z), (*b, RIM_Z)], 'concrete_lt')
            self.face([(*a, RIM_Z), (*c, RIM_Z), (*d, RIM_Z), (*b, RIM_Z)], 'concrete_lt')
            for lo, hi, uv in WALL_BANDS:
                self.face([(*c, lo), (*d, lo), (*d, hi), (*c, hi)], uv)

    def main_stand(self):
        """The back straight: a wall above the rim and a ribbed roof cantilevered over the seats."""
        hx = WALL_OUT[0] - WALL_OUT[2]
        y1 = WALL_OUT[1]
        self.box(-hx, y1 - 0.08, RIM_Z, hx, y1, ROOF_Z, 'concrete', faces={'+z': 'concrete_lt'})
        depth, rise, thick = 1.25, 0.22, 0.05
        self.hexa((-hx - 0.06, y1 + 0.04 - depth, ROOF_Z + rise), (2 * hx + 0.12, 0, 0), (0, depth, -rise),
                  (0, 0, thick), 'concrete_md', faces={'+z': 'white', '-z': 'concrete_dk', '-y': 'seat'})
        # roof ribs on top, from the back wall to the fascia
        ribs = 7
        for k in range(ribs):
            x = -hx + 0.1 + (2 * hx - 0.2) * k / (ribs - 1)
            self.hexa((x - 0.02, y1 + 0.04 - depth, ROOF_Z + rise + thick), (0.04, 0, 0), (0, depth, -rise),
                      (0, 0, 0.03), 'concrete_md', skip=('-z',))

    def gate(self):
        """The front straight: three pylons, two dark doorways, a white lintel with a seat-red sign."""
        y1 = -WALL_OUT[1]
        y0 = y1 - 0.12
        for x0, x1 in ((-0.62, -0.42), (-0.10, 0.10), (0.42, 0.62)):
            self.box(x0, y0, PLINTH_Z, x1, y1, 0.50, 'concrete_md', faces={'+z': 'concrete_lt'}, skip=('-z', '+y'))
        self.box(-0.70, y0 - 0.03, 0.50, 0.70, y1, 0.72, 'white', faces={'+z': 'concrete_lt'}, skip=('+y',))
        self.box(-0.46, y0 - 0.045, 0.555, 0.46, y0 - 0.03, 0.665, 'seat', skip=('+y',))
        for x0, x1 in ((-0.42, -0.10), (0.10, 0.42)):
            self.box(x0, y1 - 0.04, PLINTH_Z, x1, y1, 0.50, 'darkest', skip=('-z', '+y', '+z'))
        # a step up to the doors
        self.box(-0.70, y0 - STEP_D, PLINTH_Z, 0.70, y0, PLINTH_Z + 0.025, 'concrete_lt', faces={'-y': 'concrete_md'}, skip=('-z', '+y'))

    def goals(self):
        t, half, h, d = 0.016, 0.13, 0.10, 0.08
        for s in (-1, 1):
            x0 = s * PITCH[0]
            xa, xb = sorted((x0, x0 + s * d))
            for y in (-half, half - t):
                self.box(xa, y, FLOOR_Z, xb, y + t, FLOOR_Z + h, 'line')
            self.box(xa, -half, FLOOR_Z + h, xb, half, FLOOR_Z + h + t, 'line', skip=())

    def dugouts(self):
        y0 = PITCH[1] + 0.07
        for cx in (-0.55, 0.55):
            self.box(cx - 0.22, y0, FLOOR_Z, cx + 0.22, y0 + 0.11, FLOOR_Z + 0.09, 'white',
                     faces={'-y': 'darkest', '+z': 'white'})

    def scoreboard(self):
        """On the +x end, facing the pitch."""
        x = BOWL_OUT[0] + 0.02
        for y in (-0.36, 0.36):
            self.box(x, y - 0.02, RIM_Z, x + 0.04, y + 0.02, RIM_Z + 0.2, 'dark')
        self.box(x - 0.02, -0.52, RIM_Z + 0.2, x + 0.06, 0.52, RIM_Z + 0.62, 'darkest', faces={'+z': 'dark'}, skip=())
        z0 = RIM_Z + 0.31
        for y0, y1, uv in ((-0.42, -0.14, 'score'), (-0.05, 0.05, 'white'), (0.14, 0.42, 'score')):
            hgt = 0.2 if uv == 'score' else 0.05
            zc = z0 + 0.1
            self.box(x - 0.03, y0, zc - hgt / 2, x - 0.02, y1, zc + hgt / 2, uv, skip=('+x',))

    def flags(self):
        """Along the front rim."""
        y = -(BOWL_OUT[1] + 0.05)
        hx = WALL_OUT[0] - WALL_OUT[2]
        colours = ['seat', 'yellow', 'white', 'yellow', 'seat']
        for k, uv in enumerate(colours):
            x = -hx + 0.3 + (2 * hx - 0.6) * k / (len(colours) - 1)
            self.box(x - 0.008, y - 0.008, RIM_Z, x + 0.008, y + 0.008, RIM_Z + 0.42, 'dark')
            self.box(x + 0.008, y - 0.004, RIM_Z + 0.30, x + 0.17, y + 0.004, RIM_Z + 0.41, uv, skip=())

    def floodlights(self):
        """A mast on a footing in each lot corner, its lamp frame tilted down at the pitch."""
        p, tilt = 0.028, math.radians(28)
        for sx in (-1, 1):
            for sy in (-1, 1):
                x, y = sx * (LOT[0] / 2 - 0.32), sy * (LOT[1] / 2 - 0.32)
                self.box(x - p * 1.6, y - p * 1.6, PLINTH_Z, x + p * 1.6, y + p * 1.6, PLINTH_Z + 0.12, 'concrete_dk',
                         faces={'+z': 'concrete_md'})
                self.box(x - p, y - p, PLINTH_Z + 0.12, x + p, y + p, MAST_H, 'dark')
                f = Vector((-x, -y, 0)).normalized()
                r = Vector((f.y, -f.x, 0))
                up = Vector((0, 0, 1))
                fwd = f * math.cos(tilt) - up * math.sin(tilt)
                top = f * math.sin(tilt) + up * math.cos(tilt)
                w, h, d = 0.5, 0.3, 0.06
                c = Vector((x, y, MAST_H))
                self.hexa(c - r * (w / 2) - top * (h / 2) - fwd * (d / 2), r * w, fwd * d, top * h, 'dark', skip=())
                # two rows of lamps standing proud of the frame
                for row in (-1, 1):
                    lw, lh = w - 0.08, h / 2 - 0.05
                    o = c - r * (lw / 2) + top * (row * (h / 4) - lh / 2) + fwd * (d / 2)
                    self.hexa(o, r * lw, fwd * 0.012, top * lh, 'lamp', skip=('-y',))

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
    b.floor()
    b.bowl()
    b.main_stand()
    b.gate()
    b.goals()
    b.dugouts()
    b.scoreboard()
    b.flags()
    b.shift(BOWL_SHIFT)
    hx, hy = LOT[0] / 2 - 0.05, LOT[1] / 2 - 0.05
    b.box(-hx, -hy, 0, hx, hy, PLINTH_Z, 'concrete_md', faces={'+z': 'concrete_lt', '-z': 'concrete_dk'}, skip=())
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
