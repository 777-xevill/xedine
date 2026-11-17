"""The café's people (ADR 0064): little blobs from Xedine's family (the same soft bell body and mitten hands),
each in their own real colour with one thing that says who they are. No chef hat: that is Xedine's alone.

    blender -b --factory-startup -P scripts/landing-3d/cast.py -- [--render]

Out: .cache/landing-3d/cast-raw.glb (then pack.mjs → public/landing/3d/cast.glb). The page moves everything live:
    CH_<id>             at the floor, facing +Z on the page (-Y here)
      CH_<id>_Bob       floats up and down
        CH_<id>_Body    body and what it wears
        CH_<id>_Face    turns to look (the eyes slide over the dome)
          CH_<id>_Eye_L, CH_<id>_Eye_R   squash to blink
        CH_<id>_Hand_L, CH_<id>_Hand_R   placed per pose (origin at the wrist)
    PROP_<name>         things to hold, cloned by the page (the phone's screen is SC_Phone, drawn live)
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
import xedine as X  # noqa: E402

FLOAT = X.FLOAT
CZ, R = X.CZ, X.R
WRIST = Vector((0.6, -0.14, FLOAT + 0.34))

# id: (body colour, scale, what they wear)
CAST = {
    'owner': ('#3B82D6', 1.0, ()),
    'shopper': ('#45A865', 1.0, ('cap:#F1EFE8',)),
    'cook': ('#EF8A4C', 1.04, ('apron', 'bandana')),
    'waiter': ('#2F5B8A', 1.0, ('collar', 'bowtie')),
    'cashier': ('#DD5A7B', 0.96, ('headset',)),
    'manager': ('#7A5BD4', 1.05, ('lanyard',)),
    'guest_a': ('#3FAE9F', 0.95, ('scarf',)),
    'guest_b': ('#9BCB62', 0.97, ('cap:#2F5B9E',)),
    'guest_c': ('#E886A6', 0.9, ('bow',)),
    'guest_d': ('#86B2E6', 0.93, ('beanie',)),
}


def mat(name, color, **kw):
    return C.principled(name, color, **kw)


def vinyl(name, color):
    return mat(name, color, roughness=0.42, coat=0.45, coat_rough=0.22, specular=0.45)


def fabric(name, color):
    return mat(name, color, roughness=0.85, sheen=0.6, sheen_rough=0.35)


def obj_from(name, bm, col, material, smooth=True):
    return C.mesh_object(name, bm, col, material, smooth=smooth)


def join(objs, name):
    target = objs[0]
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=target, object=target, selected_objects=objs,
                                       selected_editable_objects=objs):
            bpy.ops.object.join()
    target.name = name
    target.data.name = name
    return target


def shell(z0, z1, scale, a0=0.0, a1=360.0, steps=56):
    """A thin skin over part of the body (body space, before the float): apron, band, cap."""
    prof = [(r * scale, z) for r, z in X.body_profile() if z0 <= z <= z1]
    bm = bmesh.new()
    full = abs(a1 - a0) >= 359.9
    n = steps if full else max(4, int(steps * abs(a1 - a0) / 360))
    rings = []
    for i in range(n + (0 if full else 1)):
        a = math.radians(a0 + (a1 - a0) * i / n)
        rings.append([bm.verts.new((r * math.cos(a), r * math.sin(a), z)) for r, z in prof])
    count = len(rings) if full else len(rings) - 1
    for i in range(count):
        ra, rb = rings[i], rings[(i + 1) % len(rings)]
        for j in range(len(prof) - 1):
            bm.faces.new((ra[j], ra[j + 1], rb[j + 1], rb[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # Normals out of the body (recalc may pick inward on an open strip).
    for f in bm.faces:
        c = f.calc_center_median()
        if f.normal.dot(Vector((c.x, c.y, 0))) < 0:
            f.normal_flip()
    bmesh.ops.translate(bm, vec=(0, 0, FLOAT), verts=bm.verts)
    return bm


def body_bvh(body):
    me = body.data
    return BVHTree.FromPolygons([body.matrix_world @ v.co for v in me.vertices], [p.vertices for p in me.polygons])


def front_point(bvh, x, z):
    hit, normal, _, _ = bvh.ray_cast(Vector((x, -5.0, z)), Vector((0, 1, 0)))
    return hit, normal


def eye(name, col, mats):
    """A cartoon eye: white, a dark pupil, a glint. Local front = -Y, up = +Z, origin at its centre."""
    parts = []
    for part, radii, centre, m in (('White', (0.062, 0.026, 0.08), (0, 0, 0), mats['eye_white']),
                                   ('Pupil', (0.034, 0.016, 0.046), (0.0, -0.02, -0.01), mats['pupil']),
                                   ('Glint', (0.011, 0.008, 0.011), (0.014, -0.034, 0.016), mats['eye_white'])):
        bm = C.ellipsoid(radii, centre, segments=20, rings=10)
        parts.append(obj_from(f'{name}_{part}', bm, col, m))
    return join(parts, name)


def hand(name, side, col, material):
    parts = X.glove_parts('L' if side > 0 else 'R')
    bm = parts['mitten']
    thumb = parts['thumb']
    C.transform_bm(thumb, Matrix.Translation((0.07 * side, 0.05, 0.0)) @ Matrix.Rotation(math.radians(-35 * side), 4, 'Z'))
    me = bpy.data.meshes.new('tmp')
    thumb.to_mesh(me)
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    # Rest: fingers down, a little forward and out; the back of the hand faces out.
    y = Vector((0.4 * side, -0.32, -0.86)).normalized()
    z = Vector((side, 0, 0.2))
    z = (z - y * z.dot(y)).normalized()
    x = y.cross(z)
    rot = Matrix((x, y, z)).transposed().to_4x4()
    C.transform_bm(bm, rot)
    return obj_from(name, bm, col, material)


def wear(kind, bvh, col, mats, cid):
    out = []
    color = None
    if ':' in kind:
        kind, color = kind.split(':')
    if kind == 'apron':
        out.append(obj_from(f'{cid}_Apron', shell(0.04, 0.5, 1.018, -150, -30), col, mats['white_cloth']))
        tie = C.torus(0.012, 0.006, 12, 8)
        C.transform_bm(tie, Matrix.Translation((0, 0.56, FLOAT + 0.42)))
        out.append(obj_from(f'{cid}_Apron_Tie', tie, col, mats['white_cloth']))
    elif kind == 'bandana':
        out.append(obj_from(f'{cid}_Bandana', shell(0.78, 0.9, 1.025), col, mats['red_cloth']))
        knot = C.ellipsoid((0.05, 0.04, 0.035), (0, 0.42, FLOAT + 0.86), segments=16, rings=8)
        out.append(obj_from(f'{cid}_Bandana_Knot', knot, col, mats['red_cloth']))
    elif kind == 'collar':
        out.append(obj_from(f'{cid}_Collar', shell(0.4, 0.47, 1.02), col, mats['white_cloth']))
    elif kind == 'bowtie':
        hit, n = front_point(bvh, 0.0, FLOAT + 0.43)
        for sx in (-1, 1):
            wing = C.ellipsoid((0.055, 0.02, 0.035), (sx * 0.045, 0, 0), segments=14, rings=8)
            C.transform_bm(wing, Matrix.Translation(hit + n * 0.02))
            out.append(obj_from(f'{cid}_Bow_{sx}', wing, col, mats['black']))
        knot = C.ellipsoid((0.02, 0.022, 0.024), hit + n * 0.03, segments=12, rings=6)
        out.append(obj_from(f'{cid}_Bow_Knot', knot, col, mats['black']))
    elif kind == 'headset':
        band = C.torus(0.53, 0.016, 48, 8)
        band.verts.ensure_lookup_table()
        bmesh.ops.delete(band, geom=[v for v in band.verts if v.co.z < -0.02], context='VERTS')
        C.transform_bm(band, Matrix.Translation((0, 0, FLOAT + CZ + 0.08)))
        out.append(obj_from(f'{cid}_Headset_Band', band, col, mats['black']))
        for sx in (-1, 1):
            cup = C.ellipsoid((0.03, 0.07, 0.08), (sx * 0.53, 0, FLOAT + CZ + 0.08), segments=16, rings=8)
            out.append(obj_from(f'{cid}_Headset_Cup_{sx}', cup, col, mats['black']))
        boom = X.tube(f'{cid}_Headset_Boom', [(-0.53, -0.04, FLOAT + CZ + 0.04), (-0.47, -0.25, FLOAT + 0.42),
                                              (-0.28, -0.44, FLOAT + 0.38)], 0.008, col, mats['black'])
        out.append(boom)
        out.append(obj_from(f'{cid}_Headset_Mic', C.ellipsoid((0.022, 0.022, 0.022), (-0.27, -0.45, FLOAT + 0.38)),
                            col, mats['silver']))
    elif kind == 'lanyard':
        pts = []
        for x, z in ((-0.24, 0.62), (-0.13, 0.45), (0.0, 0.33), (0.13, 0.45), (0.24, 0.62)):
            hit, n = front_point(bvh, x, FLOAT + z)
            pts.append(tuple(hit + n * 0.012))
        out.append(X.tube(f'{cid}_Lanyard', pts, 0.008, col, mats['red_cloth']))
        hit, n = front_point(bvh, 0.0, FLOAT + 0.27)
        card = C.ellipsoid((0.055, 0.008, 0.07), (0, 0, 0), segments=12, rings=6)
        C.transform_bm(card, Matrix.Translation(hit + n * 0.02))
        out.append(obj_from(f'{cid}_Card', card, col, mats['white_cloth']))
    elif kind == 'cap':
        m = fabric(f'MAT_Fabric_Cap_{cid}', color)
        out.append(obj_from(f'{cid}_Cap', shell(0.82, 0.96, 1.04), col, m))
        brim = C.ellipsoid((0.24, 0.17, 0.014), (0, -0.38, FLOAT + 0.84), segments=24, rings=8)
        out.append(obj_from(f'{cid}_Cap_Brim', brim, col, m))
        out.append(obj_from(f'{cid}_Cap_Button', C.ellipsoid((0.03, 0.03, 0.02), (0, 0, FLOAT + CZ + R * 1.03 + 0.005)),
                            col, m))
    elif kind == 'scarf':
        ring = C.torus(0.54, 0.055, 40, 12)
        C.transform_bm(ring, Matrix.Rotation(math.radians(90), 4, 'X') @ Matrix.Identity(4))
        C.transform_bm(ring, Matrix.Translation((0, 0, FLOAT + 0.4)))
        out.append(obj_from(f'{cid}_Scarf', ring, col, mats['scarf']))
        end = C.capsule(0.05, 0.28)
        C.transform_bm(end, Matrix.Translation((0.2, -0.5, FLOAT + 0.42)) @ Matrix.Rotation(math.radians(-90), 4, 'X'))
        out.append(obj_from(f'{cid}_Scarf_End', end, col, mats['scarf']))
    elif kind == 'bow':
        for sx in (-1, 1):
            b = C.ellipsoid((0.09, 0.04, 0.06), (sx * 0.08, 0.05, FLOAT + CZ + R + 0.02), segments=14, rings=8)
            out.append(obj_from(f'{cid}_Bow_{sx}', b, col, mats['bow']))
        out.append(obj_from(f'{cid}_Bow_Knot', C.ellipsoid((0.03, 0.03, 0.03), (0, 0.05, FLOAT + CZ + R + 0.02)),
                            col, mats['bow']))
    elif kind == 'beanie':
        out.append(obj_from(f'{cid}_Beanie', shell(0.74, 0.96, 1.05), col, mats['beanie']))
        out.append(obj_from(f'{cid}_Beanie_Pom', C.ellipsoid((0.07, 0.07, 0.07), (0, 0, FLOAT + CZ + R + 0.07)), col,
                            mats['beanie_pom']))
    return out


def build_character(cid, spec, col, mats):
    colour, scale, wears = spec
    root = bpy.data.objects.new(f'CH_{cid}', None)
    col.objects.link(root)
    bob = bpy.data.objects.new(f'CH_{cid}_Bob', None)
    col.objects.link(bob)
    bob.parent = root
    skin = vinyl(f'MAT_Body_{cid}', colour)
    body = obj_from(f'{cid}_body_base', C.lathe(X.body_profile(), steps=56), col, skin)
    body.location = (0, 0, FLOAT)
    bpy.context.view_layer.update()
    bvh = body_bvh(body)
    worn = []
    for kind in wears:
        worn += wear(kind, bvh, col, mats, cid)
    body.data.transform(Matrix.Translation((0, 0, FLOAT)))
    body.location = (0, 0, 0)
    body = join([body] + worn, f'CH_{cid}_Body')
    body.parent = bob
    face = bpy.data.objects.new(f'CH_{cid}_Face', None)
    col.objects.link(face)
    face.location = (0, 0, FLOAT + CZ)
    face.parent = bob
    for side, sx in (('L', 1), ('R', -1)):
        hit, n = front_point(bvh, sx * 0.13, FLOAT + 0.66)
        e = eye(f'CH_{cid}_Eye_{side}', col, mats)
        e.location = hit + n * 0.006
        e.rotation_euler = n.to_track_quat('-Y', 'Z').to_euler()
        bpy.context.view_layer.update()
        mw = e.matrix_world.copy()
        e.parent = face
        e.matrix_world = mw
        h = hand(f'CH_{cid}_Hand_{side}', sx, col, skin)
        h.location = (WRIST.x * sx, WRIST.y, WRIST.z)
        h.parent = bob
    root.scale = (scale, scale, scale)
    return root


# ---------------------------------------------------------------- props

def build_props(col, mats):
    props = []
    # A phone: graphite body, the screen drawn live by the page (SC_Phone, 0..1 UVs, upright).
    phone = obj_from('PROP_Phone', C.ellipsoid((0.04, 0.0055, 0.078), segments=24, rings=8), col, mats['graphite'])
    bm = bmesh.new()
    w, h = 0.07, 0.14
    pts = [(-w / 2, -0.0058, -h / 2), (w / 2, -0.0058, -h / 2), (w / 2, -0.0058, h / 2), (-w / 2, -0.0058, h / 2)]
    face = bm.faces.new([bm.verts.new(p) for p in pts])
    uv = bm.loops.layers.uv.verify()
    for loop, (u, v) in zip(face.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        loop[uv].uv = (u, v)
    screen = obj_from('SC_Phone', bm, col, mats['screen'], smooth=False)
    screen.parent = phone
    box = bmesh.new()
    bmesh.ops.create_cube(box, size=1.0)
    for v in box.verts:
        v.co = Vector((v.co.x * 0.08, v.co.y * 0.011, v.co.z * 0.16))
    bmesh.ops.bevel(box, geom=list(box.edges), offset=0.009, segments=3, affect='EDGES', profile=0.5)
    bpy.data.objects.remove(phone)
    phone = obj_from('PROP_Phone', box, col, mats['graphite'])
    screen.parent = phone
    props.append(phone)
    # A tray with a latte on it (the waiter).
    tray = obj_from('PROP_Tray', C.lathe([(0.0, 0.012), (0.19, 0.012), (0.2, 0.022), (0.205, 0.018), (0.19, 0.0),
                                          (0.0, 0.0)], steps=48), col, mats['silver'])
    cup = obj_from('PROP_Tray_Cup', C.lathe([(0.0, 0.085), (0.042, 0.085), (0.044, 0.08), (0.04, 0.03), (0.032, 0.006),
                                             (0.026, 0.0), (0.0, 0.0)], steps=32), col, mats['ceramic'])
    cup.location = (0.05, 0.0, 0.012)
    latte = obj_from('PROP_Tray_Latte', C.ellipsoid((0.039, 0.039, 0.002), (0, 0, 0)), col, mats['latte'])
    latte.location = (0.05, 0.0, 0.09)
    for o in (cup, latte):
        o.parent = tray
    props.append(tray)
    # A shopping bag with greens and a carrot (the shopper carries two).
    bag = bmesh.new()
    bmesh.ops.create_cube(bag, size=1.0)
    for v in bag.verts:
        v.co = Vector((v.co.x * 0.28, v.co.y * 0.14, (v.co.z + 0.5) * 0.3))
    bmesh.ops.bevel(bag, geom=list(bag.edges), offset=0.02, segments=2, affect='EDGES', profile=0.5)
    bag_obj = obj_from('PROP_Bag', bag, col, mats['jute'], smooth=False)
    handle = C.torus(0.07, 0.008, 24, 8)
    C.transform_bm(handle, Matrix.Translation((0, 0, 0.3)))
    greens = C.ellipsoid((0.1, 0.06, 0.07), (-0.05, 0, 0.31), segments=14, rings=8)
    carrot = C.capsule(0.022, 0.18)
    C.transform_bm(carrot, Matrix.Translation((0.08, 0.0, 0.25)) @ Matrix.Rotation(math.radians(-70), 4, 'X'))
    for name, part, m in (('PROP_Bag_Handle', handle, mats['jute']), ('PROP_Bag_Greens', greens, mats['greens']),
                          ('PROP_Bag_Carrot', carrot, mats['carrot'])):
        o = obj_from(name, part, col, m)
        o.parent = bag_obj
    props.append(bag_obj)
    # A mug of tea (the owner), a spatula (the cook), a notepad (the waiter), a card (paying).
    mug = obj_from('PROP_Mug', C.lathe([(0.0, 0.1), (0.045, 0.1), (0.046, 0.0), (0.0, 0.0)], steps=32), col,
                   mats['mug'])
    ring = C.torus(0.03, 0.008, 20, 8)
    C.transform_bm(ring, Matrix.Translation((0.058, 0, 0.05)))
    o = obj_from('PROP_Mug_Handle', ring, col, mats['mug'])
    o.parent = mug
    props.append(mug)
    spatula = obj_from('PROP_Spatula', C.capsule(0.012, 0.22), col, mats['black'])
    blade = bmesh.new()
    bmesh.ops.create_cube(blade, size=1.0)
    for v in blade.verts:
        v.co = Vector((v.co.x * 0.09, v.co.y * 0.11 + 0.27, v.co.z * 0.004))
    o = obj_from('PROP_Spatula_Blade', blade, col, mats['silver'], smooth=False)
    o.parent = spatula
    props.append(spatula)
    pad = bmesh.new()
    bmesh.ops.create_cube(pad, size=1.0)
    for v in pad.verts:
        v.co = Vector((v.co.x * 0.09, v.co.y * 0.012, v.co.z * 0.12))
    props.append(obj_from('PROP_Notepad', pad, col, mats['white_cloth'], smooth=False))
    card = bmesh.new()
    bmesh.ops.create_cube(card, size=1.0)
    for v in card.verts:
        v.co = Vector((v.co.x * 0.085, v.co.y * 0.002, v.co.z * 0.054))
    props.append(obj_from('PROP_Card', card, col, mats['card'], smooth=False))
    return props


def materials():
    return {
        'eye_white': mat('MAT_Eye_White', '#FBFBF8', roughness=0.2, coat=0.6, coat_rough=0.05),
        'pupil': mat('MAT_Eye_Pupil', '#18191C', roughness=0.15, coat=0.8, coat_rough=0.02),
        'white_cloth': fabric('MAT_Fabric_White', '#F4F3EE'),
        'red_cloth': fabric('MAT_Fabric_Red', '#D23F33'),
        'black': mat('MAT_Plastic_Black', '#1C1D20', roughness=0.4),
        'silver': mat('MAT_Metal_Silver', '#C9CDD1', roughness=0.22, metallic=1.0),
        'scarf': fabric('MAT_Fabric_Scarf', '#E9784B'),
        'bow': fabric('MAT_Fabric_Bow', '#F4F1F2'),
        'beanie': fabric('MAT_Fabric_Beanie', '#F2B544'),
        'beanie_pom': fabric('MAT_Fabric_Pom', '#FBF6EA'),
        'graphite': mat('MAT_Device_Graphite', '#26272B', roughness=0.35, metallic=0.4),
        'screen': mat('MAT_Screen_Phone', '#1E2024', roughness=0.2, emission='#2B2D31', emission_strength=1.0),
        'ceramic': mat('MAT_Ceramic_White', '#F2F0EB', roughness=0.12, coat=0.6, coat_rough=0.05),
        'latte': mat('MAT_Food_Latte', '#C99A6B', roughness=0.4),
        'jute': fabric('MAT_Fabric_Jute', '#C8A46B'),
        'greens': mat('MAT_Food_Greens', '#5DAA3C', roughness=0.5),
        'carrot': mat('MAT_Food_Carrot', '#E8812F', roughness=0.45),
        'mug': mat('MAT_Ceramic_Mug', '#F1E6D2', roughness=0.2, coat=0.5),
        'card': mat('MAT_Plastic_Card', '#2B2D31', roughness=0.3, coat=0.5),
    }


def build():
    scene = C.reset_scene()
    col = C.collection('COL_Cast')
    mats = materials()
    roots = []
    for i, (cid, spec) in enumerate(CAST.items()):
        roots.append(build_character(cid, spec, col, mats))
    props = build_props(col, mats)
    return scene, col, roots, props


def export(col, path):
    objs = list(col.all_objects)
    for o in bpy.context.view_layer.objects:
        o.select_set(o in objs)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_animations=False, export_lights=False, export_cameras=False,
                              export_extras=False, export_materials='EXPORT')
    print('EXPORTED', path, os.path.getsize(path), flush=True)


def line_up(roots, props):
    """For the look render only: everyone in a row."""
    for i, r in enumerate(roots):
        r.location = (i * 1.25 - (len(roots) - 1) * 0.625, 0, 0)
    for i, p in enumerate(props):
        p.location = (i * 0.5 - 1.5, -1.2, 0.3)


if __name__ == '__main__':
    args = C.flags()
    scene, col, roots, props = build()
    export(col, os.path.join(C.WORK, 'cast-raw.glb'))
    if '--render' in args:
        line_up(roots, props)
        C.setup_cycles(scene, samples=48, size=(1800, 600))
        C.studio_world(scene, strength=0.8)
        C.area_light('LGT_Key', (-3, -6, 5), (0, 0, 0.8), 900, 4.0, '#FFF6EC')
        cam = C.camera('CAM_Cast', (0, -14.5, 2.4), (0, 0, 0.75), 50)
        C.render(scene, cam, os.path.join(C.RENDERS, 'cast.png'))
    print('CAST OK')
