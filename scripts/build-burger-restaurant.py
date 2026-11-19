# Builds the burger restaurant (public/assets/models/burger-restaurant/burger-restaurant.glb) on the Kenney City Kit
# (Roads) atlas.
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-burger-restaurant.py
#
# In an open Blender session, exec() this file (with __file__ set) and call build_burger(): it adds the model to a
# "Burger restaurant" collection for review; build_burger(export_glb=True) also writes the GLB.
#
# Units are game world units (a cell = 0.5): a 4 x 4 cell lot (2 x 2 units). Blender is Z-up and its -Y becomes glTF
# +Z, so the shop front (Blender -Y) faces +Z at rotation 0. One mesh, one material, flat shading.
import json
import math
import os
import struct

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
OUT_DIR = os.path.join(ROOT, 'public/assets/models/burger-restaurant')
ATLAS = os.path.join(ROOT, 'public/assets/models/roads/Textures/colormap.png')
ATLAS_URI = '../roads/Textures/colormap.png'
ATLAS_PX = 512

# Swatches as atlas pixels (x, y from the top-left), each the middle of a flat block; hex for reference.
SWATCH = {
    'cream': ((16, 144), 'fde4c7'),
    'mint': ((80, 144), '61cb8b'),
    'mint_dk': ((112, 208), '349d75'),
    'white': ((272, 272), 'ffffff'),
    'slate': ((144, 320), '4f5260'),
    'terracotta': ((400, 272), 'b06041'),
    'peach': ((464, 272), 'f2bf99'),
    'concrete_lt': ((240, 269), 'bdc5ed'),
    'concrete': ((208, 320), 'a0a8c9'),
    'concrete_dk': ((80, 320), '868ba1'),
    'glass': ((368, 208), '5d6cc6'),        # the houses' window cell (11, 1): the `windows` night mask
    'tomato': ((272, 144), 'cf534f'),
    'cheese': ((144, 192), 'ffc044'),
    'bun': ((240, 150), 'ff9644'),
    'patty': ((208, 48), '66564a'),
    'lettuce': ((144, 80), '4fa24e'),
}
UV = {k: (p[0] / ATLAS_PX, 1 - p[1] / ATLAS_PX) for k, (p, _) in SWATCH.items()}

LOT = 2.0                             # 4 x 4 cells
L = LOT / 2
GROUND = 0.02                         # slab top: flush with field, pavement and kerbs
BX = 0.78                             # building half width
Y_FRONT, Y_BACK = -0.22, 0.78         # the shop front and back walls; the patio is in front
BASE_H = 0.08                         # terracotta base course
WALL_TOP = 0.84
ROOF_Z = 0.90                         # top of the cornice
CORNICE_OUT = 0.03

# Front: door, windows, awning, fascia sign
DOOR_FRAME, DOOR_HALF, DOOR_TOP, DOOR_DEPTH = 0.17, 0.13, 0.36, 0.04
WIN_X0, WIN_X1, WIN_Z0, WIN_Z1 = 0.24, 0.70, 0.11, 0.41
AW_HALF, AW_OUT, AW_STRIPES = 0.76, 0.16, 15
AW_BACK_Z, AW_FRONT_Z, AW_LIP_Z, AW_UNDER_Z = 0.54, 0.47, 0.43, 0.50
BAND_Z0, BAND_Z1 = AW_UNDER_Z, AW_BACK_Z  # the mint band round the sides and back, in line with the awning
PANEL_HALF, PANEL_Z0, PANEL_Z1 = 0.64, 0.57, 0.81
SIGN_PX = 0.028
TITLE = 'BURGERS'
FONT = {
    'B': ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X...X', 'X...X', 'XXXX.'],
    'U': ['X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
    'R': ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X.X..', 'X..X.', 'X...X'],
    'G': ['.XXX.', 'X...X', 'X....', 'X.XXX', 'X...X', 'X...X', '.XXX.'],
    'E': ['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'XXXXX'],
    'S': ['.XXXX', 'X....', 'X....', '.XXX.', '....X', '....X', 'XXXX.'],
}

# The burger on the roof: a lathe profile (radius, z above BURGER_Z0, colour of the surface up to this point)
BURGER_X, BURGER_Y = 0.0, 0.16
BURGER_Z0 = ROOF_Z + 0.08
BURGER_SEGS = 12
BURGER_PROFILE = [
    (0.22, 0.00, None),
    (0.27, 0.03, 'bun'),
    (0.27, 0.075, 'bun'),
    (0.29, 0.075, 'patty'),
    (0.29, 0.14, 'patty'),
    (0.24, 0.14, 'patty'),
    (0.24, 0.215, 'patty'),
    (0.285, 0.215, 'bun'),
    (0.29, 0.25, 'bun'),
    (0.26, 0.325, 'bun'),
    (0.19, 0.38, 'bun'),
    (0.09, 0.41, 'bun'),
]
CHEESE_CORNER, CHEESE_Z, CHEESE_T, CHEESE_DROOP = 0.36, 0.125, 0.025, 0.05
LETTUCE_R, LETTUCE_IN, LETTUCE_Z0, LETTUCE_Z1 = 0.315, 0.268, 0.145, 0.18
TOMATO_R, TOMATO_Z0, TOMATO_Z1 = 0.28, 0.175, 0.212

# Patio
TABLES = [(-0.50, -0.62), (0.50, -0.62)]
PATH_HALF = 0.15
PLANTERS = [(-0.32, -0.88), (0.32, -0.88)]


class Builder:
    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.verts = {}
        self.skipped = 0

    def v(self, co):
        key = tuple(round(c, 5) for c in co)
        vert = self.verts.get(key)
        if vert is None:
            vert = self.verts[key] = self.bm.verts.new(key)
        return vert

    def face(self, cos, uv, want=None):
        """A face in the given winding, or reversed when `want` (a direction) says its normal points the other way."""
        cos = [tuple(c) for c in cos]
        if want is not None:
            n = Vector((0, 0, 0))
            for i in range(len(cos)):
                a, b = Vector(cos[i]), Vector(cos[(i + 1) % len(cos)])
                n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
            if n.dot(Vector(want)) < 0:
                cos = cos[::-1]
        verts = []
        for c in cos:
            vert = self.v(c)
            if vert not in verts:
                verts.append(vert)
        if len(verts) < 3:
            return
        try:
            f = self.bm.faces.new(verts)
        except ValueError:
            self.skipped += 1
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

    def facade(self, frame, rects, bounds, base):
        """A wall plane cut into a grid at every rect edge. frame: (origin, u axis, outward normal), with
        normal = u x up. rects: (u0, z0, u1, z1, depth, texel, reveal), later wins. A cell deeper than its
        neighbour gets side faces from the neighbour's plane back to its own, in its `reveal` colour (or
        (sides, floor))."""
        o, ux, nrm = (Vector(c) for c in frame)
        up = Vector((0, 0, 1))
        p = lambda u, d, z: tuple(o + ux * u + up * z - nrm * d)
        u0, z0, u1, z1 = bounds
        us = sorted({round(v, 5) for v in (u0, u1, *[r[0] for r in rects], *[r[2] for r in rects]) if u0 <= v <= u1})
        zs = sorted({round(v, 5) for v in (z0, z1, *[r[1] for r in rects], *[r[3] for r in rects]) if z0 <= v <= z1})
        cell = {}
        for i in range(len(us) - 1):
            for j in range(len(zs) - 1):
                cu, cz = (us[i] + us[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
                state = (0.0, base, base)
                for ru0, rz0, ru1, rz1, depth, texel, reveal in rects:
                    if ru0 <= cu <= ru1 and rz0 <= cz <= rz1:
                        state = (depth, texel, reveal)
                cell[i, j] = state
        for (i, j), (depth, texel, reveal) in cell.items():
            a, b, c, d = us[i], us[i + 1], zs[j], zs[j + 1]
            self.face([p(a, depth, c), p(b, depth, c), p(b, depth, d), p(a, depth, d)], texel)
            for nb, kind in (((i + 1, j), 'u+'), ((i - 1, j), 'u-'), ((i, j + 1), 'z+'), ((i, j - 1), 'z-')):
                if nb not in cell or cell[nb][0] >= depth:
                    continue
                near, far = cell[nb][0], depth
                uv = reveal or base
                if isinstance(uv, tuple):
                    uv = uv[1] if kind == 'z-' else uv[0]
                if kind == 'u+':
                    self.face([p(b, far, c), p(b, near, c), p(b, near, d), p(b, far, d)], uv)
                elif kind == 'u-':
                    self.face([p(a, near, c), p(a, far, c), p(a, far, d), p(a, near, d)], uv)
                elif kind == 'z+':
                    self.face([p(a, far, d), p(b, far, d), p(b, near, d), p(a, near, d)], uv)
                else:
                    self.face([p(a, near, c), p(b, near, c), p(b, far, c), p(a, far, c)], uv)

    def awning(self, frame, u0, u1, back_z, front_z, lip_z, under_z, out, stripes, colours, under_uv):
        """A sloped striped awning on a wall frame: a top, a valance at the lip, an underside and two ends."""
        o, ux, nrm = (Vector(c) for c in frame)
        up = Vector((0, 0, 1))
        p = lambda u, d, z: tuple(o + ux * u + up * z + nrm * d)
        w = (u1 - u0) / stripes
        for k in range(stripes):
            a, b = u0 + k * w, u0 + (k + 1) * w
            uv = colours[k % len(colours)]
            self.face([p(a, out, front_z), p(b, out, front_z), p(b, 0, back_z), p(a, 0, back_z)], uv, want=up + nrm)
            self.face([p(a, out, lip_z), p(b, out, lip_z), p(b, out, front_z), p(a, out, front_z)], uv, want=nrm)
        self.face([p(u0, out, lip_z), p(u0, 0, under_z), p(u1, 0, under_z), p(u1, out, lip_z)], under_uv, want=-up)
        for u, s in ((u0, -1), (u1, 1)):
            self.face([p(u, 0, under_z), p(u, 0, back_z), p(u, out, front_z), p(u, out, lip_z)], colours[0], want=ux * s)

    def lathe(self, cx, cy, z0, profile, segs, phase=0.0, top_uv=None, bottom_uv=None):
        ang = [phase + 2 * math.pi * k / segs for k in range(segs)]
        ring = lambda r, z: [(cx + r * math.cos(a), cy + r * math.sin(a), z0 + z) for a in ang]
        rings = [ring(r, z) for r, z, _ in profile]
        for (r1, z1, _), (r2, z2, uv), lo, hi in zip(profile, profile[1:], rings, rings[1:]):
            dr, dz = r2 - r1, z2 - z1
            for k in range(segs):
                m = (ang[k] + ang[(k + 1) % segs]) / 2 + (math.pi if k == segs - 1 else 0)
                want = (math.cos(m) * dz, math.sin(m) * dz, -dr)
                self.face([lo[k], lo[(k + 1) % segs], hi[(k + 1) % segs], hi[k]], uv, want=want)
        if bottom_uv:
            self.face(rings[0], bottom_uv, want=(0, 0, -1))
        if top_uv:
            self.face(rings[-1], top_uv, want=(0, 0, 1))
        return rings

    def prism(self, pts, z0, z1, uv, bottom=True, top_pts=None):
        """A vertical prism over a convex-ish polygon (xy); `top_pts` (xyz) replaces the flat top ring."""
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        lo = [(x, y, z0) for x, y in pts]
        hi = top_pts or [(x, y, z1) for x, y in pts]
        n = len(pts)
        for k in range(n):
            a, b = k, (k + 1) % n
            mx, my = (pts[a][0] + pts[b][0]) / 2 - cx, (pts[a][1] + pts[b][1]) / 2 - cy
            self.face([lo[a], lo[b], hi[b], hi[a]], uv, want=(mx, my, 0))
        self.face(hi, uv, want=(0, 0, 1))
        if bottom:
            self.face(lo, uv, want=(0, 0, -1))

    def ngon(self, cx, cy, r, n, phase=0.0):
        return [(cx + r * math.cos(phase + 2 * math.pi * k / n), cy + r * math.sin(phase + 2 * math.pi * k / n)) for k in range(n)]

    # ---- the lot ---------------------------------------------------------------------------------

    def slab(self):
        """Paving over the whole lot at ground level: a peach path to the door, pale concrete elsewhere."""
        xs = [-L, -BX, -PATH_HALF, PATH_HALF, BX, L]
        ys = [-L, Y_FRONT, Y_BACK, L]
        for i in range(len(xs) - 1):
            for j in range(len(ys) - 1):
                cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
                if abs(cx) < BX and Y_FRONT < cy < Y_BACK:
                    continue
                uv = 'peach' if abs(cx) < PATH_HALF and cy < Y_FRONT else 'concrete_lt'
                self.face([(xs[i], ys[j], GROUND), (xs[i + 1], ys[j], GROUND), (xs[i + 1], ys[j + 1], GROUND),
                           (xs[i], ys[j + 1], GROUND)], uv)
        # edge of the slab, seen where the lot meets lower ground (road asphalt at 0.01)
        for j in range(len(ys) - 1):
            self.face([(-L, ys[j], 0), (-L, ys[j + 1], 0), (-L, ys[j + 1], GROUND), (-L, ys[j], GROUND)], 'concrete_dk', want=(-1, 0, 0))
            self.face([(L, ys[j], 0), (L, ys[j + 1], 0), (L, ys[j + 1], GROUND), (L, ys[j], GROUND)], 'concrete_dk', want=(1, 0, 0))
        for i in range(len(xs) - 1):
            uv = 'peach' if abs((xs[i] + xs[i + 1]) / 2) < PATH_HALF else 'concrete_dk'
            self.face([(xs[i], -L, 0), (xs[i + 1], -L, 0), (xs[i + 1], -L, GROUND), (xs[i], -L, GROUND)], uv, want=(0, -1, 0))
            self.face([(xs[i], L, 0), (xs[i + 1], L, 0), (xs[i + 1], L, GROUND), (xs[i], L, GROUND)], 'concrete_dk', want=(0, 1, 0))
        # underside, seen while the player carries the building
        self.face([(-L, -L, 0), (L, -L, 0), (L, L, 0), (-L, L, 0)], 'concrete_dk', want=(0, 0, -1))

    # ---- the building ------------------------------------------------------------------------------

    def walls(self):
        front = ((0, Y_FRONT, 0), (1, 0, 0), (0, -1, 0))
        east = ((BX, 0, 0), (0, 1, 0), (1, 0, 0))
        west = ((-BX, 0, 0), (0, -1, 0), (-1, 0, 0))
        back = ((0, Y_BACK, 0), (-1, 0, 0), (0, 1, 0))
        self.frames = {'front': front, 'east': east, 'west': west}

        # the shop front below the awning: base course, a glazed double door, a big window each side
        rects = [(-BX, 0, BX, BASE_H, 0, 'terracotta', None),
                 (-DOOR_FRAME, GROUND, DOOR_FRAME, DOOR_TOP + 0.04, 0, 'mint', None),
                 (-DOOR_HALF, GROUND, DOOR_HALF, DOOR_TOP, DOOR_DEPTH, 'slate', ('mint', 'peach'))]
        for s in (-1, 1):
            a, b = sorted((s * 0.01, s * (DOOR_HALF - 0.01)))
            rects.append((a, GROUND + 0.01, b, DOOR_TOP - 0.02, DOOR_DEPTH, 'glass', ('mint', 'peach')))
            a, b = sorted((s * WIN_X0, s * WIN_X1))
            rects.append((a, WIN_Z0, b, WIN_Z1, 0, 'white', None))
            mid = (WIN_X0 + WIN_X1) / 2
            for p0, p1 in ((WIN_X0 + 0.03, mid - 0.01), (mid + 0.01, WIN_X1 - 0.03)):
                a, b = sorted((s * p0, s * p1))
                rects.append((a, WIN_Z0 + 0.03, b, WIN_Z1 - 0.03, 0.02, 'glass', 'white'))
        self.facade(front, rects, (-BX, 0, BX, AW_BACK_Z), 'cream')

        # the fascia above the awning: BURGERS in white pixel letters on a mint panel
        rects = [(-PANEL_HALF, PANEL_Z0, PANEL_HALF, PANEL_Z1, 0, 'mint', None)]
        widths = [len(FONT[ch][0]) for ch in TITLE]
        total = (sum(widths) + len(TITLE) - 1) * SIGN_PX
        x = -total / 2
        zt = (PANEL_Z0 + PANEL_Z1) / 2 + 3.5 * SIGN_PX
        for ch in TITLE:
            for r, row in enumerate(FONT[ch]):
                for c, px in enumerate(row):
                    if px == 'X':
                        x0, top = x + c * SIGN_PX, zt - r * SIGN_PX
                        rects.append((x0, top - SIGN_PX, x0 + SIGN_PX, top, 0, 'white', None))
            x += (len(FONT[ch][0]) + 1) * SIGN_PX
        self.facade(front, rects, (-BX, AW_BACK_Z, BX, WALL_TOP), 'cream')

        def bands(u0, u1):
            return [(u0, 0, u1, BASE_H, 0, 'terracotta', None), (u0, BAND_Z0, u1, BAND_Z1, 0, 'mint', None)]

        def window(u0, u1, frame_uv='white'):
            mid = (u0 + u1) / 2
            return [(u0, WIN_Z0, u1, WIN_Z1, 0, frame_uv, None),
                    (u0 + 0.03, WIN_Z0 + 0.03, mid - 0.01, WIN_Z1 - 0.03, 0.02, 'glass', frame_uv),
                    (mid + 0.01, WIN_Z0 + 0.03, u1 - 0.03, WIN_Z1 - 0.03, 0.02, 'glass', frame_uv)]

        # west: a dining-room window near the front
        self.facade(west, bands(-Y_BACK, -Y_FRONT) + window(-0.34, 0.08), (-Y_BACK, 0, -Y_FRONT, WALL_TOP), 'cream')
        # east: the take-away hatch with a counter and a little awning
        hatch = [(0.12, 0.14, 0.50, WIN_Z1, 0, 'mint', None), (0.15, 0.17, 0.47, WIN_Z1 - 0.03, 0.03, 'glass', 'slate')]
        self.facade(east, bands(Y_FRONT, Y_BACK) + hatch, (Y_FRONT, 0, Y_BACK, WALL_TOP), 'cream')
        self.box(BX, 0.10, 0.15, BX + 0.05, 0.52, 0.17, 'white', skip=('-x',), faces={'-z': 'white'})
        self.awning(east, 0.08, 0.54, BAND_Z0, 0.45, 0.42, 0.47, 0.10, 5, ('mint', 'white'), 'mint_dk')
        # back: the kitchen door and an extract grille
        back_rects = bands(-BX, BX) + [(-0.54, GROUND, -0.30, 0.40, 0, 'white', None),
                                       (-0.51, GROUND, -0.33, 0.37, 0.02, 'slate', ('white', 'concrete_lt')),
                                       (0.20, 0.62, 0.42, 0.74, 0.015, 'slate', 'concrete_dk')]
        self.facade(back, back_rects, (-BX, 0, BX, WALL_TOP), 'cream')

        # the striped awning over the shop front
        self.awning(front, -AW_HALF, AW_HALF, AW_BACK_Z, AW_FRONT_Z, AW_LIP_Z, AW_UNDER_Z, AW_OUT, AW_STRIPES,
                    ('mint', 'white'), 'mint_dk')

        # cornice and flat roof
        c = CORNICE_OUT
        self.box(-BX - c, Y_FRONT - c, WALL_TOP, BX + c, Y_BACK + c, ROOF_Z, 'white', faces={'+z': 'concrete_dk'}, skip=())

    def roof(self):
        # air-handling unit and the grill's extract stack
        self.box(-0.56, 0.42, ROOF_Z, -0.24, 0.66, ROOF_Z + 0.11, 'concrete', faces={'+z': 'concrete_lt'})
        self.box(0.44, 0.50, ROOF_Z, 0.52, 0.58, ROOF_Z + 0.20, 'slate', skip=('-z', '+z'))
        self.box(0.42, 0.48, ROOF_Z + 0.20, 0.54, 0.60, ROOF_Z + 0.23, 'slate', skip=())
        # the burger's stand: a mint plate on the roof and a stem into the bottom bun
        self.lathe(BURGER_X, BURGER_Y, ROOF_Z, [(0.16, 0.0, None), (0.16, 0.035, 'mint'), (0.06, 0.035, 'mint'),
                                                (0.06, BURGER_Z0 - ROOF_Z + 0.005, 'slate')], 8, phase=math.pi / 8)

    def burger(self):
        cx, cy, z0 = BURGER_X, BURGER_Y, BURGER_Z0
        rings = self.lathe(cx, cy, z0, BURGER_PROFILE, BURGER_SEGS, phase=math.pi / BURGER_SEGS,
                           top_uv='bun', bottom_uv='bun')
        # a slice of cheese, turned 45 degrees so its corners hang out over the patty
        h = CHEESE_CORNER
        sq = [(cx + h, cy), (cx, cy + h), (cx - h, cy), (cx, cy - h)]
        corners_hi = [(x, y, z0 + CHEESE_Z + CHEESE_T - CHEESE_DROOP) for x, y in sq]
        corners_lo = [(x, y, z0 + CHEESE_Z - CHEESE_DROOP) for x, y in sq]
        top_c = (cx, cy, z0 + CHEESE_Z + CHEESE_T)
        for k in range(4):
            a, b = k, (k + 1) % 4
            self.face([corners_hi[a], corners_hi[b], top_c], 'cheese', want=(0, 0, 1))
            self.face([corners_lo[a], corners_lo[b], (cx, cy, z0 + CHEESE_Z)], 'cheese', want=(0, 0, -1))
            mx, my = (sq[a][0] + sq[b][0]) / 2 - cx, (sq[a][1] + sq[b][1]) / 2 - cy
            self.face([corners_lo[a], corners_lo[b], corners_hi[b], corners_hi[a]], 'cheese', want=(mx, my, 0))
        # frilly lettuce and a slice of tomato
        star = [(cx + (LETTUCE_R if k % 2 == 0 else LETTUCE_IN) * math.cos(math.pi * k / 12),
                 cy + (LETTUCE_R if k % 2 == 0 else LETTUCE_IN) * math.sin(math.pi * k / 12)) for k in range(24)]
        self.prism(star, z0 + LETTUCE_Z0, z0 + LETTUCE_Z1, 'lettuce')
        self.prism(self.ngon(cx, cy, TOMATO_R, 12, math.pi / 12 + 0.13), z0 + TOMATO_Z0, z0 + TOMATO_Z1, 'tomato', bottom=False)
        # sesame seeds on the facets of the top bun
        for ring_i, count, offset in ((9, 6, 0), (10, 3, 1)):
            lo, hi = rings[ring_i], rings[ring_i + 1]
            for s in range(count):
                k = (s * BURGER_SEGS // count + offset) % BURGER_SEGS
                quad = [Vector(lo[k]), Vector(lo[(k + 1) % BURGER_SEGS]), Vector(hi[(k + 1) % BURGER_SEGS]), Vector(hi[k])]
                cen = sum(quad, Vector()) / 4
                t = (quad[1] - quad[0]).normalized()
                n = (quad[1] - quad[0]).cross(quad[3] - quad[0]).normalized()
                if n.dot(cen - Vector((cx, cy, cen.z))) < 0:
                    n = -n
                b = n.cross(t)
                ln, wd, ht = 0.042, 0.022, 0.014
                o = cen - t * ln / 2 - b * wd / 2 - n * ht * 0.4
                self.hexa(o, t * ln, b * wd, n * ht, 'white', skip=('-z',))

    def patio(self):
        for tx, ty in TABLES:
            # table: pedestal, round top; parasol: pole and an eight-panel canopy in tomato and white
            self.box(tx - 0.018, ty - 0.018, 0.015, tx + 0.018, ty + 0.018, 0.12, 'slate', skip=('-z', '+z'))
            self.prism(self.ngon(tx, ty, 0.11, 8, math.pi / 8), 0.12, 0.135, 'white')
            self.box(tx - 0.009, ty - 0.009, 0.135, tx + 0.009, ty + 0.009, 0.40, 'slate', skip=('-z',))
            rim = [(tx + 0.20 * math.cos(math.pi / 8 + math.pi * k / 4), ty + 0.20 * math.sin(math.pi / 8 + math.pi * k / 4), 0.33)
                   for k in range(8)]
            apex = (tx, ty, 0.39)
            for k in range(8):
                self.face([rim[k], rim[(k + 1) % 8], apex], 'tomato' if k % 2 == 0 else 'white', want=(0, 0, 1))
            # two stools
            for sx in (-1, 1):
                x = tx + sx * 0.16
                self.box(x - 0.035, ty - 0.035, 0.015, x + 0.035, ty + 0.035, 0.085, 'tomato')
        for px, py in PLANTERS:
            self.box(px - 0.09, py - 0.07, 0.015, px + 0.09, py + 0.07, 0.11, 'terracotta', faces={'+z': 'patty'})
            self.lathe(px, py, 0.10, [(0.07, 0.0, None), (0.085, 0.04, 'lettuce'), (0.06, 0.09, 'lettuce'), (0.0, 0.11, 'lettuce')],
                       8, phase=0.3)

    def yard(self):
        # a wheelie bin at the back
        self.box(-0.60, 0.84, 0.015, -0.30, 0.97, 0.15, 'mint_dk', faces={'+z': 'slate'})

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


def atlas_material():
    mat = bpy.data.materials.get('burger-colormap')
    if mat:
        return mat
    mat = bpy.data.materials.new('burger-colormap')
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


def check_swatches():
    img = bpy.data.images.load(ATLAS, check_existing=True)
    w, h = img.size
    px = img.pixels[:]
    bad = {}
    for name, ((x, y), hexv) in SWATCH.items():
        i = ((h - 1 - y) * w + x) * 4
        srgb = ''.join('%02x' % round(c * 255) for c in px[i:i + 3])
        if srgb != hexv:
            bad[name] = srgb
    return bad


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
        if m['name'] == 'burger-colormap':
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
    doc['scenes'] = [{'nodes': list(range(len(doc['nodes']))), 'name': 'burger-restaurant'}]
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


def build_burger(export_glb=False, collection='Burger restaurant', location=(0.0, 0.0, 0.0)):
    coll = bpy.data.collections.get(collection) or bpy.data.collections.new(collection)
    if coll.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(coll)
    for old in list(coll.objects):
        data = old.data
        bpy.data.objects.remove(old, do_unlink=True)
        if data.users == 0:
            bpy.data.meshes.remove(data)
    b = Builder()
    b.slab()
    b.walls()
    b.roof()
    b.burger()
    b.patio()
    b.yard()
    skipped = b.skipped
    me = b.mesh('burger-restaurant', atlas_material())
    ob = bpy.data.objects.new('burger-restaurant', me)
    coll.objects.link(ob)
    ob.location = location
    report = {'tris': sum(len(p.vertices) - 2 for p in me.polygons), 'size': [round(v, 3) for v in ob.dimensions],
              'skipped_faces': skipped, 'swatch_mismatch': check_swatches()}
    if export_glb:
        ob.location = (0, 0, 0)
        os.makedirs(OUT_DIR, exist_ok=True)
        path = os.path.join(OUT_DIR, 'burger-restaurant.glb')
        export([ob], path)
        ob.location = location
        report['bytes'] = os.path.getsize(path)
    return report


if __name__ == '__main__' and bpy.app.background:
    print('burger-restaurant', build_burger(export_glb=True))
