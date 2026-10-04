# Builds the cinema (public/assets/models/cinema/cinema.glb) on the Kenney City Kit (Roads) atlas.
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-cinema.py
#
# In an open Blender session, exec() this file (with __file__ set) and call build_cinema(): it adds the
# model to a "Cinema" collection for review; build_cinema(export_glb=True) also writes the GLB.
#
# Units are game world units (a cell = 0.5): a 6 x 4 cell lot (3 x 2 units). Blender is Z-up and its -Y
# becomes glTF +Z, so the facade (Blender -Y) faces +Z at rotation 0. The building is one mesh on the
# atlas (`cinema`); the four poster slots are separate one-quad meshes (`poster-1` .. `poster-4`, left to
# right) with their own flat placeholder materials and UVs filling 0..1, so the owner can assign poster
# textures to them later.
import json
import math
import os
import struct

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
OUT_DIR = os.path.join(ROOT, 'public/assets/models/cinema')
ATLAS = os.path.join(ROOT, 'public/assets/models/roads/Textures/colormap.png')
ATLAS_URI = '../roads/Textures/colormap.png'

# colormap.png texels (Blender UV, v up); every colour is one of the City Kit's own swatches. The gradient
# cells are sampled at one v. Glazing samples the cell the houses' windows use (column 11, row 1 from the
# top: the game's `windows` night mask), so no wall may sample that cell.
UV = {
    'white': (0.5312, 0.375),         # ffffff
    'concrete': (0.4062, 0.375),      # a0a8c9
    'concrete_lt': (0.4688, 0.475),   # bec7ee
    'concrete_dk': (0.1562, 0.375),   # 868ba1
    'slate': (0.2812, 0.375),         # 4f5260: base course, sign board, reveals
    'wall': (0.9688, 0.540),          # 6644be: facade walls (violet)
    'trim': (0.7812, 0.625),          # d0e8ff: frames, cornice, sign rim
    'glass': (0.7188, 0.594),         # window glass, as on the supermarket (building-e): doors and ticket windows
    'bulb': (0.2812, 0.625),          # ffc044: marquee lamps
    'orange': (0.4688, 0.625),        # ff8744: the posters' title orange
}

LOT = (3.0, 2.0)                      # 6 x 4 cells
HX = LOT[0] / 2 - 0.05                # building half width: 1.45
Y_BACK = LOT[1] / 2 - 0.05            # 0.95
Y_FORE = -Y_BACK                      # front edge of the forecourt, -0.95
FRONT_Y = -0.80                       # the facade plane
LOBBY_BACK = 0.20                     # the lobby (low front block) ends here, the auditoria start
FORE_Z = 0.02                         # forecourt height: the road's kerb top
BASE_H = 0.12                         # slate base course
WALL_TOP = 1.54                       # top of the facade wall, under the cornice
CORNICE_H = 0.08
ROOF_Z = WALL_TOP + CORNICE_H         # 1.62: the lobby roof
CORNICE_OUT = 0.03
AUD_Z = 1.80                          # auditorium roof
AUD2_Z = 1.98                         # raised central auditorium roof
AUD2_X, AUD2_Y0 = 0.90, 0.40

# Poster slots: 3:4 portrait, left to right
POSTER_W, POSTER_H = 0.48, 0.64
POSTER_PITCH = 0.72
POSTER_CX = [-1.5 * POSTER_PITCH, -0.5 * POSTER_PITCH, 0.5 * POSTER_PITCH, 1.5 * POSTER_PITCH]
POSTER_Z0 = 0.80
POCKET = 0.03                         # the poster plane sits this far behind the facade
BEZEL = 0.05
POSTER_COLORS = [(0.055, 0.204, 0.396), (0.043, 0.118, 0.110), (0.0, 0.447, 0.553), (0.184, 0.176, 0.463)]

# Entrance and ticket windows
DOOR_HALF, DOOR_Z1, DOOR_DEPTH = 0.60, 0.58, 0.14
CANOPY_HALF, CANOPY_Z0, CANOPY_Z1, CANOPY_OUT = 0.80, 0.62, 0.69, 0.14
STRIPE = 0.16

# Roof sign
SIGN_PX = 0.045
SIGN_HALF = 0.90
SIGN_Z0, SIGN_Z1 = ROOF_Z, 2.08
SIGN_D = 0.06
RIM = 0.025

FONT = {
    'C': ['.XXX.', 'X...X', 'X....', 'X....', 'X....', 'X...X', '.XXX.'],
    'I': ['.XXX.', '..X..', '..X..', '..X..', '..X..', '..X..', '.XXX.'],
    'N': ['X...X', 'XX..X', 'XX..X', 'X.X.X', 'X..XX', 'X..XX', 'X...X'],
    'E': ['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'XXXXX'],
    'M': ['X...X', 'XX.XX', 'X.X.X', 'X.X.X', 'X...X', 'X...X', 'X...X'],
    'A': ['.XXX.', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
}
TITLE = 'CINEMA'


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

    def wall(self, p0, p1, bands):
        """A vertical wall from p0 to p1 (xy) with its outside on the right of p0 -> p1, in z bands."""
        for lo, hi, uv in bands:
            self.face([(*p0, lo), (*p1, lo), (*p1, hi), (*p0, hi)], uv)

    def facade(self, rects, bounds, y, base):
        """The front plane (normal -y) as a grid cut at every rect edge. rects: (x0, z0, x1, z1, depth, texel,
        reveal), later wins; a texel of None leaves a hole (a poster slot). A cell deeper than its neighbour gets
        side faces from the neighbour's plane back to its own, in its `reveal` colour."""
        x0, z0, x1, z1 = bounds
        xs = sorted({round(v, 5) for v in (x0, x1, *[r[0] for r in rects], *[r[2] for r in rects])})
        zs = sorted({round(v, 5) for v in (z0, z1, *[r[1] for r in rects], *[r[3] for r in rects])})
        cell = {}
        for i in range(len(xs) - 1):
            for j in range(len(zs) - 1):
                cx, cz = (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
                state = (0.0, base, base)
                for rx0, rz0, rx1, rz1, depth, texel, reveal in rects:
                    if rx0 <= cx <= rx1 and rz0 <= cz <= rz1:
                        state = (depth, texel, reveal)
                cell[i, j] = state
        for (i, j), (depth, texel, reveal) in cell.items():
            a, b, c, d = xs[i], xs[i + 1], zs[j], zs[j + 1]
            if texel is not None:
                self.face([(a, y + depth, c), (b, y + depth, c), (b, y + depth, d), (a, y + depth, d)], texel)
            for nb, kind in (((i + 1, j), 'x+'), ((i - 1, j), 'x-'), ((i, j + 1), 'z+'), ((i, j - 1), 'z-')):
                if nb not in cell or cell[nb][0] >= depth:
                    continue
                # the neighbour is nearer the street: this cell is the recess, the neighbour's side is exposed
                near = y + cell[nb][0]
                far = y + depth
                # a reveal is a colour, or (sides, floor) when the recess floor differs
                uv = reveal or base
                if isinstance(uv, tuple):
                    uv = uv[1] if kind == 'z-' else uv[0]
                if kind == 'x+':
                    self.face([(b, far, c), (b, near, c), (b, near, d), (b, far, d)], uv)
                elif kind == 'x-':
                    self.face([(a, near, c), (a, far, c), (a, far, d), (a, near, d)], uv)
                elif kind == 'z+':
                    self.face([(a, far, d), (b, far, d), (b, near, d), (a, near, d)], uv)
                else:
                    self.face([(a, near, c), (b, near, c), (b, far, c), (a, far, c)], uv)

    # ---- the building ---------------------------------------------------------------------------

    def shell(self):
        # underside of the whole footprint
        self.face([(-HX, Y_BACK, 0), (HX, Y_BACK, 0), (HX, FRONT_Y, 0), (-HX, FRONT_Y, 0)], 'concrete_dk')
        # forecourt slab with a carpet running to the doors
        fz = FORE_Z
        self.face([(-HX, Y_FORE, fz), (-DOOR_HALF, Y_FORE, fz), (-DOOR_HALF, FRONT_Y, fz), (-HX, FRONT_Y, fz)], 'concrete_lt')
        self.face([(DOOR_HALF, Y_FORE, fz), (HX, Y_FORE, fz), (HX, FRONT_Y, fz), (DOOR_HALF, FRONT_Y, fz)], 'concrete_lt')
        self.face([(-DOOR_HALF, Y_FORE, fz), (DOOR_HALF, Y_FORE, fz), (DOOR_HALF, FRONT_Y, fz), (-DOOR_HALF, FRONT_Y, fz)], 'orange')
        self.face([(-HX, Y_FORE, 0), (-HX, Y_FORE, fz), (HX, Y_FORE, fz), (HX, Y_FORE, 0)][::-1], 'concrete_dk')
        self.face([(-HX, Y_FORE, 0), (-HX, FRONT_Y, 0), (HX, FRONT_Y, 0), (HX, Y_FORE, 0)], 'concrete_dk')
        self.face([(-HX, FRONT_Y, 0), (-HX, Y_FORE, 0), (-HX, Y_FORE, fz), (-HX, FRONT_Y, fz)], 'concrete_dk')
        self.face([(HX, Y_FORE, 0), (HX, FRONT_Y, 0), (HX, FRONT_Y, fz), (HX, Y_FORE, fz)], 'concrete_dk')

        # facade
        rects = []

        def rect(x0, z0, x1, z1, depth, texel, reveal=None):
            rects.append((x0, z0, x1, z1, depth, texel, reveal))

        rect(-HX, 0, HX, BASE_H, 0, 'slate')
        # entrance: a pale-blue frame on the wall, a recess with two glass doors; its floor is the forecourt's height
        # and carries the carpet, so the threshold is level
        rect(-DOOR_HALF - 0.08, FORE_Z, DOOR_HALF + 0.08, CANOPY_Z0, 0, 'trim')
        rect(-DOOR_HALF, FORE_Z, DOOR_HALF, DOOR_Z1, DOOR_DEPTH, 'slate', ('trim', 'orange'))
        for s in (-1, 1):
            a, b = sorted((s * 0.04, s * (DOOR_HALF - 0.05)))
            rect(a, FORE_Z + 0.03, b, DOOR_Z1 - 0.05, DOOR_DEPTH, 'glass', ('trim', 'orange'))
        # ticket windows either side
        for s in (-1, 1):
            a, b = sorted((s * 0.80, s * 1.30))
            rect(a, 0.18, b, 0.54, 0, 'trim')
            a, b = sorted((s * 0.84, s * 1.26))
            rect(a, 0.22, b, 0.50, 0.03, 'glass', 'slate')
        # poster bezels and the poster pockets
        for cx in POSTER_CX:
            rect(cx - POSTER_W / 2 - BEZEL, POSTER_Z0 - BEZEL, cx + POSTER_W / 2 + BEZEL, POSTER_Z0 + POSTER_H + BEZEL, 0, 'trim')
            rect(cx - POSTER_W / 2, POSTER_Z0, cx + POSTER_W / 2, POSTER_Z0 + POSTER_H, POCKET, None, 'slate')
        self.facade(rects, (-HX, 0, HX, WALL_TOP), FRONT_Y, 'wall')

        # lobby side walls: base, wall, a band at the canopy height
        side = [(0, BASE_H, 'slate'), (BASE_H, CANOPY_Z0, 'wall'), (CANOPY_Z0, CANOPY_Z1, 'trim'),
                (CANOPY_Z1, WALL_TOP, 'wall')]
        self.wall((HX, FRONT_Y), (HX, LOBBY_BACK), side)
        self.wall((-HX, LOBBY_BACK), (-HX, FRONT_Y), side)

        # cornice and lobby roof
        self.box(-HX, FRONT_Y - CORNICE_OUT, WALL_TOP, HX, LOBBY_BACK, ROOF_Z, 'trim',
                 faces={'+z': 'concrete_dk'}, skip=('+y',))

        # the two auditorium storeys behind
        aud = [(0, BASE_H, 'concrete_dk'), (BASE_H, AUD_Z - 0.10, 'concrete'), (AUD_Z - 0.10, AUD_Z, 'trim')]
        self.wall((HX, LOBBY_BACK), (HX, Y_BACK), aud)
        self.wall((-HX, Y_BACK), (-HX, LOBBY_BACK), aud)
        self.wall((HX, Y_BACK), (-HX, Y_BACK), aud)
        self.wall((-HX, LOBBY_BACK), (HX, LOBBY_BACK), [(ROOF_Z, AUD_Z - 0.10, 'concrete'), (AUD_Z - 0.10, AUD_Z, 'trim')])
        self.face([(-HX, LOBBY_BACK, AUD_Z), (HX, LOBBY_BACK, AUD_Z), (HX, Y_BACK, AUD_Z), (-HX, Y_BACK, AUD_Z)], 'concrete_dk')
        # vertical ribs on the sides and back give the long walls a rhythm
        rib_z0, rib_z1, rib_w, rib_d = BASE_H, AUD_Z - 0.10, 0.06, 0.03
        for y in (0.33, 0.575, 0.82):
            for s in (-1, 1):
                x0, x1 = (HX, HX + rib_d) if s > 0 else (-HX - rib_d, -HX)
                self.box(x0, y - rib_w / 2, rib_z0, x1, y + rib_w / 2, rib_z1, 'concrete_lt', skip=('-z', '-x' if s > 0 else '+x'))
        for x in (-0.95, -0.32, 0.32, 0.95):
            self.box(x - rib_w / 2, Y_BACK, rib_z0, x + rib_w / 2, Y_BACK + rib_d, rib_z1, 'concrete_lt', skip=('-z', '-y'))
        # raised centre of the auditorium
        top = [(AUD_Z, AUD2_Z - 0.08, 'concrete_lt'), (AUD2_Z - 0.08, AUD2_Z, 'trim')]
        self.wall((AUD2_X, AUD2_Y0), (AUD2_X, Y_BACK), top)
        self.wall((-AUD2_X, Y_BACK), (-AUD2_X, AUD2_Y0), top)
        self.wall((-AUD2_X, AUD2_Y0), (AUD2_X, AUD2_Y0), top)
        self.wall((AUD2_X, Y_BACK), (-AUD2_X, Y_BACK), top)
        self.face([(-AUD2_X, AUD2_Y0, AUD2_Z), (AUD2_X, AUD2_Y0, AUD2_Z), (AUD2_X, Y_BACK, AUD2_Z), (-AUD2_X, Y_BACK, AUD2_Z)], 'concrete_dk')

    def canopy(self):
        """The marquee over the doors: striped top and front, a row of lamps along the lip, two posts."""
        y0 = FRONT_Y - CANOPY_OUT
        n = int(round(2 * CANOPY_HALF / STRIPE))
        for k in range(n):
            x0 = -CANOPY_HALF + k * STRIPE
            uv = 'orange' if k % 2 == 0 else 'white'
            self.face([(x0, y0, CANOPY_Z1), (x0 + STRIPE, y0, CANOPY_Z1), (x0 + STRIPE, FRONT_Y, CANOPY_Z1), (x0, FRONT_Y, CANOPY_Z1)], uv)
            self.face([(x0, y0, CANOPY_Z0 + 0.025), (x0 + STRIPE, y0, CANOPY_Z0 + 0.025), (x0 + STRIPE, y0, CANOPY_Z1), (x0, y0, CANOPY_Z1)], uv)
        lamps = 2 * n
        w = 2 * CANOPY_HALF / lamps
        for k in range(lamps):
            x0 = -CANOPY_HALF + k * w
            self.face([(x0, y0, CANOPY_Z0), (x0 + w, y0, CANOPY_Z0), (x0 + w, y0, CANOPY_Z0 + 0.025), (x0, y0, CANOPY_Z0 + 0.025)],
                      'bulb' if k % 2 == 0 else 'slate')
        for s in (-1, 1):
            self.face([(s * CANOPY_HALF, y0, CANOPY_Z0), (s * CANOPY_HALF, y0, CANOPY_Z1), (s * CANOPY_HALF, FRONT_Y, CANOPY_Z1),
                       (s * CANOPY_HALF, FRONT_Y, CANOPY_Z0)][::-s], 'slate')
        # underside
        self.face([(-CANOPY_HALF, y0, CANOPY_Z0), (-CANOPY_HALF, FRONT_Y, CANOPY_Z0), (CANOPY_HALF, FRONT_Y, CANOPY_Z0), (CANOPY_HALF, y0, CANOPY_Z0)], 'slate')
        p = 0.018
        for s in (-1, 1):
            x, y = s * (CANOPY_HALF - 0.05), y0 + 0.04
            self.box(x - p, y - p, FORE_Z, x + p, y + p, CANOPY_Z0, 'trim', skip=('-z', '+z'))

    def sign(self):
        """CINEMA in pixel letters, cut into a slate board with a pale-blue rim, standing on the roof behind the cornice."""
        rects = [(-SIGN_HALF, SIGN_Z0, SIGN_HALF, SIGN_Z1, 0, 'trim', None),
                 (-SIGN_HALF + RIM, SIGN_Z0 + RIM, SIGN_HALF - RIM, SIGN_Z1 - RIM, 0, 'slate', None)]
        widths = [len(FONT[ch][0]) for ch in TITLE]
        total = (sum(widths) + len(TITLE) - 1) * SIGN_PX
        x = -total / 2
        zt = (SIGN_Z0 + SIGN_Z1) / 2 + 3.5 * SIGN_PX
        for ch in TITLE:
            for r, row in enumerate(FONT[ch]):
                for c, px in enumerate(row):
                    if px == 'X':
                        x0, z1 = x + c * SIGN_PX, zt - r * SIGN_PX
                        rects.append((x0, z1 - SIGN_PX, x0 + SIGN_PX, z1, 0, 'orange', None))
            x += (len(FONT[ch][0]) + 1) * SIGN_PX
        self.facade(rects, (-SIGN_HALF, SIGN_Z0, SIGN_HALF, SIGN_Z1), FRONT_Y, 'slate')
        yb = FRONT_Y + SIGN_D
        self.face([(SIGN_HALF, yb, SIGN_Z0), (-SIGN_HALF, yb, SIGN_Z0), (-SIGN_HALF, yb, SIGN_Z1), (SIGN_HALF, yb, SIGN_Z1)], 'wall')
        self.face([(SIGN_HALF, FRONT_Y, SIGN_Z0), (SIGN_HALF, yb, SIGN_Z0), (SIGN_HALF, yb, SIGN_Z1), (SIGN_HALF, FRONT_Y, SIGN_Z1)], 'trim')
        self.face([(-SIGN_HALF, yb, SIGN_Z0), (-SIGN_HALF, FRONT_Y, SIGN_Z0), (-SIGN_HALF, FRONT_Y, SIGN_Z1), (-SIGN_HALF, yb, SIGN_Z1)], 'trim')
        self.face([(-SIGN_HALF, FRONT_Y, SIGN_Z1), (SIGN_HALF, FRONT_Y, SIGN_Z1), (SIGN_HALF, yb, SIGN_Z1), (-SIGN_HALF, yb, SIGN_Z1)], 'trim')

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


def poster_mesh(index, material):
    cx = POSTER_CX[index]
    x0, x1, z0, z1 = cx - POSTER_W / 2, cx + POSTER_W / 2, POSTER_Z0, POSTER_Z0 + POSTER_H
    y = FRONT_Y + POCKET
    me = bpy.data.meshes.new(f'poster-{index + 1}')
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    f = bm.faces.new([bm.verts.new((x0, y, z0)), bm.verts.new((x1, y, z0)), bm.verts.new((x1, y, z1)), bm.verts.new((x0, y, z1))])
    for loop, co in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = co
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = False
    me.materials.append(material)
    return me


def atlas_material():
    mat = bpy.data.materials.get('cinema-colormap')
    if mat:
        return mat
    mat = bpy.data.materials.new('cinema-colormap')
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


def poster_material(index):
    name = f'poster-{index + 1}'
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*POSTER_COLORS[index], 1.0)
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 1.0
    return mat


def rewrite_glb(path):
    """Rewrites the exporter's GLB like the Kenney kit's: the atlas as an external image, no embedded copy, metalness 0,
    double-sided materials, plain node names."""
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
    materials = []
    for m in doc['materials']:
        if m['name'] == 'cinema-colormap':
            materials.append({'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0.0},
                              'doubleSided': True, 'name': 'colormap'})
        else:
            factor = [round(c, 4) for c in m['pbrMetallicRoughness']['baseColorFactor']]
            materials.append({'pbrMetallicRoughness': {'baseColorFactor': factor, 'metallicFactor': 0.0},
                              'doubleSided': True, 'name': m['name']})
    doc['materials'] = materials
    for key in ('extensionsUsed', 'extensionsRequired'):
        doc.pop(key, None)
    doc['nodes'] = [{'mesh': i, 'name': mesh['name']} for i, mesh in enumerate(doc['meshes'])]
    doc['scenes'] = [{'nodes': list(range(len(doc['nodes']))), 'name': 'cinema'}]
    doc['scene'] = 0
    js = json.dumps(doc, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(bin_out))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bin_out), 0x004E4942) + bin_out
    with open(path, 'wb') as fh:
        fh.write(out)


def export(objs, path):
    for o in bpy.context.view_layer.objects:
        o.select_set(o in objs)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=True, export_animations=False, export_cameras=False,
                              export_lights=False, export_materials='EXPORT')
    rewrite_glb(path)


def build_cinema(export_glb=False, collection='Cinema', location=(0.0, -9.0, 0.0)):
    coll = bpy.data.collections.get(collection) or bpy.data.collections.new(collection)
    if coll.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(coll)
    for old in [o for o in coll.objects]:
        data = old.data
        bpy.data.objects.remove(old, do_unlink=True)
        if data.users == 0:
            bpy.data.meshes.remove(data)
    b = Builder()
    b.shell()
    b.canopy()
    b.sign()
    me = b.mesh('cinema', atlas_material())
    objs = []
    for name, data in [('cinema', me)] + [(f'poster-{i + 1}', poster_mesh(i, poster_material(i))) for i in range(4)]:
        ob = bpy.data.objects.new(name, data)
        coll.objects.link(ob)
        ob.location = location
        objs.append(ob)
    report = {'tris': sum(len(p.vertices) - 2 for p in me.polygons),
              'size': [round(v, 3) for v in objs[0].dimensions]}
    if export_glb:
        for ob in objs:
            ob.location = (0, 0, 0)
        os.makedirs(OUT_DIR, exist_ok=True)
        path = os.path.join(OUT_DIR, 'cinema.glb')
        export(objs, path)
        for ob in objs:
            ob.location = location
        report['bytes'] = os.path.getsize(path)
    return report


if __name__ == '__main__' and bpy.app.background:
    print('cinema', build_cinema(export_glb=True))
