"""Xedine, the chef logo as a floating 3D character (ADR 0064).

The logo (public/brand/logo-chef-512.png): a charcoal dome body, a chef hat with a yellow band, two quote-mark
eyes ("66"), and a silver cloche with a fork and spoon on its front. In 3D it floats and glides, with two small
floating gloved hands (no arms, no legs). Every moving part hangs on a bone, so the page can drive it live:

    root > float > body > hat                     hover, squash, hat wobble
                   body > eyelook_L/R > eye_L/R   look (rotate around the dome's centre), blink (scale eye Y)
           float > hand_L/R > index, thumb        point (the index pokes out of the mitten), wave, hold

Character sides: L = the character's left = +X (the viewer's right). It faces -Y.

    blender -b --factory-startup -P scripts/landing-3d/xedine.py -- [--render] [--export]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

import common as C  # noqa: E402

FLOAT = 0.28  # height of the body's bottom above the floor at rest
R = 0.5  # dome radius
CZ = 0.45  # dome centre, body space (body bottom = 0)
FLARE = 0.555  # radius at the bottom rim (a soft bell)
EYE_H = 0.2  # eye height
EYE_X = 0.085  # eye centres left/right of the middle
EYE_Z = 0.715  # eye centre height, body space
WRIST = Vector((0.67, -0.14, FLOAT + 0.37))  # left wrist at rest (mirrored for the right)
REST_FINGERS = Vector((0.42, -0.3, -0.86)).normalized()


# ---------------------------------------------------------------- materials

def materials():
    return {
        'body': C.principled('MAT_Vinyl_Charcoal', '#17181B', roughness=0.42, coat=0.45, coat_rough=0.22,
                             specular=0.45),
        'hat': C.principled('MAT_Fabric_Hat_Charcoal', '#151619', roughness=0.85, sheen=0.8, sheen_rough=0.3,
                            sheen_tint='#8E9097'),
        'band': C.principled('MAT_Fabric_Ribbon_Yellow', C.YELLOW, roughness=0.55, sheen=0.4, sheen_rough=0.4),
        'eye': C.principled('MAT_Emissive_Eye_White', '#F7F7F5', roughness=0.25, coat=0.6, coat_rough=0.05,
                            emission='#FFFFFF', emission_strength=0.6),
        'silver': C.principled('MAT_Metal_Silver', C.SILVER, roughness=0.2, metallic=1.0),
        'white': C.principled('MAT_Enamel_White', '#F3F3F1', roughness=0.3, coat=0.4, coat_rough=0.1),
        'glove': C.principled('MAT_Rubber_Glove_Silver', '#E4E5E8', roughness=0.42, coat=0.3, coat_rough=0.25,
                              sheen=0.3),
    }


# ---------------------------------------------------------------- shapes

def body_profile():
    pts = [(R * math.cos(math.radians(90 - i * 90 / 40)), CZ + R * math.sin(math.radians(90 - i * 90 / 40)))
           for i in range(41)]
    bottom_side = 0.08
    for i in range(1, 19):  # the sides widen softly toward the bottom
        t = i / 18
        pts.append((R + (FLARE - R) * t * t, CZ - (CZ - bottom_side) * t))
    rc = 0.07  # rounded bottom rim
    for i in range(1, 10):
        a = math.radians(-90 * i / 9)
        pts.append((FLARE - rc + rc * math.cos(a), bottom_side + rc * math.sin(a)))
    rim_r, rim_z = FLARE - rc, bottom_side - rc
    for i in range(1, 9):  # a slightly hollow underside, like a bell
        t = i / 8
        pts.append((rim_r * (1 - t), rim_z + 0.03 * t * t))
    return pts


def bvh_of(obj):
    me = obj.data
    mw = obj.matrix_world
    return BVHTree.FromPolygons([mw @ v.co for v in me.vertices], [p.vertices for p in me.polygons])


def surface_point(bvh, x, z):
    """Where a ray from the front (-Y) at (x, z) meets the body: point and normal (world space)."""
    hit, normal, _, _ = bvh.ray_cast(Vector((x, -5.0, z)), Vector((0, 1, 0)))
    return hit, normal


def conform(obj, bvh, protrude):
    """Bend a front-facing flat mesh onto the body: each vertex keeps its depth relative to the surface."""
    me = obj.data
    mw, inv = obj.matrix_world, obj.matrix_world.inverted()
    ys = [(mw @ v.co).y for v in me.vertices]
    front = min(ys)
    for v in me.vertices:
        w = mw @ v.co
        hit, _ = surface_point(bvh, w.x, w.z)
        if hit is None:
            continue
        w.y = hit.y + (w.y - front) - protrude
        v.co = inv @ w


def curve_to_object(name, cu, col, material):
    tmp = bpy.data.objects.new(name + '_tmp', cu)
    col.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(cu)
    me.name = name
    me.shade_smooth()
    obj = bpy.data.objects.new(name, me)
    col.objects.link(obj)
    me.materials.append(material)
    return obj


def quote_outline():
    """The logo's eye: a quote mark shaped like a '6' (a rounded body, its tail rising and curling right).
    Returns (points, sharp) in eye units, body bottom-left at the origin."""
    W, H, rc = 0.74, 0.66, 0.17
    pts, sharp = [], set()

    def arc(cx, cy, a0, a1, n=4):
        for i in range(n + 1):
            a = math.radians(a0 + (a1 - a0) * i / n)
            pts.append((cx + rc * math.cos(a), cy + rc * math.sin(a)))

    arc(rc, rc, 180, 270)
    arc(W - rc, rc, 270, 360)
    arc(W - rc, H - rc, 0, 90)
    pts += [(0.40, H), (0.33, H + 0.07), (0.32, H + 0.17), (0.38, H + 0.27), (0.50, H + 0.35)]
    pts.append((0.66, H + 0.39))  # the tail's tip
    sharp.add(len(pts) - 1)
    pts += [(0.55, H + 0.47), (0.36, H + 0.45), (0.17, H + 0.36), (0.05, H + 0.2), (0.0, H + 0.02)]
    pts.append((0.0, H * 0.55))
    return pts, sharp


def eye_object(name, center, col, mat, bvh):
    pts, sharp = quote_outline()
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    s = EYE_H / (max(ys) - min(ys))
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '2D'
    cu.fill_mode = 'BOTH'
    cu.resolution_u = 10
    cu.extrude = 0.004
    cu.bevel_depth = 0.0045
    cu.bevel_resolution = 3
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(pts) - 1)
    for i, (x, y) in enumerate(pts):
        bp = sp.bezier_points[i]
        bp.co = ((x - cx) * s, (y - cy) * s, 0)
        bp.handle_left_type = bp.handle_right_type = 'VECTOR' if i in sharp else 'AUTO'
    sp.use_cyclic_u = True
    obj = curve_to_object(name, cu, col, mat)
    # Stand it up facing the viewer (-Y) at its place on the dome, then bend it onto the surface.
    obj.data.transform(Matrix.Rotation(math.radians(90), 4, 'X'))
    obj.location = (center[0], -1.0, center[2])
    bpy.context.view_layer.update()
    conform(obj, bvh, protrude=0.0075)
    return obj


def tube(name, points, radius, col, mat, taper=None):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = radius
    cu.bevel_resolution = 4
    cu.use_fill_caps = True
    cu.resolution_u = 8
    sp = cu.splines.new('NURBS')
    sp.points.add(len(points) - 1)
    for i, p in enumerate(points):
        sp.points[i].co = (*p, 1)
        if taper:
            sp.points[i].radius = taper[i]
    sp.use_endpoint_u = True
    sp.order_u = 3
    return curve_to_object(name, cu, col, mat)


def on_surface(bvh, x, z, lift):
    hit, n = surface_point(bvh, x, z)
    return tuple(hit + n * lift)


def build_body(col, mats):
    body = C.mesh_object('SM_Xedine_Body', C.lathe(body_profile(), steps=128), col, mats['body'])
    body.location = (0, 0, FLOAT)
    bpy.context.view_layer.update()
    return body


def build_hat(col, mats):
    base = FLOAT + 0.895
    band_h, ribbon_h = 0.19, 0.05
    # The band: a short cone flaring upward, with soft vertical pleats.
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=96, radius1=0.18, radius2=0.196,
                          depth=band_h)
    for v in bm.verts:
        a = math.atan2(v.co.y, v.co.x)
        r = Vector((v.co.x, v.co.y)).length
        if r > 0.05:
            k = 1 + 0.018 * math.sin(20 * a)
            v.co.x, v.co.y = v.co.x * k, v.co.y * k
        v.co.z += base + band_h / 2
    band = C.mesh_object('SM_Xedine_Hat_Band', bm, col, mats['hat'])
    # The yellow ribbon at the top of the band.
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=96, radius1=0.197, radius2=0.2, depth=ribbon_h)
    bmesh.ops.solidify(bm, geom=bm.faces, thickness=0.006)
    for v in bm.verts:
        v.co.z += base + band_h - ribbon_h / 2 - 0.004
    ribbon = C.mesh_object('SM_Xedine_Hat_Ribbon', bm, col, mats['band'])
    # The puff: a ring of soft lobes around a tall middle, melted together.
    mb = bpy.data.metaballs.new('MB_Puff')
    mb.resolution = mb.render_resolution = 0.012
    mb.threshold = 0.5
    top = base + band_h
    el = mb.elements.new()
    el.co, el.radius = (0, 0, top + 0.08), 0.25
    el = mb.elements.new()
    el.co, el.radius = (0, 0, top + 0.14), 0.16
    for i in range(5):
        a = math.tau * i / 5 - math.pi / 2
        el = mb.elements.new()
        el.co = (0.19 * math.cos(a), 0.19 * math.sin(a), top + 0.06)
        el.radius = 0.18
    tmp = bpy.data.objects.new('MB_Puff', mb)
    col.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    bpy.data.metaballs.remove(mb)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    # Squash it a little, tuck its bottom into the band, and crease it with soft radial pleats.
    for v in bm.verts:
        v.co.z = top + (v.co.z - top) * 0.9
        if v.co.z < top + 0.01:
            v.co.z = top + 0.01 + (v.co.z - top - 0.01) * 0.3
        a = math.atan2(v.co.y, v.co.x)
        h = max(0.0, min(1.0, (v.co.z - top) / 0.24))
        k = 1 + 0.012 * math.sin(14 * a) * (1 - h)
        v.co.x, v.co.y = v.co.x * k, v.co.y * k
    for _ in range(6):
        bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    puff = C.mesh_object('SM_Xedine_Hat_Puff', bm, col, mats['hat'])
    return [band, ribbon, puff]


def build_badge(col, mats, bvh):
    """The logo's silver cloche on the lower front, with the fork and spoon under it."""
    parts = []
    z0, a, b = FLOAT + 0.085, 0.285, 0.255
    dome = []
    for i in range(29):
        t = math.radians(180 - 180 * i / 28)
        dome.append(on_surface(bvh, a * math.cos(t), z0 + b * math.sin(t), 0.004))
    parts.append(tube('SM_Xedine_Badge_Cloche', dome, 0.0125, col, mats['silver']))
    # The logo's extra sweep line on the left was dropped at the founder's request (2026-11-17): only the
    # cloche's own arc, knob, highlights, fork and spoon.
    top = z0 + b
    hit, n = surface_point(bvh, 0.0, top + 0.03)
    knob = C.mesh_object('SM_Xedine_Badge_Knob', C.ellipsoid((0.024, 0.024, 0.02), tuple(hit + n * 0.01)), col,
                         mats['silver'])
    parts.append(knob)
    stem = tube('SM_Xedine_Badge_Stem', [on_surface(bvh, 0, top, 0.004), on_surface(bvh, 0, top + 0.012, 0.006),
                                         on_surface(bvh, 0, top + 0.022, 0.008)], 0.007, col, mats['silver'])
    parts.append(stem)
    for name, (x, z, r) in {'Dot_A': (0.14, FLOAT + 0.25, 0.012), 'Dot_B': (0.192, FLOAT + 0.19, 0.0085)}.items():
        hit, n = surface_point(bvh, x, z)
        parts.append(C.mesh_object(f'SM_Xedine_Badge_{name}', C.ellipsoid((r, r * 0.5, r), tuple(hit + n * 0.003)),
                                   col, mats['white']))
    # Fork and spoon: flat white shapes laid on the surface.
    fork = bmesh.new()
    for x0, x1, zz0, zz1 in [(-0.0075, 0.0075, 0.0, 0.065), (-0.02, 0.02, 0.065, 0.081),
                             (-0.02, -0.012, 0.081, 0.135), (-0.004, 0.004, 0.081, 0.135), (0.012, 0.02, 0.081, 0.135)]:
        g = bmesh.ops.create_cube(fork, size=1.0)
        bmesh.ops.scale(fork, vec=(x1 - x0, 0.008, zz1 - zz0), verts=g['verts'])
        bmesh.ops.translate(fork, vec=((x0 + x1) / 2, 0, (zz0 + zz1) / 2), verts=g['verts'])
    bmesh.ops.remove_doubles(fork, verts=fork.verts, dist=1e-5)
    spoon = bmesh.new()
    g = bmesh.ops.create_cube(spoon, size=1.0)
    bmesh.ops.scale(spoon, vec=(0.014, 0.008, 0.07), verts=g['verts'])
    bmesh.ops.translate(spoon, vec=(0, 0, 0.035), verts=g['verts'])
    bowl = bmesh.ops.create_uvsphere(spoon, u_segments=24, v_segments=12, radius=1.0)
    bmesh.ops.scale(spoon, vec=(0.026, 0.006, 0.036), verts=bowl['verts'])
    bmesh.ops.translate(spoon, vec=(0, 0, 0.1), verts=bowl['verts'])
    for name, bm_, x in (('Fork', fork, -0.055), ('Spoon', spoon, 0.055)):
        obj = C.mesh_object(f'SM_Xedine_Badge_{name}', bm_, col, mats['white'], smooth=name == 'Spoon')
        obj.location = (x, -1.0, FLOAT + 0.115)
        bpy.context.view_layer.update()
        conform(obj, bvh, protrude=0.006)
        parts.append(obj)
    return parts


# ---------------------------------------------------------------- the glove (built in its bone's own frame)

def glove_parts(side):
    """Bone-local pieces: fingers along +Y, back of the hand +Z, thumb toward +X*side."""
    mitten = C.metaball_mesh([((0, 0.07, 0), 0.1), ((0, 0.15, 0), 0.092), ((0, 0.205, 0), 0.07)])
    for v in mitten.verts:
        v.co.z *= 0.68
        v.co.z -= 0.35 * (v.co.x ** 2)  # cupped a little, like a relaxed hand
    for _ in range(2):
        bmesh.ops.smooth_vert(mitten, verts=mitten.verts, factor=0.5, use_axis_x=True, use_axis_y=True,
                              use_axis_z=True)
    thumb = C.metaball_mesh([((0, 0.0, 0), 0.04), ((0, 0.035, 0), 0.038), ((0, 0.068, 0), 0.033)])
    for v in thumb.verts:
        v.co.z *= 0.85
    index = C.capsule(0.024, 0.11)
    return {'mitten': mitten, 'index': index, 'thumb': thumb}


# ---------------------------------------------------------------- rig

def basis(y_dir, z_hint, origin):
    y = Vector(y_dir).normalized()
    z = (Vector(z_hint) - Vector(z_hint).dot(y) * y).normalized()
    x = y.cross(z)
    m = Matrix.Identity(4)
    for i, axis in enumerate((x, y, z)):
        for r in range(3):
            m[r][i] = axis[r]
    m.translation = Vector(origin)
    return m


def build_rig(col, eye_centres):
    data = bpy.data.armatures.new('ARM_Xedine')
    arm = bpy.data.objects.new('ARM_Xedine', data)
    col.objects.link(arm)
    vl = bpy.context.view_layer
    vl.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = data.edit_bones

    def bone(name, head, tail, parent=None, roll_to=None):
        b = eb.new(name)
        b.head, b.tail = Vector(head), Vector(tail)
        b.parent = eb[parent] if parent else None
        if roll_to is not None:
            b.align_roll(Vector(roll_to))
        return b

    bone('root', (0, 0, 0), (0, 0, 0.2))
    bone('float', (0, 0, FLOAT), (0, 0, FLOAT + 0.2), 'root')
    bone('body', (0, 0, FLOAT), (0, 0, FLOAT + 0.95), 'float')
    bone('hat', (0, 0, FLOAT + 0.9), (0, 0, FLOAT + 1.3), 'body', roll_to=(0, -1, 0))
    pivot = Vector((0, 0, FLOAT + CZ))
    for side, c in eye_centres.items():
        d = (Vector(c) - pivot).normalized()
        bone(f'eyelook_{side}', pivot, pivot + d * 0.12, 'body', roll_to=(0, 0, 1))
        bone(f'eye_{side}', c, Vector(c) + Vector((0, 0, 0.08)), f'eyelook_{side}', roll_to=(0, -1, 0))
    for side, sx in (('L', 1), ('R', -1)):
        wrist = Vector((WRIST.x * sx, WRIST.y, WRIST.z))
        fingers = Vector((REST_FINGERS.x * sx, REST_FINGERS.y, REST_FINGERS.z))
        hand = bone(f'hand_{side}', wrist, wrist + fingers * 0.15, 'float', roll_to=(0.55 * sx, 0.83, 0.1))
        m = hand.matrix.copy()
        r3 = m.to_3x3()
        z_axis = r3 @ Vector((0, 0, 1))
        for name, head, direction, length in (
            ('index', (0.026 * sx, 0.1, 0.004), (0, 1, 0), 0.1),
            ('thumb', (0.048 * sx, 0.06, 0.01), (0.6 * sx, 0.78, 0.12), 0.07),
        ):
            h = m @ Vector(head)
            bone(f'{name}_{side}', h, h + (r3 @ Vector(direction)).normalized() * length, f'hand_{side}',
                 roll_to=z_axis)
    mats = {b.name: b.matrix.copy() for b in eb}
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in arm.pose.bones:
        if pb.name in ('float', 'body', 'hat') or pb.name.startswith('eye'):
            pb.rotation_mode = 'XYZ'
    return arm, mats


def parent_to_bone(obj, arm, bone_name):
    mw = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = 'BONE'
    obj.parent_bone = bone_name
    bpy.context.view_layer.update()
    obj.matrix_world = mw


def build_gloves(col, mats_, arm, bone_mats):
    for side, sx in (('L', 1), ('R', -1)):
        parts = glove_parts(sx)
        for piece, bone_name in (('mitten', f'hand_{side}'), ('index', f'index_{side}'),
                                 ('thumb', f'thumb_{side}')):
            obj = C.mesh_object(f'SM_Xedine_Glove_{side}_{piece.title()}', parts[piece], col, mats_['glove'])
            obj.matrix_world = arm.matrix_world @ bone_mats[bone_name]
            bpy.context.view_layer.update()
            parent_to_bone(obj, arm, bone_name)


# ---------------------------------------------------------------- moves

def pose_hand(arm, side, wrist, fingers, back):
    pb = arm.pose.bones[f'hand_{side}']
    pb.matrix = basis(fingers, back, wrist)
    bpy.context.view_layer.update()


def key(arm, frame, names, paths=('location', 'rotation_quaternion', 'rotation_euler', 'scale')):
    for n in names:
        pb = arm.pose.bones[n]
        for p in paths:
            if p == 'rotation_quaternion' and pb.rotation_mode != 'QUATERNION':
                continue
            if p == 'rotation_euler' and pb.rotation_mode == 'QUATERNION':
                continue
            pb.keyframe_insert(p, frame=frame)


def reset_pose(arm):
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def fingers(arm, side, thumb=0.0, point=0.0):
    """thumb: tuck toward the palm (radians); point: 0 = the index finger hidden in the mitten, 1 = poked out."""
    arm.pose.bones[f'thumb_{side}'].rotation_quaternion = Matrix.Rotation(-thumb, 4, 'X').to_quaternion()
    arm.pose.bones[f'index_{side}'].location = (0, 0.1 * point, 0)
    bpy.context.view_layer.update()


HANDS = ['hand_L', 'hand_R', 'index_L', 'index_R', 'thumb_L', 'thumb_R']
CORE = ['float', 'body', 'hat']


def new_action(arm, name):
    reset_pose(arm)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data.action = act
    return act


def push(arm, act):
    track = arm.animation_data.nla_tracks.new()
    track.name = act.name
    track.strips.new(act.name, int(act.frame_range[0]), act)
    arm.animation_data.action = None
    reset_pose(arm)


def rest_hand(side):
    sx = 1 if side == 'L' else -1
    return (Vector((WRIST.x * sx, WRIST.y, WRIST.z)), Vector((REST_FINGERS.x * sx, REST_FINGERS.y, REST_FINGERS.z)),
            Vector((0.55 * sx, 0.83, 0.1)))


def build_actions(arm):
    arm.animation_data_create()
    # Idle: a 2-second breath while hovering; the hat lags, the hands drift half a beat behind.
    act = new_action(arm, 'AN_Idle')
    for f, lift, squash, tilt, drift in ((1, 0, 0, 0, 0), (16, 0.02, 0.006, 0.03, -0.008),
                                         (31, 0.036, 0.012, 0, -0.016), (46, 0.016, 0.004, -0.03, -0.004),
                                         (61, 0, 0, 0, 0)):
        p = arm.pose.bones
        p['float'].location = (0, lift, 0)
        p['body'].scale = (1 - squash * 0.8, 1 + squash, 1 - squash * 0.8)
        p['hat'].rotation_euler = (tilt, 0, 0)
        for side in ('L', 'R'):
            w, fd, back = rest_hand(side)
            pose_hand(arm, side, w + Vector((0, 0, drift)), fd, back)
        fingers(arm, 'L', thumb=0.15)
        fingers(arm, 'R', thumb=0.15)
        key(arm, f, CORE + HANDS)
    push(arm, act)

    # Wave: the left hand (viewer's right) rises beside the face and waves; the body leans into it.
    act = new_action(arm, 'AN_Wave')
    up = Vector((0.8, -0.18, FLOAT + 0.8))
    frames = [(1, None, 0), (10, 0, 0.05), (16, 0.42, 0.06), (22, -0.38, 0.06), (28, 0.42, 0.06),
              (34, -0.38, 0.06), (40, 0, 0.05), (52, None, 0)]
    for f, swing, lean in frames:
        p = arm.pose.bones
        p['body'].rotation_euler = (0, 0, -lean)
        p['hat'].rotation_euler = (0, 0, lean * 0.6 if swing is None else -swing * 0.08)
        for side in ('L', 'R'):
            w, fd, back = rest_hand(side)
            if side == 'L' and swing is not None:
                w, fd = up, Matrix.Rotation(swing, 3, 'Y') @ Vector((0.2, -0.05, 1)).normalized()
                back = Vector((0, 1, 0.15))
            pose_hand(arm, side, w, fd, back)
        fingers(arm, 'L', thumb=-0.25 if swing is not None else 0.15)
        fingers(arm, 'R', thumb=0.15)
        key(arm, f, CORE + HANDS)
    push(arm, act)

    # Point: the left hand points ahead and to the side, index out, the rest curled; the body leans in.
    act = new_action(arm, 'AN_Point')
    target = Vector((0.66, -0.42, FLOAT + 0.56))
    for f, k in ((1, 0.0), (12, 1.0), (40, 1.0)):
        p = arm.pose.bones
        p['body'].rotation_euler = (0.06 * k, 0, -0.04 * k)
        p['hat'].rotation_euler = (-0.04 * k, 0, 0)
        p['float'].location = (0, 0.015 * k, 0)
        for side in ('L', 'R'):
            w, fd, back = rest_hand(side)
            if side == 'L':
                w = w.lerp(target, k)
                fd = fd.lerp(Vector((0.45, -0.88, 0.12)).normalized(), k).normalized()
                back = back.lerp(Vector((0, 0, 1)), k)
            pose_hand(arm, side, w, fd, back)
        fingers(arm, 'L', thumb=0.15 + 0.7 * k, point=k)
        fingers(arm, 'R', thumb=0.15)
        key(arm, f, CORE + HANDS)
    push(arm, act)


# ---------------------------------------------------------------- the build

def build():
    scene = C.reset_scene()
    col = C.collection('COL_Xedine')
    mats = materials()
    body = build_body(col, mats)
    bvh = bvh_of(body)
    eyes = {}
    centres = {}
    for side, sx in (('L', 1), ('R', -1)):
        hit, _ = surface_point(bvh, EYE_X * sx, FLOAT + EYE_Z)
        centres[side] = hit
        eyes[side] = eye_object(f'SM_Xedine_Eye_{side}', (EYE_X * sx, 0, FLOAT + EYE_Z), col, mats['eye'], bvh)
    hat = build_hat(col, mats)
    badge = build_badge(col, mats, bvh)
    arm, bone_mats = build_rig(col, centres)
    for obj in [body] + badge:
        parent_to_bone(obj, arm, 'body')
    for obj in hat:
        parent_to_bone(obj, arm, 'hat')
    for side, obj in eyes.items():
        parent_to_bone(obj, arm, f'eye_{side}')
    build_gloves(col, mats, arm, bone_mats)
    build_actions(arm)
    return scene, arm


def stage(scene):
    """A warm studio for judging the look: a soft cyclorama, key, fill and a strong rim for the dark body."""
    col = C.collection('COL_Lookdev')
    bm = bmesh.new()
    prof = [(-6.0, 0.0)] + [(1.2 + 1.0 * math.sin(math.radians(a)), 1.0 - 1.0 * math.cos(math.radians(a)))
                             for a in range(0, 91, 6)] + [(2.2, 5.0)]
    verts = []
    for x in (-8.0, 8.0):
        verts.append([bm.verts.new((x, y, z)) for y, z in prof])
    for i in range(len(prof) - 1):
        bm.faces.new((verts[0][i], verts[0][i + 1], verts[1][i + 1], verts[1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    C.mesh_object('SM_Lookdev_Cyclorama', bm, col, C.principled('MAT_Lookdev_Backdrop', '#A7A29B', roughness=0.9))
    C.studio_world(scene, strength=0.35)
    C.area_light('LGT_Key', (-2.3, -2.7, 3.1), (0, 0, 0.9), 650, 2.4, '#FFF0DD', col)
    C.area_light('LGT_Fill', (2.9, -2.3, 1.4), (0, 0, 0.9), 140, 3.0, '#E6EEFF', col)
    C.area_light('LGT_Rim', (2.0, 2.4, 2.7), (0, 0, 1.0), 950, 1.3, '#FFFFFF', col)
    C.area_light('LGT_Rim_Left', (-2.2, 2.0, 1.6), (0, 0, 0.8), 420, 1.0, '#FFFFFF', col)
    cams = {
        'front': C.camera('CAM_Front', (0, -3.7, 0.95), (0, 0, 0.8), 58, col),
        'three_quarter': C.camera('CAM_ThreeQuarter', (2.15, -3.0, 1.3), (0, 0, 0.82), 58, col),
        'face': C.camera('CAM_Face', (0.55, -1.75, 1.2), (0, 0, 1.02), 70, col),
        'hand': C.camera('CAM_Hand', (1.3, -1.5, 0.75), (0.72, -0.2, 0.62), 60, col),
    }
    return cams


def export_glb(arm, path):
    ad = arm.animation_data
    ad.action = None
    for t in ad.nla_tracks:
        t.mute = False
    reset_pose(arm)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=False, export_apply=True, export_yup=True,
        export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_anim_slide_to_zero=True, export_optimize_animation_size=True, export_def_bones=False,
        export_skins=True, export_morph=False, export_lights=False, export_cameras=False, export_extras=False,
        export_materials='EXPORT')
    print('EXPORTED', path, os.path.getsize(path))


def look_eyes(arm, yaw=0.0, pitch=0.0):
    for side in ('L', 'R'):
        arm.pose.bones[f'eyelook_{side}'].rotation_euler = (pitch, 0, yaw)
    bpy.context.view_layer.update()


def play(arm, action_name, frame):
    ad = arm.animation_data
    for t in ad.nla_tracks:
        t.mute = True
    ad.action = bpy.data.actions[action_name]
    bpy.context.scene.frame_set(frame)


def render_previews(scene, arm):
    cams = stage(scene)
    C.setup_cycles(scene, samples=96, size=(1000, 1000))
    out = C.RENDERS
    play(arm, 'AN_Idle', 31)
    look_eyes(arm, yaw=0.3)
    C.render(scene, cams['front'], os.path.join(out, 'xedine_front.png'))
    look_eyes(arm, yaw=0.0)
    C.render(scene, cams['three_quarter'], os.path.join(out, 'xedine_three_quarter.png'))
    play(arm, 'AN_Wave', 22)
    look_eyes(arm, yaw=0.12, pitch=0.05)
    C.render(scene, cams['three_quarter'], os.path.join(out, 'xedine_wave.png'))
    play(arm, 'AN_Point', 30)
    look_eyes(arm, yaw=0.32)
    C.render(scene, cams['front'], os.path.join(out, 'xedine_point.png'))
    play(arm, 'AN_Idle', 1)
    look_eyes(arm)
    C.render(scene, cams['face'], os.path.join(out, 'xedine_face.png'))
    C.render(scene, cams['hand'], os.path.join(out, 'xedine_hand.png'))


if __name__ == '__main__':
    args = C.flags()
    scene, arm = build()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(C.WORK, 'xedine.blend'))
    if '--export' in args:
        export_glb(arm, os.path.join(C.WORK, 'xedine-raw.glb'))
    if '--render' in args:
        render_previews(scene, arm)
    print('XEDINE OK')
