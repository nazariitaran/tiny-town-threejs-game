# Builds the pond models (public/assets/models/pond/*.glb) on the Kenney City Kit (Roads) atlas: the shore
# pieces (each in a field and a lawn colourway), lily pads, reeds, cattails, the floating duck house and the duck.
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-pond.py
#
# In an open Blender session, exec() this file (with __file__ set) and call build_pond(): it lays the
# models out in a "Pond" collection for review; build_pond(export_glb=True) also writes the GLBs.
#
# Every model is written in GAME coordinates (Y up, front and the duck's bill towards +Z, north = -Z) and
# turned into Blender's (Z up, front towards -Y) as its vertices are made. Units are world units: a cell is
# 0.5, a shore piece is the north-west quarter of a cell (0.25 x 0.25) with its origin at the quarter's
# centre and its base at 0. The water is not modelled: the game draws a slab with its top at WATER_Y.
import json
import math
import os
import struct

import bmesh
import bpy
from mathutils import Vector
from mathutils.geometry import tessellate_polygon

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
OUT_DIR = os.path.join(ROOT, 'public/assets/models/pond')
ATLAS = os.path.join(ROOT, 'public/assets/models/roads/Textures/colormap.png')
ATLAS_URI = '../roads/Textures/colormap.png'
ATLAS_PX = 512
BLOCK_PX = 32

# colormap.png swatches as (column, 32 px row from the top, hex at the block's centre). The atlas is 16 x 4
# cells of 32 x 128 px; a gradient cell is sampled at one height. Cells (4, 0), (5, 0) and (6, 0) hold the
# pond's own flat bands. No face samples the houses' window cell (column 11, the second cell from the top).
SWATCHES = {
    'field': (4, 0, '84c27c'),      # the plot's field green (world/Terrain.ts): bank tops and walls
    'lawn': (5, 0, '6cb562'),       # the lawn tile's green (GROUND_MODELS.grass): the -lawn colourway's bank
    'slate': (5, 1, '8b9199'),      # the duck house's roof
    'slate_dk': (5, 2, '6a7079'),
    'timber': (5, 3, '8a7462'),     # the raft's weathered planks
    'timber_lt': (6, 0, 'a08a74'),
    'timber_dk': (6, 1, '66564a'),
    'blue': (10, 5, '6794d9'),      # the drake's wing patch
    'sand': (4, 1, 'ead9a6'),       # the bank's slope
    'pad': (4, 2, '4fa24e'),        # lily pads, dark blades
    'reed': (4, 3, 'a5c95a'),       # reed and cattail blades
    'cream': (0, 5, 'fde4c7'),
    'head': (3, 7, '228a6c'),       # the drake's head
    'yellow': (4, 5, 'ffc044'),
    'red': (8, 5, 'cf534f'),
    'red_dk': (9, 7, 'd5564d'),
    'pink_lt': (2, 1, 'f5c8f0'),
    'dark': (0, 9, '38383d'),
    'grey': (2, 9, '868ba1'),
    'grey_lt': (6, 9, 'a0a8c9'),
    'white': (8, 9, 'ffffff'),
    'offwhite': (9, 9, 'e5e5ee'),
    'brown': (12, 9, 'b06041'),
    'brown_md': (13, 10, '935841'),
    'brown_dk': (13, 11, '875541'),
    'tan': (14, 9, 'f2bf99'),
    'tan_md': (15, 9, 'e2a781'),
    'tan_dk': (15, 11, 'cd8861'),
}
UV = {name: ((col * BLOCK_PX + 16.5) / ATLAS_PX, 1 - (row * BLOCK_PX + 16.5) / ATLAS_PX)
      for name, (col, row, _) in SWATCHES.items()}

WATER_Y = 0.008                       # top of the game's water slab (GROUND_MODELS.pond)

# ---- shore ---------------------------------------------------------------------------------------
Q = 0.25                              # a quarter cell
H = Q / 2
BANK_TOP = 0.02                       # ground level: flush with the field, lawn, pavement and kerb tops
# Bank profile from the land boundary into the pond: (distance, height, the colour of the strip that starts
# here). Every shore piece meets its neighbours with exactly this section.
PROFILE = [
    (0.0, BANK_TOP, 'field'),
    (0.026, BANK_TOP, 'sand'),
    (0.046, 0.012, 'sand'),
    (0.066, 0.0, None),
]
LIP = PROFILE[1][0]                   # where the flat top ends and the slope starts
OUTER_STEPS = 8                       # facets of an outer corner's quarter circle
INNER_STEPS = 4
BULGE = 0.034                         # how far pond-edge-c pushes its waterline into the pond
BULGE_SHAPE = [(0.0, 0.0), (0.12, 0.0), (0.32, 0.8), (0.5, 1.0), (0.68, 0.8), (0.88, 0.0), (1.0, 0.0)]
# pond-edge-d: a cove and a point. (along 0..1, the lip's distance from the land boundary); the slope is offset
# square to this line, so the waterline runs about 0.027 further out.
WAVE_LIP = [(0.0, LIP), (0.12, 0.018), (0.28, 0.008), (0.44, 0.024), (0.58, 0.058), (0.71, 0.074), (0.85, 0.054), (1.0, LIP)]
# The wide corners pull the lip in from pond-outer-a's quarter circle (radius Q - LIP round the cell centre) by
# CUT * sin(2 * angle) ** POWER: nothing at the two seams, most on the diagonal.
CHAMFER_CUT, CHAMFER_POWER, CHAMFER_STEPS = 0.068, 1.5, 10      # pond-outer-c
BEACH_CUT, BEACH_POWER, BEACH_STEPS = 0.092, 1.25, 9            # pond-outer-d: the sand's outer edge
BEACH_GRASS_CUT, BEACH_GRASS_POWER = 0.022, 2.0                 # ... and where its grass stops

# ---- pond items ----------------------------------------------------------------------------------
PAD_THICK = 0.005
PAD_SIDES = 8                         # rim points of a pad, either side of its notch
PAD_NOTCH = 0.38                      # half angle of the notch, radians
GOLDEN = math.pi * (3 - math.sqrt(5))


class Builder:
    """Collects faces given in game coordinates; one atlas swatch per face."""

    swap = {}                         # swatch substitutions (the lawn colourway)

    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.verts = {}

    def v(self, co):
        # game (x, y, z) -> Blender (x, -z, y)
        key = (round(co[0], 5) + 0.0, round(-co[2], 5) + 0.0, round(co[1], 5) + 0.0)
        vert = self.verts.get(key)
        if vert is None:
            vert = self.verts[key] = self.bm.verts.new(key)
        return vert

    def face(self, cos, uv, want=None, away=None):
        """A polygon. `want` is a direction its normal must agree with; `away` a point it must face away from."""
        cos = [Vector(c) for c in cos]
        normal = Vector((0, 0, 0))
        for i in range(len(cos)):
            a, b = cos[i], cos[(i + 1) % len(cos)]
            normal += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
        if normal.length < 1e-12:
            return
        if away is not None:
            want = sum(cos, Vector((0, 0, 0))) / len(cos) - Vector(away)
        if want is not None and normal.dot(Vector(want)) < 0:
            cos.reverse()
        verts = []
        for vert in (self.v(c) for c in cos):
            if vert not in verts:
                verts.append(vert)
        if len(verts) < 3:
            return
        f = self.bm.faces.new(verts)
        for loop in f.loops:
            loop[self.uv].uv = UV[self.swap.get(uv, uv)]

    def box(self, x0, y0, z0, x1, y1, z1, uv, faces=None, skip=()):
        """An axis-aligned box; `faces` overrides the swatch per side ('+x', '-y', ...)."""
        c = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
        sides = {
            '-x': [(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)],
            '+x': [(x1, y0, z0), (x1, y0, z1), (x1, y1, z1), (x1, y1, z0)],
            '-y': [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
            '+y': [(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)],
            '-z': [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)],
            '+z': [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],
        }
        for name, pts in sides.items():
            if name not in skip:
                self.face(pts, (faces or {}).get(name, uv), away=c)

    def loft(self, rings, uvs, caps=(None, None)):
        """Skins consecutive rings (equal point counts, convex round their centres); uvs[i] colours the band from
        ring i to i + 1 and is a swatch or a list with one swatch per side. `caps` closes the ends."""
        centre = sum((Vector(p) for ring in rings for p in ring), Vector((0, 0, 0))) / sum(len(r) for r in rings)
        n = len(rings[0])
        for i in range(len(rings) - 1):
            a, b = rings[i], rings[i + 1]
            mid = (sum((Vector(p) for p in a + b), Vector((0, 0, 0)))) / (2 * n)
            for k in range(n):
                uv = uvs[i][k] if isinstance(uvs[i], (list, tuple)) else uvs[i]
                self.face([a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]], uv, away=mid)
        for ring, uv in ((rings[0], caps[0]), (rings[-1], caps[1])):
            if uv:
                self.face(ring, uv, away=centre)

    def stone(self, x, z, y0, y1, r0, r1, sides, side_uv, top_uv, turn=0.0, squash=1.0, tilt=(0.0, 0.0)):
        """A faceted stone: a ring of radius r0 at y0, a smaller top ring at y1 tipped by `tilt` (rise per unit x, z)."""
        ring = lambda r, y, t: [(x + math.cos(turn + k / sides * math.tau) * r,
                                 y + (math.cos(turn + k / sides * math.tau) * r * t[0]
                                      + math.sin(turn + k / sides * math.tau) * r * squash * t[1]),
                                 z + math.sin(turn + k / sides * math.tau) * r * squash) for k in range(sides)]
        self.loft([ring(r0, y0, (0, 0)), ring(r1, y1, tilt)], [side_uv], caps=(None, top_uv))

    def blade(self, x, z, height, width, lean, uv, turn=0.0, bend=0.55):
        """A three-sided leaf standing on y = 0: straight to `bend` of its height, then curving out to a point."""
        lx, lz = lean
        tri = lambda cx, cy, cz, r: [(cx + math.cos(turn + k * math.tau / 3) * r, cy, cz + math.sin(turn + k * math.tau / 3) * r)
                                     for k in range(3)]
        r = width / math.sqrt(3)
        base = tri(x, 0.0, z, r)
        mid = tri(x + lx * 0.3, height * bend, z + lz * 0.3, r * 0.72)
        tip = (x + lx, height, z + lz)
        self.loft([base, mid], [uv])
        centre = (x + lx * 0.3, height * bend - 0.01, z + lz * 0.3)
        for k in range(3):
            self.face([mid[k], mid[(k + 1) % 3], tip], uv, away=centre)

    def prism(self, x, z, y0, y1, r, sides, uv, top=None, bottom=None, top_xz=None, turn=0.0):
        """An upright prism; `top_xz` moves its top (a leaning stem)."""
        tx, tz = top_xz or (x, z)
        ring = lambda cx, cy, cz: [(cx + math.cos(turn + k / sides * math.tau) * r, cy, cz + math.sin(turn + k / sides * math.tau) * r)
                                   for k in range(sides)]
        self.loft([ring(x, y0, z), ring(tx, y1, tz)], [uv], caps=(bottom, top))

    def mesh(self, name, material):
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for poly in me.polygons:
            poly.use_smooth = False
        me.materials.append(material)
        return me


# ---- shore pieces ----------------------------------------------------------------------------------

def sweep(b, rows):
    """Skins the bank's slope along `rows(d)`: plan polylines (x, z) at a profile distance."""
    for i in range(1, len(PROFILE) - 1):
        d0, y0, uv = PROFILE[i]
        d1, y1, _ = PROFILE[i + 1]
        p, q = rows(d0), rows(d1)
        for k in range(len(p) - 1):
            b.face([(p[k][0], y0, p[k][1]), (p[k + 1][0], y0, p[k + 1][1]), (q[k + 1][0], y1, q[k + 1][1]), (q[k][0], y1, q[k][1])],
                   uv, want=(0, 1, 0))


def land_wall(b, p0, p1, out):
    """The wall on a cell boundary that faces land, from the ground to the bank top."""
    b.face([(p0[0], 0, p0[1]), (p1[0], 0, p1[1]), (p1[0], BANK_TOP, p1[1]), (p0[0], BANK_TOP, p0[1])], 'field', want=(out[0], 0, out[1]))


def offset_rows(lip, first, last):
    """rows(d) for a slope that runs square to the plan polyline `lip` (the line at distance LIP). `first` and
    `last` are the unit offsets at the two seams; they also tell which side of the line the pond is on."""
    normals = []
    for a, b in zip(lip, lip[1:]):
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        normals.append(((b[1] - a[1]) / length, -(b[0] - a[0]) / length))
    if normals[0][0] * first[0] + normals[0][1] * first[1] < 0:
        normals = [(-x, -z) for x, z in normals]
    mitres = [first]
    for n0, n1 in zip(normals, normals[1:]):
        mx, mz = n0[0] + n1[0], n0[1] + n1[1]
        scale = 1 / (mx * n0[0] + mz * n0[1])
        mitres.append((mx * scale, mz * scale))
    mitres.append(last)
    return lambda d: [(p[0] + m[0] * (d - LIP), p[1] + m[1] * (d - LIP)) for p, m in zip(lip, mitres)]


def wave_piece():
    """A bank along the north side whose lip follows WAVE_LIP: a cove, then a point."""
    b = Builder()
    lip = [(-H + u * Q, -H + d) for u, d in WAVE_LIP]
    b.face([(-H, BANK_TOP, -H), (H, BANK_TOP, -H)] + [(x, BANK_TOP, z) for x, z in reversed(lip)], 'field', want=(0, 1, 0))
    sweep(b, offset_rows(lip, (0, 1), (0, 1)))
    land_wall(b, (-H, -H), (H, -H), (0, -1))
    return b


def wide_arc(cut, power, steps):
    """A corner's lip from the east seam to the south seam: pond-outer-a's arc pulled towards the cell centre."""
    out = []
    for k in range(steps + 1):
        a = k / steps * math.pi / 2
        r = Q - LIP - cut * max(0.0, math.sin(2 * a)) ** power
        out.append((H - math.sin(a) * r, H - math.cos(a) * r))
    return out


def wide_outer_piece(cut, power, steps, grass=None):
    """A convex corner, land north and west, that fills more of its quarter than outer_piece. `grass` (cut, power)
    stops the grass on a nearer arc and leaves a flat crescent of sand between the two."""
    b = Builder()
    lip = wide_arc(cut, power, steps)
    green = wide_arc(grass[0], grass[1], steps) if grass else lip
    top = lambda p: (p[0], BANK_TOP, p[1])
    corner = (-H, BANK_TOP, -H)
    b.face([corner, top(green[0]), (H, BANK_TOP, -H)], 'field', want=(0, 1, 0))
    for k in range(steps):
        b.face([corner, top(green[k]), top(green[k + 1])], 'field', want=(0, 1, 0))
        if grass:
            b.face([top(green[k]), top(green[k + 1]), top(lip[k + 1]), top(lip[k])], 'sand', want=(0, 1, 0))
    b.face([corner, (-H, BANK_TOP, H), top(green[-1])], 'field', want=(0, 1, 0))
    sweep(b, offset_rows(lip, (0, 1), (1, 0)))
    land_wall(b, (-H, -H), (H, -H), (0, -1))
    land_wall(b, (-H, -H), (-H, H), (-1, 0))
    return b


def edge_piece(shape=((0.0, 0.0), (1.0, 0.0)), bulge=0.0):
    """A straight bank along the north side; `shape` (along 0..1, amount 0..1) pushes the waterline south by `bulge`."""
    b = Builder()
    row = lambda d: [(-H + u * Q, -H + d + bulge * a) for u, a in shape]
    lip = row(PROFILE[1][0])
    b.face([(-H, BANK_TOP, -H), (H, BANK_TOP, -H)] + [(x, BANK_TOP, z) for x, z in reversed(lip)], 'field', want=(0, 1, 0))
    sweep(b, row)
    land_wall(b, (-H, -H), (H, -H), (0, -1))
    return b


def outer_piece():
    """A convex corner, land north and west: the bank follows a quarter circle round the cell centre (+H, +H)."""
    b = Builder()

    def arc(d):
        r = Q - d
        return [(H + math.cos(math.pi + k / OUTER_STEPS * math.pi / 2) * r, H + math.sin(math.pi + k / OUTER_STEPS * math.pi / 2) * r)
                for k in range(OUTER_STEPS + 1)]

    lip = arc(PROFILE[1][0])
    top = lambda p: (p[0], BANK_TOP, p[1])
    corner = (-H, BANK_TOP, -H)
    # the flat top as a fan from the land corner: every lip point is in sight of it
    b.face([corner, (-H, BANK_TOP, H), top(lip[0])], 'field', want=(0, 1, 0))
    for k in range(OUTER_STEPS):
        b.face([corner, top(lip[k]), top(lip[k + 1])], 'field', want=(0, 1, 0))
    b.face([corner, top(lip[-1]), (H, BANK_TOP, -H)], 'field', want=(0, 1, 0))
    sweep(b, arc)
    land_wall(b, (-H, -H), (H, -H), (0, -1))
    land_wall(b, (-H, -H), (-H, H), (-1, 0))
    return b


def inner_piece():
    """A concave notch: land only at the north-west corner point, the bank rounding it."""
    b = Builder()
    arc = lambda d: [(-H + math.cos(k / INNER_STEPS * math.pi / 2) * d, -H + math.sin(k / INNER_STEPS * math.pi / 2) * d)
                     for k in range(INNER_STEPS + 1)]
    lip = arc(PROFILE[1][0])
    b.face([(-H, BANK_TOP, -H)] + [(x, BANK_TOP, z) for x, z in lip], 'field', want=(0, 1, 0))
    sweep(b, arc)
    return b


def pond_edge_a():
    return edge_piece()


def pond_edge_b():
    """The plain bank with three stones at the waterline."""
    b = edge_piece()
    b.stone(-0.052, -H + 0.054, 0.003, 0.026, 0.023, 0.013, 5, 'grey', 'grey_lt', turn=0.3, squash=0.8, tilt=(0.12, 0.1))
    b.stone(0.036, -H + 0.060, 0.002, 0.019, 0.017, 0.010, 4, 'grey', 'grey_lt', turn=1.0, tilt=(-0.1, 0.08))
    b.stone(0.068, -H + 0.047, 0.008, 0.021, 0.012, 0.0, 4, 'grey_lt', None, turn=0.4)
    return b


def pond_edge_c():
    return edge_piece(BULGE_SHAPE, BULGE)


def pond_edge_d():
    return wave_piece()


def pond_outer_a():
    return outer_piece()


def pond_outer_b():
    """The corner with a boulder on the bank."""
    b = outer_piece()
    b.stone(-0.058, -0.058, BANK_TOP - 0.003, 0.058, 0.036, 0.02, 5, 'grey', 'grey_lt', turn=0.5, squash=0.85, tilt=(0.2, 0.25))
    return b


def pond_outer_c():
    """A wide grassy corner: the waterline cuts across the quarter like a soft chamfer."""
    return wide_outer_piece(CHAMFER_CUT, CHAMFER_POWER, CHAMFER_STEPS)


def pond_outer_d():
    """A lobe of land with a crescent beach."""
    return wide_outer_piece(BEACH_CUT, BEACH_POWER, BEACH_STEPS, grass=(BEACH_GRASS_CUT, BEACH_GRASS_POWER))


def pond_inner():
    return inner_piece()


def lawn(make):
    """The same piece with its grass in the lawn tile's green."""
    def build():
        Builder.swap = {'field': 'lawn'}
        try:
            return make()
        finally:
            Builder.swap = {}
    return build


# ---- lily pads -------------------------------------------------------------------------------------

def pad(b, x, z, r, turn, uv):
    """A flat pad with a V notch towards `turn`, standing PAD_THICK tall on y = 0."""
    notch = (x + math.cos(turn) * r * 0.25, z + math.sin(turn) * r * 0.25)
    rim = []
    for k in range(PAD_SIDES + 1):
        a = turn + PAD_NOTCH + k / PAD_SIDES * (math.tau - 2 * PAD_NOTCH)
        rim.append((x + math.cos(a) * r, z + math.sin(a) * r))
    outline = [notch] + rim
    b.face([(px, PAD_THICK, pz) for px, pz in outline], uv, want=(0, 1, 0))
    for k in range(len(outline)):
        (ax, az), (bx, bz) = outline[k], outline[(k + 1) % len(outline)]
        b.face([(ax, 0, az), (bx, 0, bz), (bx, PAD_THICK, bz), (ax, PAD_THICK, az)], 'pad' if uv != 'pad' else 'head',
               away=(x, PAD_THICK / 2, z))


def lily(b, x, z, y):
    """A water lily: six open pale-pink petals, four upright white ones, a yellow heart."""
    for k in range(6):
        a = k / 6 * math.tau
        left = (x + math.cos(a + 1.25) * 0.012, y, z + math.sin(a + 1.25) * 0.012)
        right = (x + math.cos(a - 1.25) * 0.012, y, z + math.sin(a - 1.25) * 0.012)
        b.face([left, right, (x + math.cos(a) * 0.036, y + 0.014, z + math.sin(a) * 0.036)], 'pink_lt', want=(0, 1, 0))
    for k in range(4):
        a = (k + 0.5) / 4 * math.tau
        left = (x + math.cos(a + 1.1) * 0.009, y + 0.002, z + math.sin(a + 1.1) * 0.009)
        right = (x + math.cos(a - 1.1) * 0.009, y + 0.002, z + math.sin(a - 1.1) * 0.009)
        b.face([left, right, (x + math.cos(a) * 0.02, y + 0.028, z + math.sin(a) * 0.02)], 'white', want=(0, 1, 0))
    b.stone(x, z, y + 0.002, y + 0.02, 0.008, 0.0, 4, 'yellow', None, turn=0.3)


def lily_pads(pads, flowers=()):
    b = Builder()
    for x, z, r, turn, uv in pads:
        pad(b, x, z, r, turn, uv)
    for x, z in flowers:
        lily(b, x, z, PAD_THICK)
    return b


def lily_pads_a():
    return lily_pads([(-0.075, -0.055, 0.085, 0.5, 'pad'), (0.085, 0.015, 0.068, 2.4, 'field'), (-0.03, 0.105, 0.058, 4.3, 'pad')])


def lily_pads_b():
    return lily_pads([(-0.105, -0.085, 0.058, 1.0, 'field'), (0.02, -0.11, 0.05, 3.0, 'pad'), (0.12, -0.02, 0.062, 5.1, 'pad'),
                      (-0.05, 0.045, 0.07, 2.6, 'pad'), (0.075, 0.115, 0.052, 0.2, 'field')])


def lily_pads_c():
    return lily_pads([(-0.055, -0.045, 0.09, 1.7, 'pad'), (0.105, -0.06, 0.056, 3.6, 'field'), (0.04, 0.105, 0.066, 5.5, 'pad')],
                     flowers=[(-0.06, -0.04)])


# ---- reeds and cattails ----------------------------------------------------------------------------

def clump(count, spread, start=0.0):
    """Sunflower-seed positions: (x, z, outward angle, 0 at the centre .. 1 at the rim)."""
    out = []
    for i in range(count):
        t = math.sqrt((i + 0.5) / count)
        a = start + i * GOLDEN
        out.append((math.cos(a) * spread * t, math.sin(a) * spread * t, a, t))
    return out


def reeds(count, tall, short, plumes=0, start=0.0):
    """A clump of blades, tallest in the middle and leaning outwards; `plumes` adds flowering stems."""
    b = Builder()
    for i, (x, z, a, t) in enumerate(clump(count, 0.115, start)):
        height = tall - (tall - short) * t + (0.012 if i % 2 else -0.008)
        lean = 0.02 + 0.045 * t
        b.blade(x, z, height, 0.026, (math.cos(a) * lean, math.sin(a) * lean), 'pad' if i % 3 == 0 else 'reed', turn=a)
    for i, (x, z, a, t) in enumerate(clump(plumes, 0.07, start + 1.3)):
        height = tall - 0.03 * t + 0.035
        lean = 0.014 + 0.03 * t
        tx, tz = x + math.cos(a) * lean, z + math.sin(a) * lean
        stem_top = height - 0.085
        b.prism(x, z, 0, stem_top, 0.005, 3, 'reed', top_xz=(tx, tz), turn=a)
        # the plume: a long tan diamond carrying on along the stem
        ox, oz = math.cos(a) * 0.012, math.sin(a) * 0.012
        waist = [(tx + ox * 0.5 + math.cos(a + k * math.tau / 4) * 0.013, stem_top + 0.03, tz + oz * 0.5 + math.sin(a + k * math.tau / 4) * 0.013)
                 for k in range(4)]
        centre = (tx + ox * 0.5, stem_top + 0.03, tz + oz * 0.5)
        for k in range(4):
            b.face([waist[k], waist[(k + 1) % 4], (tx, stem_top - 0.004, tz)], 'tan_dk', away=centre)
            b.face([waist[k], waist[(k + 1) % 4], (tx + ox * 2, height, tz + oz * 2)], 'tan_md' if k % 2 else 'tan_dk', away=centre)
    return b


def reeds_a():
    return reeds(9, 0.30, 0.19)


def reeds_b():
    return reeds(8, 0.27, 0.18, plumes=4, start=0.9)


def cattails(stems, leaves, tall, start=0.0):
    """Stems with a brown seed head and a spike, in a skirt of blades."""
    b = Builder()
    for i, (x, z, a, t) in enumerate(clump(stems, 0.075, start)):
        height = tall - 0.07 * t - (0.02 if i % 2 else 0)
        lean = 0.006 + 0.02 * t
        tx, tz = x + math.cos(a) * lean, z + math.sin(a) * lean
        head0, head1 = height - 0.105, height - 0.035
        at = lambda y: (x + (tx - x) * y / height, z + (tz - z) * y / height)
        b.prism(x, z, 0, head0, 0.0045, 4, 'pad', top_xz=at(head0), turn=a)
        hx, hz = at(head0)
        b.prism(hx, hz, head0, head1, 0.016, 6, 'brown_dk', top='brown_md', bottom='brown_dk', top_xz=at(head1), turn=a)
        sx, sz = at(head1)
        b.stone(sx, sz, head1, height, 0.004, 0.0, 3, 'reed', None, turn=a)
    for i, (x, z, a, t) in enumerate(clump(leaves, 0.12, start + 0.7)):
        height = tall * 0.78 - 0.07 * t + (0.012 if i % 2 else 0)
        lean = 0.03 + 0.04 * t
        b.blade(x, z, height, 0.024, (math.cos(a) * lean, math.sin(a) * lean), 'reed' if i % 3 else 'pad', turn=a)
    return b


def cattails_a():
    return cattails(3, 5, 0.31)


def cattails_b():
    return cattails(5, 7, 0.34, start=2.1)


# ---- duck house ------------------------------------------------------------------------------------
RAFT = 0.19                           # the raft's half size
DECK_Y = 0.024
PLANKS = 6
HOUSE_X0, HOUSE_X1 = -0.135, 0.035    # the house stands at the back left of the raft
HOUSE_Z0, HOUSE_Z1 = -0.145, 0.005
BASE_Y, WALL_Y, PEAK_Y = 0.046, 0.124, 0.186
EAVE, GABLE_EAVE, ROOF_T = 0.022, 0.024, 0.013
DOOR_W, DOOR_SHOULDER, DOOR_TOP, DOOR_TOP_W = 0.031, 0.062, 0.088, 0.011


def bird_house():
    """A floating duck house: a low square plank raft, a squat pale house at its back left with a slate gable
    roof (ridge along x) and a dark chamfered-arch doorway towards +Z."""
    b = Builder()
    # raft: planks along x in two timbers, cut edge to edge; dark sides down to y = 0
    step = 2 * RAFT / PLANKS
    for k in range(PLANKS):
        z0 = -RAFT + k * step
        b.face([(-RAFT, DECK_Y, z0), (RAFT, DECK_Y, z0), (RAFT, DECK_Y, z0 + step), (-RAFT, DECK_Y, z0 + step)],
               'timber' if k % 2 == 0 else 'timber_lt', want=(0, 1, 0))
    b.box(-RAFT, 0.0, -RAFT, RAFT, DECK_Y, RAFT, 'timber_dk', skip=('+y', '-y'))
    # walls: a stone course under whitewash; the gables are on the x sides
    x0, x1, z0, z1 = HOUSE_X0, HOUSE_X1, HOUSE_Z0, HOUSE_Z1
    zc = (z0 + z1) / 2
    for y0, y1, uv in ((DECK_Y, BASE_Y, 'offwhite'), (BASE_Y, WALL_Y, 'white')):
        b.face([(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)], uv, want=(0, 0, -1))
        for x, s in ((x0, -1), (x1, 1)):
            b.face([(x, y0, z0), (x, y0, z1), (x, y1, z1), (x, y1, z0)], uv, want=(s, 0, 0))
    for x, s in ((x0, -1), (x1, 1)):
        b.face([(x, WALL_Y, z0), (x, WALL_Y, z1), (x, PEAK_Y, zc)], 'white', want=(s, 0, 0))
    # front: the doorway is cut through both courses
    dx = (x0 + x1) / 2
    d0, d1, ds, dt = dx - DOOR_W, dx + DOOR_W, DOOR_SHOULDER, DOOR_TOP
    door = [(d0, DECK_Y), (d1, DECK_Y), (d1, ds), (dx + DOOR_TOP_W, dt), (dx - DOOR_TOP_W, dt), (d0, ds)]
    b.face([(x, y, z1) for x, y in door], 'dark', want=(0, 0, 1))
    for xa, xb in ((x0, d0), (d1, x1)):
        b.face([(xa, DECK_Y, z1), (xb, DECK_Y, z1), (xb, BASE_Y, z1), (xa, BASE_Y, z1)], 'offwhite', want=(0, 0, 1))
    upper = [(x0, BASE_Y), (d0, BASE_Y), (d0, ds), (dx - DOOR_TOP_W, dt), (dx + DOOR_TOP_W, dt), (d1, ds), (d1, BASE_Y),
             (x1, BASE_Y), (x1, WALL_Y), (x0, WALL_Y)]
    for tri in tessellate_polygon([[Vector((x, y, 0)) for x, y in upper]]):
        b.face([(upper[i][0], upper[i][1], z1) for i in tri], 'white', want=(0, 0, 1))
    # roof: two slabs meeting at the ridge, overhanging the walls all round
    slope = (PEAK_Y - WALL_Y) / (z1 - zc)
    reach = z1 - zc + EAVE
    eave_y = WALL_Y - slope * EAVE
    rx0, rx1 = x0 - GABLE_EAVE, x1 + GABLE_EAVE
    for s in (-1, 1):
        lo = [(zc + s * reach, eave_y), (zc, PEAK_Y), (zc, PEAK_Y + ROOF_T), (zc + s * reach, eave_y + ROOF_T)]
        left, right = [(rx0, y, z) for z, y in lo], [(rx1, y, z) for z, y in lo]
        mid = ((rx0 + rx1) / 2, (eave_y + PEAK_Y + ROOF_T) / 2, zc + s * reach / 2)
        b.face([left[3], left[2], right[2], right[3]], 'slate', away=mid)          # top
        b.face([left[0], left[1], right[1], right[0]], 'slate_dk', away=mid)       # underside
        b.face([left[0], left[3], right[3], right[0]], 'slate_dk', away=mid)       # eave edge
        b.face(left, 'slate_dk', away=mid)
        b.face(right, 'slate_dk', away=mid)
    return b


# ---- duck ------------------------------------------------------------------------------------------

def section(z, w, y0, ym, y1, top=0.55, bottom=0.6):
    """A six-point cross-section at z: a flat keel, the widest point at ym, a flat back."""
    return [(-w * bottom, y0, z), (w * bottom, y0, z), (w, ym, z), (w * top, y1, z), (-w * top, y1, z), (-w, ym, z)]


def hull(z, w, y0, ym, yh, y1):
    """An eight-point body section at z: keel, the widest point at ym, shoulders at yh, a narrow back at y1."""
    return [(-w * 0.5, y0, z), (w * 0.5, y0, z), (w, ym, z), (w * 0.8, yh, z), (w * 0.36, y1, z),
            (-w * 0.36, y1, z), (-w * 0.8, yh, z), (-w, ym, z)]


def duck():
    """A mallard drake, bill towards +Z, sitting on y = 0 (the game sinks it by its draft). Light flanks and grey
    wings, so a brown instance tint turns it into a hen."""
    b = Builder()
    # sides of a hull band: keel, right low, right flank, right wing, back, left wing, left flank, left low
    sides = lambda wing: ['offwhite', 'offwhite', 'offwhite', wing, 'grey', wing, 'offwhite', 'offwhite']
    body = [
        hull(-0.068, 0.008, 0.031, 0.036, 0.040, 0.042),      # the tail's tip, turned up
        hull(-0.052, 0.022, 0.012, 0.026, 0.035, 0.040),
        hull(-0.030, 0.033, 0.002, 0.022, 0.036, 0.045),
        hull(-0.002, 0.037, 0.000, 0.022, 0.038, 0.048),
        hull(0.028, 0.033, 0.000, 0.023, 0.037, 0.046),
        hull(0.050, 0.020, 0.007, 0.025, 0.035, 0.041),
    ]
    b.loft(body, ['dark', sides('blue'), sides('grey_lt'), sides('grey_lt'), 'brown_md'], caps=('white', 'brown_md'))
    # folded wing tips over the rump
    for s in (-1, 1):
        low, high, under, tip = (s * 0.032, 0.034, -0.022), (s * 0.014, 0.047, -0.022), (s * 0.024, 0.029, -0.030), (s * 0.011, 0.045, -0.059)
        centre = (s * 0.02, 0.038, -0.035)
        for tri in ((low, high, tip), (low, under, tip), (under, high, tip)):
            b.face(tri, 'grey', away=centre)
    # white collar, green head, yellow bill
    ring = lambda z, y, r: [(math.cos(k * math.tau / 6) * r, y, z + math.sin(k * math.tau / 6) * r) for k in range(6)]
    b.loft([ring(0.034, 0.041, 0.014), ring(0.038, 0.059, 0.011)], ['white'])
    head = [
        section(0.021, 0.008, 0.064, 0.071, 0.079),
        section(0.028, 0.017, 0.058, 0.072, 0.087),
        section(0.040, 0.020, 0.056, 0.072, 0.091),
        section(0.052, 0.018, 0.057, 0.071, 0.088),
        section(0.061, 0.010, 0.060, 0.069, 0.079),
    ]
    b.loft(head, ['head'] * 4, caps=('head', 'head'))
    quad = lambda z, w, y0, y1: [(-w, y0, z), (w, y0, z), (w, y1, z), (-w, y1, z)]
    b.loft([quad(0.059, 0.008, 0.060, 0.069), quad(0.068, 0.010, 0.060, 0.065), quad(0.074, 0.008, 0.060, 0.063)],
           ['yellow', 'yellow'], caps=(None, 'yellow'))
    return b


MODELS = {
    'pond-edge-a': pond_edge_a,
    'pond-edge-b': pond_edge_b,
    'pond-edge-c': pond_edge_c,
    'pond-edge-d': pond_edge_d,
    'pond-outer-a': pond_outer_a,
    'pond-outer-b': pond_outer_b,
    'pond-outer-c': pond_outer_c,
    'pond-outer-d': pond_outer_d,
    'pond-inner': pond_inner,
    'lily-pads-a': lily_pads_a,
    'lily-pads-b': lily_pads_b,
    'lily-pads-c': lily_pads_c,
    'reeds-a': reeds_a,
    'reeds-b': reeds_b,
    'cattails-a': cattails_a,
    'cattails-b': cattails_b,
    'bird-house': bird_house,
    'duck': duck,
}
SHORE = [name for name in MODELS if name.startswith('pond-')]
MODELS.update({f'{name}-lawn': lawn(MODELS[name]) for name in SHORE})


def atlas_material():
    mat = bpy.data.materials.get('pond-colormap')
    if mat:
        return mat
    mat = bpy.data.materials.new('pond-colormap')
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
    """Fails if a swatch is not where this script samples it (the atlas changed, or a pond band is missing)."""
    image = bpy.data.images.load(ATLAS, check_existing=True)
    image.reload()
    w, h = image.size
    pixels = image.pixels[:]
    for name, (col, row, want) in SWATCHES.items():
        x, y = col * BLOCK_PX + 16, h - 1 - (row * BLOCK_PX + 16)
        got = ''.join(f'{round(c * 255):02x}' for c in pixels[(y * w + x) * 4:(y * w + x) * 4 + 3])
        if got != want:
            raise RuntimeError(f'colormap.png swatch {name} at cell block ({col}, {row}) is {got}, expected {want}')


def rewrite_glb(path, name):
    """Rewrites the exporter's GLB like the Kenney kit's: the atlas as an external image, no embedded copy, a
    metalness-0 double-sided material named colormap, one node named after the model."""
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
    rewrite_glb(path, obj.name)


def build_pond(export_glb=False, collection='Pond', origin=(0.0, -14.0, 0.0), pitch=0.7, only=None):
    """Builds every model into `collection`, in a row from `origin`; returns triangles and size per model."""
    check_swatches()
    mat = atlas_material()
    coll = bpy.data.collections.get(collection) or bpy.data.collections.new(collection)
    if coll.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(coll)
    for old in [o for o in coll.objects]:
        data = old.data
        bpy.data.objects.remove(old, do_unlink=True)
        if data and data.users == 0:
            bpy.data.meshes.remove(data)
    report = {}
    for i, (name, make) in enumerate(MODELS.items()):
        if only and name not in only:
            continue
        me = make().mesh(name, mat)
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        ob.location = (origin[0] + i * pitch, origin[1], origin[2])
        me.calc_loop_triangles()
        lo = [min(v.co[k] for v in me.vertices) for k in range(3)]
        hi = [max(v.co[k] for v in me.vertices) for k in range(3)]
        # reported in game axes: width (x), height (y), depth (z)
        report[name] = {'tris': len(me.loop_triangles),
                        'size': [round(hi[0] - lo[0], 4), round(hi[2] - lo[2], 4), round(hi[1] - lo[1], 4)],
                        'base': round(lo[2], 4)}
        if export_glb:
            os.makedirs(OUT_DIR, exist_ok=True)
            path = os.path.join(OUT_DIR, f'{name}.glb')
            export(ob, path)
            report[name]['bytes'] = os.path.getsize(path)
    return report


if __name__ == '__main__' and bpy.app.background:
    for model, info in build_pond(export_glb=True).items():
        print(model, info)
