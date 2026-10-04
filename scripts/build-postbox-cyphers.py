# Design-for-review builder: the seven royal cyphers as raised relief on copies of the game's postbox
# (public/assets/models/composed/postbox.glb), in a "Postbox cyphers" collection.
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-postbox-cyphers.py
#
# In an open Blender session, exec() this file (with __file__ set) and call build_all(). It adds the
# postboxes, the cypher meshes and name labels to the collection; nothing is exported.
#
# Outlines come from the owner's cypher map (CYPHER_MAP): the red field of each cypher is cut out of the
# image (red minus green, so the black labels and the white page drop out), thickened by a few pixels so
# the thin strokes survive, contoured with marching squares at sub-pixel accuracy and simplified with
# Douglas-Peucker. The filled shapes are triangulated with a constrained Delaunay triangulation that also
# honours the pillar's creases (below), and extruded into a flat-topped relief with no underside.
#
# The postbox's body is a 12-sided prism (r = 0.045, native units, y 0.012..0.13) whose front (-Z) is a
# vertex, so its front is a ridge with a flat facet 15 degrees either way. The relief follows those
# facets exactly: the cypher is laid on the unrolled surface (u = distance along the facets, positive to the
# viewer's right, v = height) and folded at the creases, so it sits on the pillar with no gap and the top
# stays a constant depth above it. Native units throughout; the catalog scales the postbox by 1.4.
import json
import math
import os
import struct

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, geometry

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..')) if '__file__' in globals() else os.getcwd()
POSTBOX = os.path.join(ROOT, 'public/assets/models/composed/postbox.glb')
CYPHER_MAP = '/Users/nazariitaran/Documents/code/_posters/Royal_Cyphers_1837-Present.png'
COLLECTION = 'Postbox cyphers'

# the postbox (native units)
GAME_SCALE = 1.4                      # catalog scale
BODY_R = 0.045                        # prism radius to its vertices
SIDES = 12
FACET = 2 * BODY_R * math.sin(math.pi / SIDES)       # facet width, 0.0233
CREASES = (-1, 0, 1)                  # facet edges the cypher can straddle, in facets from the front ridge
DEPTH = 0.0054                        # relief height above the surface: 0.0075 game units
EMBED = 0.0006                        # the wall's foot sinks this far into the body
Y_CENTRE = 0.041                      # between the plinth (0.012) and the yellow plate (0.07)
W_MAX, H_MAX = 0.050, 0.040           # cypher fits this box: 0.07 x 0.056 game units
K = 1000.0                            # the 2D work is done in thousandths of a native unit

# per cypher: crop box in the 1200 px map, thickening radius (px), simplification tolerance (px)
CYPHERS = [
    dict(name='victoria', label='Victoria VR 7%', crop=(480, 30, 720, 260), grow=2, eps=4.5, min_loop=0.01),
    dict(name='edward-vii', label='Edward VII 5%', crop=(840, 25, 1110, 280), grow=2, eps=6, min_loop=0.01),
    dict(name='george-v', label='George V GR 16%', crop=(70, 470, 350, 640), grow=0, eps=4, min_loop=0.004),
    dict(name='edward-viii', label='Edward VIII 2%', crop=(450, 465, 750, 650), grow=0, eps=6, min_loop=0.004),
    dict(name='george-vi', label='George VI 8%', crop=(830, 440, 1120, 670), grow=2, eps=6, min_loop=0.01),
    dict(name='elizabeth-ii', label='Elizabeth II E II R 60%', crop=(80, 870, 370, 1060), grow=0, eps=4, min_loop=0.004),
    dict(name='charles-iii', label='Charles III 2%', crop=(490, 810, 690, 1075), grow=1, eps=5, min_loop=0.004),
]

COLOURS = {                           # sRGB; the cyphers use 'light-red'; 'gold' is the postbox's own plate colour
    'gold': (240, 190, 70),
    'cream': (253, 228, 199),         # atlas cell (0, 1) fde4c7
    'light-red': (231, 96, 71),       # atlas cell (9, 1) e76047: the cypher colour
}


def srgb_to_linear(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


# ---- hand-drawn shapes -------------------------------------------------------------------------
# Edward VII's cypher is drawn, not traced: the source's E, VII and R are too tangled to survive at this
# size. Loops in a 100-unit grid, x right, y down (the same orientation as image pixels); a loop inside
# another is a hole. The relief fits the drawing's own box, so only its proportions matter.
DRAWN = {
    'edward-vii': [
        # E, bold, serifs on the top and bottom arms
        [(2, 0), (44, 0), (44, 20), (36, 20), (36, 12), (14, 12), (14, 28), (32, 28), (32, 40), (14, 40),
         (14, 56), (36, 56), (36, 48), (44, 48), (44, 68), (2, 68)],
        # R, bold, with a stem serif at the foot and a straight leg
        [(48, 0), (80, 0), (92, 4), (98, 14), (98, 26), (92, 36), (84, 41), (100, 68), (86, 68), (72, 45),
         (66, 45), (66, 60), (72, 60), (72, 68), (48, 68), (48, 60), (54, 60), (54, 8), (48, 8)],
        # the R's counter
        [(66, 12), (78, 12), (84, 16), (86, 22), (84, 28), (78, 32), (66, 32)],
        # the small VII beneath: a V and two slab-serif I's
        [(24, 80), (32, 80), (35, 94), (38, 80), (46, 80), (40, 105), (30, 105)],
        [(52, 80), (64, 80), (64, 84), (61.5, 84), (61.5, 101), (64, 101), (64, 105), (52, 105), (52, 101),
         (54.5, 101), (54.5, 84), (52, 84)],
        [(67, 80), (79, 80), (79, 84), (76.5, 84), (76.5, 101), (79, 101), (79, 105), (67, 105), (67, 101),
         (69.5, 101), (69.5, 84), (67, 84)],
    ],
}


# ---- tracing -----------------------------------------------------------------------------------

def load_map():
    img = bpy.data.images.get('royal-cyphers-map')
    if img is None:
        img = bpy.data.images.load(CYPHER_MAP)
        img.name = 'royal-cyphers-map'
    img.colorspace_settings.name = 'Non-Color'
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1]    # top row first
    return px


def red_field(px, crop):
    x0, y0, x1, y1 = crop
    c = px[y0:y1, x0:x1]
    return np.clip((c[..., 0] - c[..., 1]) / 0.64, 0.0, 1.0)


def grow(mask, r):
    if r <= 0:
        return mask
    out = mask.copy()
    h, w = mask.shape
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy > r * r + 0.5:
                continue
            ys, yd = (slice(dy, h), slice(0, h - dy)) if dy >= 0 else (slice(0, h + dy), slice(-dy, h))
            xs, xd = (slice(dx, w), slice(0, w - dx)) if dx >= 0 else (slice(0, w + dx), slice(-dx, w))
            out[yd, xd] |= mask[ys, xs]
    return out


def smooth(f):
    k = np.array([1, 2, 1], dtype=np.float32) / 4
    for axis in (0, 1):
        f = np.apply_along_axis(lambda a: np.convolve(a, k, mode='same'), axis, f)
    return f


def marching(f, level=0.5):
    """Closed contour loops [(x, y)...] of f at level, with sub-pixel crossings. f is padded by the caller."""
    h, w = f.shape
    cross = {}

    def point(edge):
        p = cross.get(edge)
        if p is None:
            kind, i, j = edge
            if kind == 'h':      # between (i, j) and (i, j + 1)
                a, b = f[i, j], f[i, j + 1]
                t = (level - a) / (b - a)
                p = (j + t, float(i))
            else:                # between (i, j) and (i + 1, j)
                a, b = f[i, j], f[i + 1, j]
                t = (level - a) / (b - a)
                p = (float(j), i + t)
            cross[edge] = p
        return p

    nxt = {}

    def link(a, b):
        nxt.setdefault(a, []).append(b)
        nxt.setdefault(b, []).append(a)

    inside = f > level
    for i in range(h - 1):
        for j in range(w - 1):
            tl, tr, br, bl = inside[i, j], inside[i, j + 1], inside[i + 1, j + 1], inside[i + 1, j]
            case = int(tl) | int(tr) << 1 | int(br) << 2 | int(bl) << 3
            if case in (0, 15):
                continue
            top, right, bottom, left = ('h', i, j), ('v', i, j + 1), ('h', i + 1, j), ('v', i, j)
            if case == 5 or case == 10:
                centre = (f[i, j] + f[i, j + 1] + f[i + 1, j + 1] + f[i + 1, j]) / 4 > level
                joined = (case == 5) == centre
                pairs = [(top, right), (left, bottom)] if joined else [(left, top), (right, bottom)]
                if case == 10:
                    pairs = [(left, top), (right, bottom)] if centre else [(top, right), (left, bottom)]
            else:
                pairs = [{1: (left, top), 2: (top, right), 3: (left, right), 4: (right, bottom), 6: (top, bottom),
                          7: (left, bottom), 8: (left, bottom), 9: (top, bottom), 11: (right, bottom),
                          12: (left, right), 13: (top, right), 14: (left, top)}[case]]
            for a, b in pairs:
                link(a, b)
    loops, seen = [], set()
    for start in sorted(nxt):
        if start in seen:
            continue
        loop, prev, cur = [], None, start
        while cur not in seen:
            seen.add(cur)
            loop.append(point(cur))
            options = [n for n in nxt[cur] if n != prev]
            if not options:
                break
            prev, cur = cur, (options[0] if options[0] not in seen or len(options) == 1 else options[1])
        if len(loop) > 2:
            loops.append(loop)
    return loops


def area(loop):
    return 0.5 * sum(loop[i][0] * loop[(i + 1) % len(loop)][1] - loop[(i + 1) % len(loop)][0] * loop[i][1] for i in range(len(loop)))


def douglas_peucker(pts, eps):
    if len(pts) < 3:
        return list(pts)
    a, b = pts[0], pts[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    best, split = -1.0, 0
    for i in range(1, len(pts) - 1):
        p = pts[i]
        d = abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / length if length > 1e-9 else math.hypot(p[0] - a[0], p[1] - a[1])
        if d > best:
            best, split = d, i
    if best > eps:
        return douglas_peucker(pts[:split + 1], eps)[:-1] + douglas_peucker(pts[split:], eps)
    return [a, b]


def simplify_loop(loop, eps):
    far = max(range(len(loop)), key=lambda i: math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]))
    a = douglas_peucker(loop[:far + 1], eps)
    b = douglas_peucker(loop[far:] + [loop[0]], eps)
    return a[:-1] + b[:-1]


def trace(px, spec):
    """The cypher's outline loops in image pixels (y down), simplified; a drawn cypher returns its drawing."""
    if spec['name'] in DRAWN:
        return [list(loop) for loop in DRAWN[spec['name']]]
    f = red_field(px, spec['crop'])
    mask = grow(f > 0.5, spec['grow'])
    f = smooth(smooth(mask.astype(np.float32)))
    f = np.pad(f, 3)
    loops = marching(f)
    out = []
    for loop in loops:
        loop = [(x - 3, y - 3) for x, y in loop]
        s = simplify_loop(loop, spec['eps'])
        if len(s) >= 3:
            out.append(s)
    # specks and pin-holes that would not show at the cypher's size go: a loop smaller than a fraction of the
    # cypher's own box is dropped (a hole fills, an island vanishes)
    xs = [p[0] for l in out for p in l]
    ys = [p[1] for l in out for p in l]
    least = spec.get('min_loop', 0.004) * (max(xs) - min(xs)) * (max(ys) - min(ys))
    return [l for l in out if abs(area(l)) >= least]


# ---- the relief --------------------------------------------------------------------------------

def inside(p, loops):
    """Even-odd point-in-polygon over all loops (outlines and their holes)."""
    hit = False
    for loop in loops:
        j = len(loop) - 1
        for i in range(len(loop)):
            (xi, yi), (xj, yj) = loop[i], loop[j]
            if (yi > p.y) != (yj > p.y) and p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi:
                hit = not hit
            j = i
    return hit


def surface_point(u, v, radius):
    """Point of the 12-gon of the given vertex radius at unrolled distance u (to the viewer's right) and height v.
    The front ridge is at u = 0; native x grows to the viewer's left."""
    k = int(math.floor(u / FACET + 1e-9))
    t = u / FACET - k
    ang = [math.radians(30 * n) for n in (k, k + 1)]
    pts = [(-radius * math.sin(a), -radius * math.cos(a)) for a in ang]
    x = pts[0][0] + (pts[1][0] - pts[0][0]) * t
    z = pts[0][1] + (pts[1][1] - pts[0][1]) * t
    return Vector((x, v, z))


def relief(loops_px, name):
    """Mesh data for a cypher: loops in px -> filled, creased, extruded relief in native units (glTF axes)."""
    xs = [p[0] for l in loops_px for p in l]
    ys = [p[1] for l in loops_px for p in l]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    wpx, hpx = max(xs) - min(xs), max(ys) - min(ys)
    s = min(W_MAX / wpx, H_MAX / hpx) * K                  # px -> thousandths of a unit
    loops = [[((x - cx) * s, (cy - y) * s) for x, y in l] for l in loops_px]
    loops = [l if area(l) > 0 else l[::-1] for l in loops]       # the triangulator wants counter-clockwise faces
    verts = [Vector(p) for l in loops for p in l]
    faces, n = [], 0
    for l in loops:
        faces.append(list(range(n, n + len(l))))
        n += len(l)
    edges = []
    for c in CREASES:
        a = len(verts)
        verts += [Vector((c * FACET * K, -100.0)), Vector((c * FACET * K, 100.0))]
        edges.append((a, a + 1))
    out_v, _, out_f, _, _, orig_f = geometry.delaunay_2d_cdt(verts, edges, faces, 0, 1e-5)
    tris = []
    for face in out_f:
        a, b, c = (out_v[i] for i in face)
        if inside((a + b + c) / 3, loops):
            a, b, c = (out_v[i] for i in face)
            if (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y) < 0:
                face = [face[0], face[2], face[1]]
            tris.append(tuple(face))
    edge_count = {}
    for t in tris:
        for i in range(3):
            e = (t[i], t[(i + 1) % 3])
            edge_count[e] = edge_count.get(e, 0) + 1
    boundary = [e for e in edge_count if (e[1], e[0]) not in edge_count]

    r_top = BODY_R + DEPTH / math.cos(math.pi / SIDES)
    r_foot = BODY_R - EMBED / math.cos(math.pi / SIDES)

    def at(i, radius):
        p = out_v[i]
        return surface_point(p.x / K, Y_CENTRE + p.y / K, radius)

    bm = bmesh.new()

    def add(pts, outward):
        f = bm.faces.new([bm.verts.new(p) for p in pts])
        f.normal_update()
        if f.normal.dot(outward) < 0:
            f.normal_flip()
        return f

    for t in tris:
        pts = [at(i, r_top) for i in t]
        c = sum(pts, Vector()) / 3
        add(pts, Vector((c.x, 0, c.z)))
    for a, b in boundary:
        mid = (out_v[a] + out_v[b]) / 2
        d = out_v[b] - out_v[a]
        right = Vector((d.y, -d.x)).normalized() * 0.4
        p0 = surface_point(mid.x / K, Y_CENTRE + mid.y / K, BODY_R)
        p1 = surface_point((mid.x + right.x) / K, Y_CENTRE + (mid.y + right.y) / K, BODY_R)
        add([at(a, r_foot), at(b, r_foot), at(b, r_top), at(a, r_top)], p1 - p0)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    # glTF axes (x, y up, z) -> Blender (x, -z, y), the frame of the imported postbox
    bmesh.ops.transform(bm, matrix=Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1))), verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = False
    return me, {'tris': sum(len(p.vertices) - 2 for p in me.polygons), 'size': (wpx * s / K, hpx * s / K),
                'loops': len(loops), 'trace_verts': len(verts) - 2 * len(CREASES)}


def unroll(x, y, z):
    """(u, v) in thousandths of a unit of a point of a cypher mesh (postbox-local Blender coordinates)."""
    nx, nz = x, -y                                    # back to glTF x, z
    phi = math.atan2(-nx, -nz)
    k = math.floor(phi / math.radians(30))
    psi = math.radians(30 * k + 15)
    a0 = BODY_R * math.cos(math.pi / SIDES)
    return ((k + 0.5) * FACET + a0 * math.tan(phi - psi)) * K, (z - Y_CENTRE) * K


def check(me):
    """Orientation and seating of a cypher mesh: top faces point away from the pillar's axis, walls away from the
    relief, the foot is inside the body and the top clear of it."""
    from mathutils import Vector as V
    tops, walls, flipped, bad_wall = [], [], 0, 0
    for p in me.polygons:
        radial = V((p.center.x, p.center.y, 0)).normalized()
        d = p.normal.dot(radial)
        if abs(p.normal.z) < 0.05 and d > 0.95:
            tops.append([unroll(*me.vertices[i].co) for i in p.vertices])
        elif d < -0.5:
            flipped += 1                      # a top face turned inwards
        else:
            walls.append(p)
    for p in walls:
        uv = unroll(*(V(p.center) + p.normal * 2e-4))
        if any(inside(V(uv), [t]) for t in tops):
            bad_wall += 1                     # a wall facing into the relief
    heights = [math.hypot(v.co.x, v.co.y) for v in me.vertices]
    return {'tops_flipped': flipped, 'tops': len(tops), 'walls': len(walls), 'walls_into_relief': bad_wall, 'radius_min': round(min(heights), 4),
            'radius_max': round(max(heights), 4),
            'z_range': (round(min(v.co.z for v in me.vertices), 4), round(max(v.co.z for v in me.vertices), 4))}


# ---- the scene ---------------------------------------------------------------------------------

def material(name, rgb):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*[srgb_to_linear(c) for c in rgb], 1.0)
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 0.8
    mat.diffuse_color = (*[srgb_to_linear(c) for c in rgb], 1.0)
    return mat


def template(coll):
    """The postbox GLB imported once, hidden; every review postbox is a copy of it."""
    root = bpy.data.objects.get('postbox-template')
    if root:
        return root
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=POSTBOX)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)
        o.hide_viewport = True
        o.hide_render = True
        o['postbox_template'] = True
    root = next(o for o in new if o.parent is None)
    root.name = 'postbox-template'
    return root


def clone_postbox(root, coll, name, location):
    """A copy of the template tree under a new root: scaled to game size, front turned to -Y (toward the
    default view; rotationOffset 2 in the catalog)."""
    top = bpy.data.objects.new(name, None)
    coll.objects.link(top)
    top.scale = (GAME_SCALE,) * 3
    top.location = location
    top.rotation_euler = (0, 0, math.pi)
    top['cypher_review'] = True
    stack = [(root, top)]
    while stack:
        src, parent = stack.pop()
        for child in src.children:
            copy = bpy.data.objects.new(f'{name}.{child.name}', child.data)
            copy.parent = parent
            copy.matrix_parent_inverse = child.matrix_parent_inverse.copy()
            copy.location, copy.rotation_euler, copy.scale = child.location, child.rotation_euler, child.scale
            copy.rotation_mode = child.rotation_mode
            coll.objects.link(copy)
            copy['cypher_review'] = True
            stack.append((child, copy))
    return top


def label(coll, text, location, size=0.045):
    cu = bpy.data.curves.new(f'label {text}', 'FONT')
    cu.body = text
    cu.size = size
    cu.align_x = 'CENTER'
    ob = bpy.data.objects.new(f'label {text}', cu)
    coll.objects.link(ob)
    ob.location = location
    ob.rotation_euler = (math.pi / 2, 0, 0)
    ob['cypher_review'] = True
    return ob


def clear(coll):
    for ob in [o for o in coll.objects if o.get('cypher_review')]:
        data = ob.data
        bpy.data.objects.remove(ob, do_unlink=True)
        if data is not None and data.users == 0:
            if isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.TextCurve):
                bpy.data.curves.remove(data)


def build_all(origin=(0.0, -40.0, 0.0), spacing=0.42, colour='light-red', extra_colours=False):
    coll = bpy.data.collections.get(COLLECTION) or bpy.data.collections.new(COLLECTION)
    if coll.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(coll)
    clear(coll)
    root = template(coll)
    px = load_map()
    report = {}
    slots = [(spec, colour) for spec in CYPHERS]
    if extra_colours:
        e2r = next(s for s in CYPHERS if s['name'] == 'elizabeth-ii')
        slots += [(e2r, c) for c in COLOURS if c != colour]
    x0 = origin[0] - spacing * (len(slots) - 1) / 2
    for i, (spec, col) in enumerate(slots):
        loc = (x0 + i * spacing, origin[1], origin[2])
        main = i < len(CYPHERS)
        name = f"postbox-{spec['name']}" + ('' if main else f'-{col}')
        top = clone_postbox(root, coll, name, loc)
        me, info = relief(trace(px, spec), f'cypher-{spec["name"]}' + ('' if main else f'-{col}'))
        ob = bpy.data.objects.new(me.name, me)
        coll.objects.link(ob)
        ob.parent = top
        ob['cypher_review'] = True
        me.materials.append(material(f'cypher-{col}', COLOURS[col]))
        label(coll, spec['label'] if main else f'E II R, {col}', (loc[0], loc[1] - 0.16, 0.0))
        report[name] = {'tris': info['tris'], 'size_native': tuple(round(v, 4) for v in info['size']),
                        'size_game': tuple(round(v * GAME_SCALE, 4) for v in info['size']), 'loops': info['loops'],
                        'trace_verts': info['trace_verts']}
    build_scale_check()
    return report


# ---- scale check and renders -------------------------------------------------------------------

KIT = os.path.join(ROOT, 'public/assets/models')


def import_kit(coll, rel, name, location, scale, rotation_z):
    """A kit GLB under a tagged empty, placed like the game does (front towards -Y at rotation 0)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(KIT, rel))
    new = [o for o in bpy.data.objects if o not in before]
    top = bpy.data.objects.new(name, None)
    coll.objects.link(top)
    top.location, top.scale, top.rotation_euler = location, (scale,) * 3, (0, 0, rotation_z)
    top['cypher_review'] = True
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)
        o['cypher_review'] = True
        o.name = f'{name}.{o.name}'
        if o.parent is None:
            o.parent = top
    return top


def ground(coll, name, centre, size, rgb=(97, 203, 139)):
    me = bpy.data.meshes.new(name)
    x, y = size[0] / 2, size[1] / 2
    me.from_pydata([(-x, -y, 0), (x, -y, 0), (x, y, 0), (-x, y, 0)], [], [(0, 1, 2, 3)])
    me.materials.append(material(f'ground-{name}', rgb))
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    ob.location = (centre[0], centre[1], -0.0005)
    ob['cypher_review'] = True
    return ob


def build_scale_check(origin=(0.0, -36.0, 0.0)):
    """Three postboxes (E II R, GR, VR) beside a cottage and a sedan at game scale, for judging on-screen size."""
    coll = bpy.data.collections[COLLECTION]
    root = bpy.data.objects['postbox-template']
    ox, oy, oz = origin
    ground(coll, 'ground-scale', (ox, oy), (9.0, 5.0))
    import_kit(coll, 'suburban/building-type-a.glb', 'scale-cottage', (ox - 0.4, oy + 1.0, oz), 4 / 3, math.pi)
    import_kit(coll, 'cars/sedan.glb', 'scale-sedan', (ox + 1.9, oy - 0.2, oz), 0.17, -math.pi / 2)
    px = load_map()
    for i, name in enumerate(('elizabeth-ii', 'george-v', 'victoria')):
        spec = next(c for c in CYPHERS if c['name'] == name)
        top = clone_postbox(root, coll, f'scale-postbox-{name}', (ox - 0.55 + 0.3 * i, oy - 0.7, oz))
        me, _ = relief(trace(px, spec), f'scale-cypher-{name}')
        me.materials.append(material('cypher-light-red', COLOURS['light-red']))
        ob = bpy.data.objects.new(me.name, me)
        coll.objects.link(ob)
        ob.parent = top
        ob['cypher_review'] = True


def aim(cam, target, yaw, elevation, dist):
    t = Vector(target)
    y, e = math.radians(yaw), math.radians(elevation)
    cam.location = t + Vector((-math.sin(y) * math.cos(e), -math.cos(y) * math.cos(e), math.sin(e))) * dist
    cam.rotation_euler = (t - cam.location).to_track_quat('-Z', 'Y').to_euler()


def render_all(out_dir, origin=(0.0, -40.0, 0.0), scale_origin=(0.0, -36.0, 0.0)):
    """Writes the review renders (Workbench, the game's 35 degree camera) to out_dir and restores the scene."""
    os.makedirs(out_dir, exist_ok=True)
    scene = bpy.context.scene
    saved = dict(engine=scene.render.engine, rx=scene.render.resolution_x, ry=scene.render.resolution_y,
                 pct=scene.render.resolution_percentage, path=scene.render.filepath, camera=scene.camera,
                 light=scene.display.shading.light, colour=scene.display.shading.color_type,
                 aa=scene.display.render_aa, outline=scene.display.shading.show_object_outline,
                 bg=scene.display.shading.background_type)
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_percentage = 100
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.display.shading.show_object_outline = False
    scene.display.render_aa = '16'
    scene.display.shading.background_type = 'VIEWPORT'
    scene.display.shading.background_color = (0.62, 0.78, 0.95)
    cam_data = bpy.data.cameras.new('cypher-review-camera')
    cam_data.sensor_fit = 'VERTICAL'
    cam_data.angle = math.radians(35)
    cam_data.clip_start, cam_data.clip_end = 0.01, 500
    cam = bpy.data.objects.new('cypher-review-camera', cam_data)
    bpy.context.scene.collection.objects.link(cam)
    scene.camera = cam
    coll = bpy.data.collections[COLLECTION]
    coll_ground = ground(coll, 'ground-row', (origin[0], origin[1]), (9.0, 3.0))
    written = []
    layers = {lc.name: lc.exclude for lc in bpy.context.view_layer.layer_collection.children}
    for lc in bpy.context.view_layer.layer_collection.children:
        lc.exclude = lc.name != COLLECTION
    row_prefix, scale_prefix = ('postbox-', 'cypher-', 'label', 'ground-row'), ('scale-', 'ground-scale')

    def show(prefixes):
        for ob in coll.objects:
            if ob.get('cypher_review'):
                ob.hide_render = not ob.name.startswith(prefixes)

    def shot(name, target, yaw, elevation, dist, size):
        scene.render.resolution_x, scene.render.resolution_y = size
        aim(cam, target, yaw, elevation, dist)
        path = os.path.join(out_dir, name)
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        written.append(path)

    ox, oy, oz = origin
    row = (ox, oy, 0.12)
    show(row_prefix)
    shot('overview-game-camera.png', row, 45, 38, 3.0, (2400, 1000))
    shot('overview-front.png', (ox, oy, 0.1), 0, 15, 2.2, (2400, 640))
    for spec in CYPHERS:
        box = bpy.data.objects[f"postbox-{spec['name']}"]
        centre = (box.location.x, box.location.y - 0.045 * GAME_SCALE, Y_CENTRE * GAME_SCALE)
        shot(f"closeup-{spec['name']}.png", centre, 28, 22, 0.34, (900, 900))
    sx, sy, sz = scale_origin
    show(scale_prefix)
    shot('scale-cottage-sedan-closest-zoom.png', (sx + 0.1, sy - 0.2, 0.15), 45, 38, 6.0, (1920, 1080))
    shot('scale-cottage-sedan-zoomed.png', (sx - 0.1, sy - 0.5, 0.1), 45, 38, 2.4, (1920, 1080))
    # 25 px per unit (a cell is 12.5 px), the game's default framing on a 1080 px screen, at its own pixel size
    shot('scale-default-zoom-actual-size.png', (sx + 0.1, sy - 0.2, 0.15), 45, 38, 17.1, (480, 270))
    for ob in coll.objects:
        ob.hide_render = False
    for lc in bpy.context.view_layer.layer_collection.children:
        lc.exclude = layers.get(lc.name, lc.exclude)
    bpy.data.objects.remove(coll_ground, do_unlink=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.cameras.remove(cam_data)
    scene.camera = saved['camera']
    scene.render.engine = saved['engine']
    scene.render.resolution_x, scene.render.resolution_y = saved['rx'], saved['ry']
    scene.render.resolution_percentage = saved['pct']
    scene.render.filepath = saved['path']
    scene.display.shading.light = saved['light']
    scene.display.shading.color_type = saved['colour']
    scene.display.render_aa = saved['aa']
    scene.display.shading.show_object_outline = saved['outline']
    scene.display.shading.background_type = saved['bg']
    return written


if __name__ == '__main__' and bpy.app.background:
    for k, v in build_all().items():
        print(k, v)
    print(render_all(os.path.join(ROOT, 'artifacts/postbox-cyphers')))
