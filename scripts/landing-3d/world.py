"""The whole café for the landing page's day (ADR 0064, approval 3): one building on a street corner, so the
camera can travel through it without a cut.

    blender -b --factory-startup -P scripts/landing-3d/world.py -- [--render] [--fast] [--night]

Layout (metres, Z up; the street is to the south, -Y):

    y 6.4  +-------------------------------+---------------------+
           |  (closed back room)           |  STOREROOM          |  back door to the alley (x 9.75..11.6)
    y 2.75 +---------- back wall ----------+------ door ---------+
           |  CAFÉ: counter, till,         |  KITCHEN            |
           |  espresso, menu board         |  line, prep table,  |
           |  (hatch to the kitchen) ......|  kitchen screen     |
    y -1.0 |  dining room                  +---------------------+
           |                               |  OFFICE (desk,      |
           |  (door to the office) ........|  sofa, window)      |
    y -4.7 +== shop window, door ==========+==== window =========+
             main street pavement, then the road; the side street runs north on the west (x < -4.3)
           x -4.3                          x 4.15                x 9.75

Every object gets an atlas name (bake.py groups by it; its prefix is the zone the page loads: st street,
ca café, ki kitchen, sr storeroom, of office). The name "Xedine" is on the sign, the awning, the window, the
chalk boards and every screen (the founder, 2026-11-17).
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import cafe as K  # noqa: E402
import common as C  # noqa: E402

MADE = K.MADE
FONT = os.path.join(C.WORK, 'assets', 'fonts', 'Inter-ExtraBold.ttf')
LOGO = os.path.join(C.ROOT, 'public', 'brand', 'logo-chef-512.png')
CEIL = K.CEILING  # 3.2
FRONT, FACADE = -4.7, -4.85  # the street wall: inside face, outside face
EAST, EAST_OUT = 9.6, 9.75  # the alley wall
NORTH, NORTH_OUT = 6.25, 6.4
ROOF, PARAPET = 6.6, 7.3
WALK = -0.02  # the pavement's top, just below the café floor
ROAD = -0.16
COL = None


# ---------------------------------------------------------------- helpers

def tag(atlas):
    """Every new mesh so far belongs to this atlas (and its zone, the name's prefix)."""
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and 'atlas' not in o and not o.name.startswith('PROTO_'):
            o['atlas'] = atlas


NORMALS = {'-Y': Vector((0, -1, 0)), '+Y': Vector((0, 1, 0)), '-X': Vector((-1, 0, 0)), '+X': Vector((1, 0, 0))}


def quad(name, center, size, facing, mat, uv=None):
    """A one-sided rectangle facing `facing`. uv=None: 0..1 across it, upright (screens, pictures);
    uv=metres: the texture repeats every `uv` metres (walls)."""
    n = NORMALS[facing]
    up = Vector((0, 0, 1))
    right = up.cross(n)
    w, h = size
    c = Vector(center)
    bm = bmesh.new()
    pts = [c - right * w / 2 - up * h / 2, c + right * w / 2 - up * h / 2, c + right * w / 2 + up * h / 2,
           c - right * w / 2 + up * h / 2]
    face = bm.faces.new([bm.verts.new(p) for p in pts])
    if uv is None:
        layer = bm.loops.layers.uv.verify()
        for loop, (u, v) in zip(face.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
            loop[layer].uv = (u, v)
    else:
        K.box_uv(bm, uv)
    return C.mesh_object(name, bm, COL, mat, smooth=False)


def on_wall(center, facing, w, h, out, back=0.0):
    """lo/hi of a box sitting on a wall: `w` across, `h` tall, from `back` behind the surface to `out` in front."""
    n = NORMALS[facing]
    ai, ni = (0, 1) if facing in ('-Y', '+Y') else (1, 0)
    s = n[ni]
    lo, hi = [0.0] * 3, [0.0] * 3
    lo[ai], hi[ai] = center[ai] - w / 2, center[ai] + w / 2
    lo[2], hi[2] = center[2] - h / 2, center[2] + h / 2
    a, b = center[ni] - s * back, center[ni] + s * out
    lo[ni], hi[ni] = min(a, b), max(a, b)
    return tuple(lo), tuple(hi)


def screen(name, center, size, facing, m, frame=0.02, depth=0.012):
    """A live screen (drawn by the page) in a graphite bezel on a wall or a stand."""
    lo, hi = on_wall(center, facing, size[0] + 2 * frame, size[1] + 2 * frame, depth)
    K.box(f'SM_Bezel_{name[10:]}', lo, hi, m['device'], COL, bevel=0.004)
    n = NORMALS[facing]
    mat = C.principled(f'MAT_{name[3:]}', '#1E2024', roughness=0.2, emission='#2B2D31', emission_strength=1.0)
    return quad(name, Vector(center) + n * (depth + 0.0015), size, facing, mat)


def text_mesh(name, body, size, extrude, bevel, mat, font=FONT):
    """Letters standing up, facing -Y (the street), centred on the origin."""
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = body
    cu.font = bpy.data.fonts.load(font, check_existing=True)
    cu.size = size
    cu.extrude = extrude
    cu.bevel_depth = bevel
    cu.bevel_resolution = 2
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.resolution_u = 5
    tmp = bpy.data.objects.new(name + '_tmp', cu)
    COL.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    me.transform(Matrix.Rotation(math.radians(90), 4, 'X'))
    me.name = name
    me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    COL.objects.link(obj)
    return obj


def slab(name, corners, thickness, mat, uv=1.0):
    """A thin plate under four corner points (the awning)."""
    bm = bmesh.new()
    top = [bm.verts.new(Vector(p)) for p in corners]
    bot = [bm.verts.new(Vector(p) - Vector((0, 0, thickness))) for p in corners]
    bm.faces.new(top)
    bm.faces.new(list(reversed(bot)))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((top[i], bot[i], bot[j], top[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.box_uv(bm, uv)
    return C.mesh_object(name, bm, COL, mat, smooth=False)


def image_mat(name, path, alpha=False, emission=0.0, roughness=0.6):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes['Principled BSDF']
    img = nodes.new('ShaderNodeTexImage')
    img.image = bpy.data.images.load(path, check_existing=True)
    links.new(img.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = roughness
    if alpha:
        links.new(img.outputs['Alpha'], bsdf.inputs['Alpha'])
        mat.surface_render_method = 'BLENDED'
    if emission:
        links.new(img.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = emission
    return mat


def place(asset, loc, rot=0.0, scale=1.0, name=None, part=None):
    return K.place(asset, loc, rot=rot, scale=scale, col=COL, name=name, part=part)


def hinge(objs, pivot, angle_deg):
    """Swing door parts built closed around `pivot` (their origin) by an angle about Z."""
    for o in objs:
        o.location = pivot
        o.rotation_euler = (0, 0, math.radians(angle_deg))


def local_box(name, lo, hi, mat, bevel=0.0):
    """A box built around the origin (for parts that are moved or turned afterwards)."""
    return K.box(name, lo, hi, mat, COL, bevel=bevel)


def bounds(o):
    """The object's box in the world: (lowest corner, highest corner)."""
    bpy.context.view_layer.update()
    cs = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return (Vector([min(c[i] for c in cs) for i in range(3)]), Vector([max(c[i] for c in cs) for i in range(3)]))


def point_light(name, loc, power, color, radius, col):
    light = bpy.data.objects.new(name, bpy.data.lights.new(name, 'POINT'))
    light.data.energy = power
    light.data.color = C.lin(color)[:3]
    light.data.shadow_soft_size = radius
    light.location = loc
    col.objects.link(light)
    return light


# ---------------------------------------------------------------- materials

def palette():
    m = K.palette()
    m.update({
        'pavers': K.textured('MAT_Street_Pavers', 'interlocking_concrete_pavers', size=1.6, rough=0.85, normal=0.7),
        'asphalt': K.textured('MAT_Street_Asphalt', 'clean_asphalt', size=4.0, normal=0.5),
        'plaster': K.paint('MAT_Facade_Cream', '#EDE3D1'),
        'plaster_upper': K.paint('MAT_Facade_Sage', '#B7C6B2'),
        'brick': K.textured('MAT_Brick_Neighbour', 'brown_brick_02', size=1.4, normal=0.8),
        'kitchen_floor': K.textured('MAT_Floor_Kitchen', 'anti_skid_tiles', size=0.9, rough=0.55, normal=0.6),
        'store_floor': K.textured('MAT_Floor_Store', 'concrete_floor_02', size=2.2, normal=0.5),
        'office_floor': K.textured('MAT_Floor_Office', 'laminate_floor_02', size=1.6, rough=0.45, normal=0.5),
        'concrete': K.textured('MAT_Concrete_Roof', 'concrete_floor_02', size=3.0, normal=0.5),
        'white_tiles': K.textured('MAT_Tiles_White', 'long_white_tiles', size=0.9, rough=0.22, normal=0.7, coat=0.2),
        'kitchen_wall': K.paint('MAT_Wall_Kitchen', '#E9ECEB'),
        'store_wall': K.paint('MAT_Wall_Store', '#E2DCD1'),
        'office_wall': K.paint('MAT_Wall_Office', '#E4E8E0'),
        'kerb': C.principled('MAT_Stone_Kerb', '#9A9B97', roughness=0.8),
        'road_line': C.principled('MAT_Road_Line', '#ECE9DF', roughness=0.7),
        'sign_board': C.principled('MAT_Sign_Board', C.GREY, roughness=0.42, metallic=0.25, coat=0.4,
                                   coat_rough=0.15),
        'sign_letters': C.principled('MAT_Sign_Letters', '#F7F6F1', roughness=0.3, coat=0.5, emission='#FFF2D6',
                                     emission_strength=0.0),
        'sign_logo': image_mat('MAT_Sign_Logo', LOGO, alpha=True, roughness=0.35),
        'awning': image_mat('MAT_Awning_Stripes', os.path.join(MADE, 'awning_stripes.png'), roughness=0.85),
        'valance': image_mat('MAT_Awning_Edge', os.path.join(MADE, 'awning_valance.png'), roughness=0.85),
        'aframe': image_mat('MAT_Board_Aframe', os.path.join(MADE, 'chalk_aframe.png'), roughness=0.85),
        'decal': image_mat('MAT_Decal_Window', os.path.join(MADE, 'window_lettering.png'), alpha=True,
                           roughness=0.3),
        'qr': image_mat('MAT_Card_QR', os.path.join(MADE, 'qr_card.png'), roughness=0.3),
        'checklist': image_mat('MAT_Paper_Checklist', os.path.join(MADE, 'checklist.png'), roughness=0.8),
        'licence': image_mat('MAT_Paper_Licence', os.path.join(MADE, 'certificate.png'), roughness=0.7),
        'window_dark': C.principled('MAT_Window_Upper', '#27303A', roughness=0.06, coat=0.8, coat_rough=0.02),
        'window_lit': C.principled('MAT_Window_Lit', '#27303A', roughness=0.06, coat=0.8, coat_rough=0.02,
                                   emission='#FFD49A', emission_strength=0.0),
        'frame_white': C.principled('MAT_Paint_Frame_White', '#EEEDE8', roughness=0.4),
        'acrylic': C.principled('MAT_Acrylic_Clear', '#E9EEF0', roughness=0.05, coat=0.8),
        'door_steel': C.principled('MAT_Metal_Door_Grey', '#6F757B', roughness=0.42, metallic=0.55),
        'oil': C.principled('MAT_Food_Oil', '#D7A23A', roughness=0.04, coat=0.8),
        'bread': C.principled('MAT_Food_Bread', '#D79F5A', roughness=0.6),
        'bun_bag': C.principled('MAT_Plastic_Bag_Clear', '#E7D3B0', roughness=0.25, coat=0.4),
        'sack': C.principled('MAT_Fabric_Sack', '#CBB68C', roughness=0.95, sheen=0.4),
        'milk': C.principled('MAT_Pack_Milk', '#F5F5F2', roughness=0.4),
        'band_blue': C.principled('MAT_Pack_Band_Blue', '#3E7DCA', roughness=0.4),
        'band_red': C.principled('MAT_Pack_Band_Red', '#D0453A', roughness=0.4),
        'band_green': C.principled('MAT_Pack_Band_Green', '#4E9A5B', roughness=0.4),
        'kraft': C.principled('MAT_Paper_Kraft', '#B98E5B', roughness=0.85),
        'beans_bag': C.principled('MAT_Pack_Coffee', '#3E2A1E', roughness=0.5, coat=0.3),
        'tin': C.principled('MAT_Metal_Tin', '#B9BDC1', roughness=0.3, metallic=1.0),
        'ketchup': C.principled('MAT_Bottle_Red', '#C3302A', roughness=0.25, coat=0.5),
        'mustard': C.principled('MAT_Bottle_Yellow', '#E7B52E', roughness=0.25, coat=0.5),
        'tomato_whole': C.principled('MAT_Food_Tomato_Whole', '#D23B26', roughness=0.25, coat=0.6),
        'grey_plastic': C.principled('MAT_Plastic_Grey', '#8C9095', roughness=0.5),
        'panel': C.principled('MAT_Light_Panel', '#F3F5F7', roughness=0.5, emission='#F4F7FF', emission_strength=5.0),
        'fridge_glow': C.principled('MAT_Light_Fridge', '#F3F7FA', roughness=0.5, emission='#EEF6FF',
                                    emission_strength=3.0),
        'tank': C.principled('MAT_Plastic_Tank', '#2D3034', roughness=0.6),
        'rug': C.principled('MAT_Fabric_Rug', '#9C6B48', roughness=1.0, sheen=0.6),
        'binder_a': C.principled('MAT_Binder_Teal', '#2F7F7A', roughness=0.5),
        'binder_b': C.principled('MAT_Binder_Ochre', '#C7923A', roughness=0.5),
        'lamp_glow': C.principled('MAT_Lamp_Glow', '#FFE2B0', roughness=0.4, emission='#FFD9A0',
                                  emission_strength=0.0),
    })
    return m


# ---------------------------------------------------------------- the café

def build_cafe_room(m):
    K.box('SM_Floor', (-4.15, FRONT, -0.06), (4.15, 2.75, 0.0), m['floor'], COL)
    tag('ca_floor')
    K.box('SM_Ceiling', (-4.3, FACADE, CEIL), (4.15, 2.75, CEIL + 0.1), m['ceiling'], COL)
    K.box('SM_Wall_Back', (-4.15, 2.6, 0), (4.15, 2.75, CEIL), m['wall'], COL)
    # The window wall on the side street (inside skin; the facade is the outside skin).
    y0, y1, z0, z1 = -1.7, 1.5, 0.95, 2.7
    for name, lo, hi in (('Low', (-4.15, FRONT, 0), (-4.0, 2.6, z0)), ('High', (-4.15, FRONT, z1), (-4.0, 2.6, CEIL)),
                         ('Front', (-4.15, FRONT, z0), (-4.0, y0, z1)), ('Back', (-4.15, y1, z0), (-4.0, 2.6, z1))):
        K.box(f'SM_Wall_Window_{name}', lo, hi, m['wall'], COL)
    f = 0.045
    frame = [((-4.1, y0, z0), (-4.03, y1, z0 + f)), ((-4.1, y0, z1 - f), (-4.03, y1, z1)),
             ((-4.1, y0, z0), (-4.03, y0 + f, z1)), ((-4.1, y1 - f, z0), (-4.03, y1, z1)),
             ((-4.1, -0.6, z0), (-4.03, -0.6 + 0.03, z1)), ((-4.1, 0.45, z0), (-4.03, 0.45 + 0.03, z1)),
             ((-4.1, y0, 1.95), (-4.03, y1, 1.95 + 0.03))]
    K.boxes('SM_Window_Frame', frame, m['steel_black'], COL, bevel=0.004)
    K.box('SM_Window_Glass', (-4.075, y0, z0), (-4.07, y1, z1), m['glass'], COL)
    K.box('SM_Window_Sill', (-4.05, y0 - 0.05, z0 - 0.04), (-3.72, y1 + 0.05, z0), m['walnut'], COL, bevel=0.006)
    # The kitchen wall: the doorway, the hatch the food comes through, the office door.
    for name, (ya, yb, za, zb) in (('Kitchen_Back', (1.9, 2.6, 0, CEIL)), ('Kitchen_Top', (0.7, 1.9, 2.25, CEIL)),
                                   ('Mid', (0.35, 0.7, 0, CEIL)), ('Hatch_Low', (-0.55, 0.35, 0, 1.05)),
                                   ('Hatch_High', (-0.55, 0.35, 1.85, CEIL)), ('Front_Mid', (-2.5, -0.55, 0, CEIL)),
                                   ('Office_Top', (-3.4, -2.5, 2.2, CEIL)), ('Front_End', (FRONT, -3.4, 0, CEIL))):
        K.box(f'SM_Wall_East_{name}', (4.0, ya, za), (4.15, yb, zb), m['wall'], COL)
    K.box('SM_Hatch_Shelf', (3.78, -0.6, 1.02), (4.45, 0.4, 1.06), m['stainless'], COL, bevel=0.004)
    # The street front: wooden risers, a black steel frame, big panes, the glass door standing open.
    door = (1.15, 2.35)
    for name, (xa, xb) in (('L', (-4.15, door[0])), ('R', (door[1], 4.15))):
        K.box(f'SM_Shopfront_Riser_{name}', (xa, FACADE, 0), (xb, FRONT, 0.45), m['walnut'], COL, bevel=0.004)
    K.box('SM_Threshold', (door[0], FACADE, -0.04), (door[1], FRONT, 0.0), m['stainless'], COL)
    K.box('SM_Shopfront_Head', (-4.15, FACADE, 2.55), (4.15, FRONT, CEIL), m['wall'], COL)
    bars = []
    for x in (-4.15, -2.6, -0.85, door[0] - 0.05, door[1], 3.25, 4.1):
        bars.append(((x, -4.82, 0.0 if x in (door[0] - 0.05, door[1]) else 0.45), (x + 0.05, -4.73, 2.55)))
    bars += [((-4.15, -4.82, 0.43), (door[0], -4.73, 0.48)), ((door[1], -4.82, 0.43), (4.15, -4.73, 0.48)),
             ((-4.15, -4.82, 2.5), (4.15, -4.73, 2.56)), ((door[0], -4.82, 2.4), (door[1], -4.73, 2.45))]
    K.boxes('SM_Shopfront_Frame', bars, m['steel_black'], COL, bevel=0.004)
    K.box('SM_Shopfront_Glass_L', (-4.1, -4.778, 0.48), (door[0] - 0.05, -4.772, 2.5), m['glass'], COL)
    K.box('SM_Shopfront_Glass_R', (door[1] + 0.05, -4.778, 0.48), (4.1, -4.772, 2.5), m['glass'], COL)
    K.box('SM_Shopfront_Glass_Top', (door[0], -4.778, 2.45), (door[1], -4.772, 2.5), m['glass'], COL)
    quad('SM_Decal_Window', (-1.72, -4.785, 1.62), (1.9, 0.475), '-Y', m['decal'])
    # The door, built closed along -X from its hinge, then swung into the café.
    w = door[1] - door[0] - 0.04
    leaf = [local_box('SM_Door_Frame', (-w, -0.03, 0.0), (0.0, 0.0, 2.38), m['steel_black'], bevel=0.004)]
    leaf.append(local_box('SM_Door_Glass', (-w + 0.07, -0.018, 0.12), (-0.07, -0.012, 2.3), m['glass']))
    leaf.append(local_box('SM_Door_Handle', (-w + 0.12, -0.08, 0.9), (-w + 0.15, 0.05, 1.35), m['brass'],
                          bevel=0.006))
    # The frame box is solid; cut the glass window out of it by turning the frame into four bars instead.
    bpy.data.objects.remove(leaf[0])
    leaf[0] = K.boxes('SM_Door_Frame', [((-w, -0.03, 0.0), (0.0, 0.0, 0.12)), ((-w, -0.03, 2.3), (0.0, 0.0, 2.38)),
                                        ((-w, -0.03, 0.0), (-w + 0.07, 0.0, 2.38)),
                                        ((-0.07, -0.03, 0.0), (0.0, 0.0, 2.38))], m['steel_black'], COL, bevel=0.004)
    hinge(leaf, (door[1] - 0.02, -4.74, 0.0), -78)
    # The office door, open into the office.
    office = [local_box('SM_Office_Door', (0.0, 0.0, 0.0), (0.04, 0.88, 2.15), m['oak'], bevel=0.004),
              local_box('SM_Office_Door_Handle', (0.04, 0.72, 0.98), (0.09, 0.82, 1.02), m['brass'], bevel=0.004)]
    hinge(office, (4.15, -3.38, 0.0), -72)
    K.boxes('SM_Skirting', [((-3.99, FRONT, 0), (-3.97, 2.6, 0.1)), ((-4.0, 2.58, 0), (4.0, 2.6, 0.1))],
            m['walnut'], COL)
    # The poster screen by the counter: what Xedine designs and posts, shown on a frame in the café too.
    screen('SM_Screen_Poster', (3.995, -1.55, 1.62), (0.5, 0.72), '-X', m, frame=0.035, depth=0.03)
    tag('ca_room')


def aframe(name, loc, rot_deg, m):
    """A standing chalk board with the name on it (both faces), built at the origin then placed."""
    parts = []
    lean = math.radians(12)
    for side, s in (('F', -1), ('B', 1)):
        board = local_box(f'{name}_{side}_Wood', (-0.33, -0.012, 0.0), (0.33, 0.012, 0.98), m['walnut'], bevel=0.006)
        face = quad(f'{name}_{side}_Chalk', (0, -0.013 if s < 0 else 0.013, 0.5), (0.58, 0.87),
                    '-Y' if s < 0 else '+Y', m['aframe'])
        for o in (board, face):
            o.data.transform(Matrix.Rotation(lean * s, 4, 'X'))
            o.data.transform(Matrix.Translation((0, s * 0.2, 0)))
            parts.append(o)
    for o in parts:
        o.location = loc
        o.rotation_euler = (0, 0, math.radians(rot_deg))
    return parts


def qr_stand(name, loc, rot_deg, m):
    """The table's QR card on an acrylic stand, big enough to see across the room (the founder, 2026-11-17)."""
    base = local_box(f'{name}_Base', (-0.085, -0.04, 0.0), (0.085, 0.04, 0.014), m['acrylic'], bevel=0.004)
    card = quad(f'{name}_Card', (0, -0.003, 0.125), (0.14, 0.21), '-Y', m['qr'])
    back = local_box(f'{name}_Back', (-0.076, 0.0, 0.014), (0.076, 0.005, 0.236), m['acrylic'])
    for o in (base, card, back):
        o.location = loc
        o.rotation_euler = (0, 0, math.radians(rot_deg))


def build_dining(m):
    tx, ty = -2.35, -0.55
    place('round_wooden_table_01', (tx, ty, 0), scale=(0.55, 0.55, 0.75))
    # The scan's seat faces its local -x after these turns: each chair faces the table, its back away from
    # it, pulled out far enough that a seated guest clears the top (the founder, 2026-11-17).
    place('painted_wooden_chair_01', (tx - 0.75, ty, 0), rot=90, name='chair_a')
    place('painted_wooden_chair_01', (tx + 0.75, ty, 0), rot=-90, name='chair_b')
    qr_stand('SM_QR_Corner', (tx + 0.12, ty + 0.2, 0.75), 160, m)
    place('potted_plant_01', (-3.45, 2.1, 0), scale=1.3)
    place('metal_stool_03', (-3.45, -1.15, 0), rot=10)
    place('metal_stool_01', (-3.45, 0.85, 0), rot=-20)
    for i, (x, y) in enumerate(((1.1, 0.6), (1.7, 0.62), (2.3, 0.6))):
        place('metal_stool_01', (x - 0.2, y - 0.1, 0), rot=15 * i, name=f'counter_stool_{i}')
    # Two tables by the shop window, for the lunch rush.
    for i, x in enumerate((-3.05, -0.95)):
        y = -3.75
        place('round_wooden_table_02', (x, y, 0), name=f'table_front_{i}')
        # Facing the table; 0.68 m out keeps the window-side chair inside the wall.
        place('painted_wooden_chair_01', (x - 0.68, y, 0), rot=90, name=f'chair_front_{i}_a')
        place('painted_wooden_chair_01', (x + 0.68, y, 0), rot=-90, name=f'chair_front_{i}_b')
        qr_stand(f'SM_QR_Front_{i}', (x + 0.15, y + 0.12, 0.75), 200, m)
    aframe('SM_Aframe_In', (0.15, -2.6, 0.0), 30, m)
    for i, y in enumerate((-2.55, 0.3)):
        place('ceiling_fan', (-2.2, y, CEIL - 0.52), name=f'ceiling_fan_{i}')
    tag('ca_dining')


def build_cafe(m):
    build_cafe_room(m)
    K.build_counter(COL, m)
    tag('ca_counter')
    K.build_back_wall(COL, m)
    bpy.data.objects['SM_Menu_Board']['atlas'] = 'ca_menu'
    tag('ca_counter')
    K.build_counter_props(COL, m)
    bpy.data.objects['SM_Till_Screen'].name = 'SM_Screen_Till'
    K.build_back_props(COL, m)
    tag('ca_props')
    build_dining(m)
    table = bpy.data.objects['round_wooden_table_01']
    K.build_meal(COL, m, (-2.35, -0.55, table.dimensions.z))
    tag('ca_dining')


# ---------------------------------------------------------------- the kitchen

def build_kitchen(m):
    x0, x1, y0, y1 = 4.15, EAST, -1.0, 2.6
    K.box('SM_Floor_Kitchen', (x0, y0, -0.06), (x1, y1, 0), m['kitchen_floor'], COL)
    K.box('SM_Ceiling_Kitchen', (x0, y0, CEIL), (EAST_OUT, y1 + 0.15, CEIL + 0.1), m['ceiling'], COL)
    K.box('SM_Wall_Kitchen_South', (x0, y0 - 0.15, 0), (x1, y0, CEIL), m['kitchen_wall'], COL)
    K.box('SM_Wall_Kitchen_North_A', (x0, y1, 0), (8.45, y1 + 0.15, CEIL), m['kitchen_wall'], COL)
    K.box('SM_Wall_Kitchen_North_B', (9.35, y1, 0), (x1, y1 + 0.15, CEIL), m['kitchen_wall'], COL)
    K.box('SM_Wall_Kitchen_North_Top', (8.45, y1, 2.2), (9.35, y1 + 0.15, CEIL), m['kitchen_wall'], COL)
    K.box('SM_Wall_Kitchen_East', (x1, y0 - 0.15, 0), (EAST_OUT, y1 + 0.15, CEIL), m['kitchen_wall'], COL)
    K.box('SM_Tiles_Kitchen', (x0, y1 - 0.015, 0.0), (8.42, y1, 2.05), m['white_tiles'], COL)
    for i, x in enumerate((5.6, 7.7)):
        K.box(f'SM_Light_Panel_Kitchen_{i}', (x - 0.6, 0.5, CEIL - 0.025), (x + 0.6, 1.1, CEIL), m['panel'], COL)
    tag('ki_room')
    # The cooking line along the back wall: bench, fryer, griddle, range, bench; the hood above.
    ly0, ly1 = 1.78, 2.585
    K.box('SM_Line_Kick', (4.3, ly0 + 0.05, 0), (8.35, ly1, 0.1), m['rubber'], COL)
    for name, xa, xb, top in (('Bench_L', 4.3, 5.0, 0.88), ('Fryer', 5.0, 5.6, 0.9), ('Griddle', 5.6, 6.6, 0.86),
                              ('Range', 6.6, 7.6, 0.88), ('Bench_R', 7.6, 8.35, 0.88)):
        K.box(f'SM_Line_{name}', (xa + 0.004, ly0, 0.1), (xb - 0.004, ly1, top), m['stainless'], COL, bevel=0.008)
    for name, xa, xb in (('Bench_L_Top', 4.28, 5.0), ('Bench_R_Top', 7.6, 8.37)):
        K.box(f'SM_Line_{name}', (xa, ly0 - 0.03, 0.88), (xb, ly1, 0.92), m['stainless'], COL, bevel=0.005)
    K.box('SM_Fryer_Oil', (5.07, ly0 + 0.09, 0.86), (5.53, ly1 - 0.1, 0.875), m['oil'], COL)
    baskets = []
    for bx in (5.08, 5.32):
        baskets += [((bx, ly0 + 0.12, 0.84), (bx + 0.2, ly0 + 0.42, 0.85)), ((bx, ly0 + 0.12, 0.84), (bx + 0.012, ly0 + 0.42, 0.96)),
                    ((bx + 0.188, ly0 + 0.12, 0.84), (bx + 0.2, ly0 + 0.42, 0.96)),
                    ((bx + 0.09, ly0 - 0.12, 0.95), (bx + 0.11, ly0 + 0.14, 0.97))]
    K.boxes('SM_Fryer_Baskets', baskets, m['steel_black'], COL)
    K.box('SM_Griddle_Plate', (5.63, ly0 + 0.05, 0.86), (6.57, ly1 - 0.08, 0.89), m['steel_black'], COL)
    for i, gx in enumerate((5.85, 6.1, 6.35)):
        K.cylinder(f'SM_Griddle_Patty_{i}', (gx, 2.1, 0.89), 0.055, 0.053, 0.018, m['patty'], COL, segments=24)
    K.box('SM_Range_Oven_Window', (6.72, ly0 - 0.006, 0.28), (7.48, ly0, 0.6), m['window_dark'], COL)
    K.box('SM_Range_Oven_Handle', (6.75, ly0 - 0.05, 0.66), (7.45, ly0 - 0.02, 0.69), m['stainless'], COL,
          bevel=0.006)
    for i, kx in enumerate((6.72, 6.9, 7.3, 7.48)):
        k = K.cylinder(f'SM_Range_Knob_{i}', (kx, ly0 - 0.002, 0.78), 0.022, 0.02, 0.03, m['steel_black'], COL,
                       segments=16)
        k.rotation_euler = (math.radians(90), 0, 0)
    for i, (bx, by) in enumerate(((6.85, 1.98), (7.35, 1.98), (6.85, 2.35), (7.35, 2.35))):
        K.cylinder(f'SM_Range_Burner_{i}', (bx, by, 0.88), 0.12, 0.12, 0.022, m['steel_black'], COL, segments=24)
    K.box('SM_Hood', (4.95, 1.55, 2.05), (8.4, ly1, 2.55), m['stainless'], COL, bevel=0.01)
    K.box('SM_Hood_Light', (5.1, 1.62, 2.044), (8.25, 1.7, 2.05), m['led'], COL)
    screen('SM_Screen_Kds', (4.72, 2.585, 1.6), (0.84, 0.48), '-Y', m, frame=0.026, depth=0.03)
    # The prep table in the middle.
    K.box('SM_Prep_Top', (5.3, 0.05, 0.88), (7.6, 0.8, 0.92), m['stainless'], COL, bevel=0.006)
    K.box('SM_Prep_Shelf', (5.36, 0.1, 0.18), (7.54, 0.75, 0.21), m['stainless'], COL)
    K.boxes('SM_Prep_Legs', [((x, y, 0), (x + 0.04, y + 0.04, 0.88)) for x in (5.34, 7.52) for y in (0.08, 0.68)],
            m['stainless'], COL)
    # The fridge and the sink by the alley wall.
    K.box('SM_Fridge', (8.75, -0.95, 0.0), (9.58, -0.05, 2.0), m['stainless'], COL, bevel=0.012)
    K.boxes('SM_Fridge_Handles', [((8.73, -0.55, 1.0), (8.75, -0.52, 1.6)), ((8.73, -0.48, 1.0), (8.75, -0.45, 1.6))],
            m['steel_black'], COL)
    K.box('SM_Fridge_Gap', (8.745, -0.505, 0.05), (8.75, -0.495, 1.95), m['rubber'], COL)
    K.box('SM_Sink_Base', (8.95, 0.1, 0.1), (9.58, 1.25, 0.88), m['stainless'], COL, bevel=0.008)
    K.box('SM_Sink_Top', (8.92, 0.08, 0.88), (9.6, 1.27, 0.92), m['stainless'], COL, bevel=0.005)
    K.box('SM_Sink_Basin', (9.02, 0.3, 0.905), (9.48, 1.0, 0.922), m['steel_black'], COL)
    K.cylinder('SM_Sink_Tap', (9.5, 0.65, 0.92), 0.018, 0.016, 0.32, m['stainless'], COL, segments=16)
    K.box('SM_Sink_Spout', (9.3, 0.635, 1.21), (9.52, 0.665, 1.24), m['stainless'], COL, bevel=0.008)
    # The wall shelf over the prep table, the waste bin with its pedal.
    K.box('SM_Wall_Shelf_Kitchen', (6.0, -1.0, 1.72), (8.3, -0.72, 1.75), m['stainless'], COL, bevel=0.003)
    K.cylinder('SM_Waste_Bin', (7.95, 0.45, 0.0), 0.17, 0.17, 0.6, m['grey_plastic'], COL, segments=32)
    K.cylinder('SM_Waste_Bin_Lid', (7.95, 0.45, 0.6), 0.175, 0.17, 0.035, m['steel_black'], COL, segments=32)
    K.box('SM_Waste_Bin_Pedal', (7.9, 0.24, 0.0), (8.0, 0.29, 0.03), m['steel_black'], COL)
    # The food safety tablet and the daily checklist by the door. The clipboard hangs flat on the wall (a scan
    # laid on its back stuck through into the office: the stray black line, 2026-11-17).
    screen('SM_Screen_Safety', (4.95, -1.0, 1.45), (0.54, 0.36), '+Y', m, frame=0.022, depth=0.016)
    K.box('SM_Clipboard', (5.34, -1.0, 1.22), (5.58, -0.988, 1.56), m['kraft'], COL, bevel=0.004)
    K.box('SM_Clipboard_Clip', (5.42, -0.99, 1.5), (5.5, -0.976, 1.565), m['steel_black'], COL, bevel=0.003)
    quad('SM_Paper_Checklist', (5.46, -0.9865, 1.37), (0.2, 0.27), '+Y', m['checklist'])
    tag('ki_line')
    # On the line and the prep table: pans, pots, the burger station (buns, cheese, the scale).
    place('pot_enamel_01', (6.85, 2.35, 0.9), rot=20)
    place('brass_pot_01', (7.35, 2.35, 0.9), scale=0.75, rot=-10)
    place('brass_pan_01', (7.98, 2.15, 0.92), rot=60)
    place('wooden_spoon', (7.78, 1.95, 0.92), rot=-30)
    for i, (ox, oy) in enumerate(((8.15, 2.4), (8.25, 2.32), (8.08, 2.3))):
        place('yellow_onion', (ox, oy, 0.92), rot=i * 50, name=f'yellow_onion_line_{i}')
    place('wooden_cutting_board', (6.0, 0.42, 0.92), rot=0)
    K.box('SM_Cheese_Block', (6.38, 0.5, 0.92), (6.6, 0.64, 0.99), m['cheese'], COL, bevel=0.004)
    K.boxes('SM_Cheese_Slices', [((6.66 + i * 0.012, 0.47, 0.92 + i * 0.004), (6.76 + i * 0.012, 0.57, 0.924 + i * 0.004))
                                 for i in range(3)], m['cheese'], COL)
    K.box('SM_Scale_Body', (6.5, 0.15, 0.92), (6.72, 0.33, 0.955), m['device'], COL, bevel=0.006)
    K.box('SM_Scale_Plate', (6.52, 0.19, 0.955), (6.7, 0.32, 0.962), m['stainless'], COL, bevel=0.003)
    screen('SM_Screen_Scale', (6.61, 0.148, 0.937), (0.08, 0.024), '-Y', m, frame=0.003, depth=0.002)
    buns = K.load_model('hamburger_buns', join=False)
    for i in range(4):
        b = buns[0].copy()
        b.name = f'SM_Prep_Bun_{i}'
        b['scan'] = 1
        COL.objects.link(b)
        b.location = (7.0 + (i % 2) * 0.13, 0.32 + (i // 2) * 0.14, 0.92)
    K.box('SM_Fries_Tray', (5.45, 0.15, 0.92), (5.8, 0.42, 0.95), m['stainless'], COL, bevel=0.004)
    fries = [((5.5 + (i % 7) * 0.04, 0.2 + (i // 7) * 0.07, 0.945), (5.51 + (i % 7) * 0.04, 0.27 + (i // 7) * 0.07, 0.957))
             for i in range(21)]
    K.boxes('SM_Fries_Tray_Fries', fries, m['fries'], COL, bevel=0.002)
    for i in range(4):
        K.lathe_object(f'SM_Plate_Stack_{i}', K.PLATE, m['ceramic'], COL, (6.4, -0.86, 1.75 + i * 0.018))
    for i, x in enumerate((7.0, 7.25, 7.5, 7.75)):
        K.cylinder(f'SM_Shelf_Tub_{i}', (x, -0.86, 1.75), 0.09, 0.09, 0.16, m['stainless'], COL, segments=24)
    tag('ki_props')
    # Fries on the floor, spilled from their red carton: shown live only when the cook drops them (the waste
    # beat). Live and left out of the bake, so no shadow waits on the floor before they fall (2026-11-17).
    fx, fy = 5.95, -0.25
    drops = []
    for i in range(20):
        a = i * 2.39
        r = 0.04 + 0.15 * ((i * 7) % 11) / 10
        x, y = fx + r * math.cos(a), fy + r * 0.75 * math.sin(a)
        dx, dy = (0.045, 0.009) if i % 2 else (0.009, 0.045)
        drops.append(((x - dx, y - dy, 0.0), (x + dx, y + dy, 0.017)))
    K.boxes('SM_Live_Fries_Floor', drops, m['fries'], COL, bevel=0.003)
    carton = local_box('SM_Live_Fries_Box', (-0.065, -0.04, 0.0), (0.065, 0.04, 0.14), m['ketchup'], bevel=0.006)
    carton.location = (fx - 0.24, fy + 0.12, 0.04)
    carton.rotation_euler = (math.radians(90), 0, math.radians(-25))
    tag('ki_props')


# ---------------------------------------------------------------- the storeroom

def shelving(name, x0, y0, x1, y1, levels, m):
    """Steel wire shelving: four posts, a shelf at every level."""
    posts = [((x, y, 0), (x + 0.03, y + 0.03, levels[-1] + 0.05)) for x in (x0, x1 - 0.03) for y in (y0, y1 - 0.03)]
    shelves = [((x0, y0, z), (x1, y1, z + 0.025)) for z in levels]
    K.boxes(f'{name}_Posts', posts, m['steel_black'], COL)
    K.boxes(f'{name}_Shelves', shelves, m['stainless'], COL, bevel=0.003)


def soft_box(name, lo, hi, mat, bevel=0.035):
    return K.box(name, lo, hi, mat, COL, bevel=bevel)


def build_store(m):
    x0, x1, y0, y1 = 4.15, EAST, 2.75, NORTH
    K.box('SM_Floor_Store', (x0, y0, -0.06), (x1, y1, 0), m['store_floor'], COL)
    K.box('SM_Ceiling_Store', (x0 - 0.15, y0, CEIL), (EAST_OUT, NORTH_OUT, CEIL + 0.1), m['ceiling'], COL)
    K.box('SM_Wall_Store_West', (x0 - 0.15, y0, 0), (x0, y1, CEIL), m['store_wall'], COL)
    K.box('SM_Wall_Store_North', (x0 - 0.15, y1, 0), (EAST_OUT, NORTH_OUT, CEIL), m['store_wall'], COL)
    K.box('SM_Wall_Store_East_A', (x1, y0, 0), (EAST_OUT, 4.1, CEIL), m['store_wall'], COL)
    K.box('SM_Wall_Store_East_B', (x1, 5.1, 0), (EAST_OUT, y1, CEIL), m['store_wall'], COL)
    K.box('SM_Wall_Store_East_Top', (x1, 4.1, 2.2), (EAST_OUT, 5.1, CEIL), m['store_wall'], COL)
    K.boxes('SM_Back_Door_Frame', [((x1 - 0.03, 4.04, 0), (EAST_OUT + 0.03, 4.1, 2.26)),
                                   ((x1 - 0.03, 5.1, 0), (EAST_OUT + 0.03, 5.16, 2.26)),
                                   ((x1 - 0.03, 4.04, 2.2), (EAST_OUT + 0.03, 5.16, 2.26))], m['steel_black'], COL)
    K.box('SM_Light_Panel_Store', (6.3, 4.1, CEIL - 0.025), (7.5, 4.7, CEIL), m['panel'], COL)
    # The back door, propped open to the alley: deliveries and staff come in here.
    leaf = [local_box('SM_Back_Door', (0.0, 0.0, 0.0), (0.045, 0.98, 2.16), m['door_steel'], bevel=0.005),
            local_box('SM_Back_Door_Bar', (0.045, 0.1, 0.95), (0.08, 0.85, 1.0), m['stainless'], bevel=0.006)]
    hinge(leaf, (EAST_OUT, 4.12, 0.0), -100)
    screen('SM_Screen_Staff', (x1, 3.48, 1.45), (0.48, 0.32), '-X', m, frame=0.02, depth=0.016)
    screen('SM_Screen_Stock', (7.1, y1, 1.62), (0.9, 0.52), '-Y', m, frame=0.025, depth=0.03)
    tag('sr_room')
    levels = (0.15, 0.6, 1.05, 1.5, 1.95)
    shelving('SM_Shelving_A', 4.45, 5.72, 6.35, 6.22, levels, m)
    shelving('SM_Shelving_B', 7.85, 5.72, 9.4, 6.22, levels, m)
    shelving('SM_Shelving_C', 4.18, 4.15, 4.68, 5.55, levels, m)
    top = lambda z: z + 0.025  # noqa: E731
    # A: sacks (flour, rice), crates of onions and potatoes, boxes, bags of buns, oil.
    for i in range(3):
        soft_box(f'SM_Sack_{i}', (4.55 + i * 0.6, 5.78, top(0.15)), (5.05 + i * 0.6, 6.15, top(0.15) + 0.3), m['sack'],
                 bevel=0.06)
    for i in range(2):
        place('plastic_crate_02', (4.95 + i * 0.85, 5.97, top(0.6)), name=f'plastic_crate_02_{i}')
        produce = 'yellow_onion' if i == 0 else 'sweet_potato'
        for j in range(6):
            place(produce, (4.8 + i * 0.85 + (j % 3) * 0.12, 5.9 + (j // 3) * 0.12, top(0.6) + 0.17),
                  rot=j * 40, name=f'{produce}_crate_{i}_{j}')
    for i in range(3):
        place('cardboard_box_01', (4.75 + i * 0.6, 5.97, top(1.05)), rot=90, scale=0.95, name=f'cardboard_box_{i}')
    for i in range(4):
        soft_box(f'SM_Bun_Bag_{i}', (4.55 + i * 0.45, 5.8, top(1.5)), (4.93 + i * 0.45, 6.12, top(1.5) + 0.2),
                 m['bun_bag'], bevel=0.05)
    for i in range(4):
        place('plastic_bottle_gallon', (4.7 + i * 0.4, 5.97, top(1.95)), rot=i * 20, name=f'gallon_{i}')
    # B: milk churns, baskets, bananas, tins, coffee bags.
    place('wooden_crate_01', (8.62, 5.97, top(0.15)), part=0, name='wooden_crate_store')
    for i in range(2):
        place('metal_jug', (8.25 + i * 0.75, 5.97, top(0.6)), name=f'milk_churn_{i}')
    place('wicker_basket_01', (8.6, 5.97, top(1.05)), name='wicker_basket_onions')
    for j in range(5):
        place('yellow_onion', (8.45 + (j % 3) * 0.1, 5.92 + (j // 3) * 0.1, top(1.05) + 0.04), rot=j * 60,
              name=f'yellow_onion_basket_{j}')
    place('bananas', (8.1, 5.97, top(1.5)), part=2, name='bananas_bunch')
    for i in range(6):
        K.cylinder(f'SM_Tin_{i}', (8.6 + (i % 3) * 0.13, 5.88 + (i // 3) * 0.14, top(1.5)), 0.05, 0.05, 0.12, m['tin'],
                   COL, segments=20)
    for i in range(3):
        soft_box(f'SM_Coffee_Bag_{i}', (7.95 + i * 0.45, 5.82, top(1.95)), (8.3 + i * 0.45, 6.1, top(1.95) + 0.28),
                 m['beans_bag'], bevel=0.04)
    # C (by the west wall): sauces, sugar, paper cups.
    for i in range(4):
        K.cylinder(f'SM_Bottle_Ketchup_{i}', (4.33 + (i % 2) * 0.17, 4.35 + (i // 2) * 0.2, top(0.6)), 0.045, 0.04,
                   0.2, m['ketchup'], COL, segments=20)
        K.cylinder(f'SM_Bottle_Mustard_{i}', (4.33 + (i % 2) * 0.17, 4.85 + (i // 2) * 0.2, top(0.6)), 0.045, 0.04,
                   0.2, m['mustard'], COL, segments=20)
    for i in range(3):
        soft_box(f'SM_Sugar_{i}', (4.24, 4.3 + i * 0.4, top(1.05)), (4.62, 4.62 + i * 0.4, top(1.05) + 0.22),
                 m['kraft'], bevel=0.02)
        K.cylinder(f'SM_Cup_Stack_{i}', (4.43, 4.45 + i * 0.4, top(1.5)), 0.05, 0.045, 0.35, m['ceramic'], COL,
                   segments=24)
    for i in range(2):
        soft_box(f'SM_Store_Box_{i}', (4.22, 4.25 + i * 0.6, top(0.15)), (4.64, 4.75 + i * 0.6, top(0.15) + 0.32),
                 m['kraft'], bevel=0.01)
    # Today's delivery by the back door: crates stacked, boxes waiting to be shelved.
    for i in range(3):
        place('plastic_crate_02', (8.95, 3.25, i * 0.245), rot=90 + (i % 2) * 6, name=f'plastic_crate_02_floor_{i}')
    for i, (x, y, r) in enumerate(((6.1, 3.15, 10), (6.55, 3.1, -8), (6.3, 3.18, 25))):
        place('cardboard_box_01', (x, y, 0.0 if i < 2 else 0.34), rot=r, name=f'cardboard_box_floor_{i}')
    # The dairy fridge: glass door, milk cartons, cheese, lit inside.
    fx0, fx1, fy0, fy1 = 4.2, 4.95, 2.95, 3.85
    K.box('SM_Dairy_Body', (fx0, fy0, 0.0), (fx0 + 0.04, fy1, 2.0), m['stainless'], COL)
    K.box('SM_Dairy_Top', (fx0, fy0, 1.9), (fx1, fy1, 2.0), m['stainless'], COL)
    K.box('SM_Dairy_Base', (fx0, fy0, 0.0), (fx1, fy1, 0.18), m['stainless'], COL)
    K.boxes('SM_Dairy_Sides', [((fx0, fy0, 0), (fx1, fy0 + 0.04, 2.0)), ((fx0, fy1 - 0.04, 0), (fx1, fy1, 2.0))],
            m['stainless'], COL)
    K.boxes('SM_Dairy_Shelves', [((fx0 + 0.04, fy0 + 0.04, z), (fx1 - 0.05, fy1 - 0.04, z + 0.015))
                                 for z in (0.5, 0.95, 1.4)], m['tin'], COL)
    K.box('SM_Dairy_Glow', (fx0 + 0.041, fy0 + 0.1, 0.3), (fx0 + 0.045, fy1 - 0.1, 1.85), m['fridge_glow'], COL)
    K.box('SM_Dairy_Door_Glass', (fx1 - 0.02, fy0 + 0.03, 0.2), (fx1 - 0.012, fy1 - 0.03, 1.88), m['glass'], COL)
    K.boxes('SM_Dairy_Door_Frame', [((fx1 - 0.025, fy0, 0.18), (fx1, fy1, 0.22)), ((fx1 - 0.025, fy0, 1.86), (fx1, fy1, 1.9)),
                                    ((fx1 - 0.025, fy1 - 0.12, 0.8), (fx1 + 0.03, fy1 - 0.1, 1.3))], m['steel_black'], COL)
    for level, z in enumerate((0.18, 0.515, 0.965)):
        for i in range(5):
            y = fy0 + 0.1 + i * 0.15
            if level < 2:
                K.box(f'SM_Milk_{level}_{i}', (4.42, y, z), (4.5, y + 0.08, z + 0.2), m['milk'], COL, bevel=0.004)
                K.box(f'SM_Milk_Band_{level}_{i}', (4.419, y - 0.001, z + 0.06), (4.501, y + 0.081, z + 0.1),
                      m['band_blue'] if i % 2 else m['band_green'], COL)
            else:
                K.box(f'SM_Cheese_Pack_{i}', (4.36, y, z), (4.6, y + 0.12, z + 0.07), m['cheese'], COL, bevel=0.006)
    tag('sr_goods')


# ---------------------------------------------------------------- the office

def build_office(m):
    x0, x1, y0, y1 = 4.15, EAST, FRONT, -1.15
    K.box('SM_Floor_Office', (x0, y0, -0.06), (x1, y1, 0), m['office_floor'], COL)
    K.box('SM_Ceiling_Office', (x0, FACADE, CEIL), (EAST_OUT, y1, CEIL + 0.1), m['ceiling'], COL)
    wx0, wx1, wz0, wz1 = 5.6, 8.4, 1.0, 2.4
    for name, lo, hi in (('L', (x0, FACADE, 0), (wx0, y0, CEIL)), ('R', (wx1, FACADE, 0), (EAST_OUT, y0, CEIL)),
                         ('Low', (wx0, FACADE, 0), (wx1, y0, wz0)), ('High', (wx0, FACADE, wz1), (wx1, y0, CEIL))):
        K.box(f'SM_Wall_Office_South_{name}', lo, hi, m['plaster'], COL)
    K.box('SM_Wall_Office_East', (x1, FACADE, 0), (EAST_OUT, y1, CEIL), m['office_wall'], COL)
    K.boxes('SM_Office_Window_Frame', [((wx0, -4.8, wz0), (wx1, -4.74, wz0 + 0.05)), ((wx0, -4.8, wz1 - 0.05), (wx1, -4.74, wz1)),
                                       ((wx0, -4.8, wz0), (wx0 + 0.05, -4.74, wz1)), ((wx1 - 0.05, -4.8, wz0), (wx1, -4.74, wz1))],
            m['steel_black'], COL, bevel=0.003)
    # Two casements that open outward, so Xedine flies out to the city through an open window at night (the
    # page swings them on their hinges; the founder, 2026-11-17). Built closed around each hinge.
    sw, sh = (wx1 - wx0) / 2 - 0.05, wz1 - wz0 - 0.1
    for side, hinge_x, s in (('L', wx0 + 0.05, 1), ('R', wx1 - 0.05, -1)):
        bars = []
        for a, b, z0, z1 in ((0.0, sw, 0.0, 0.04), (0.0, sw, sh - 0.04, sh), (0.0, 0.04, 0.0, sh), (sw - 0.025, sw, 0.0, sh)):
            bars.append(((min(s * a, s * b), -0.02, z0), (max(s * a, s * b), 0.02, z1)))
        frame = K.boxes(f'SM_Live_Office_Sash_{side}', bars, m['steel_black'], COL, bevel=0.003)
        glass = local_box(f'SM_Live_Office_Sash_{side}_Glass', (min(s * 0.03, s * (sw - 0.02)), -0.003, 0.03),
                          (max(s * 0.03, s * (sw - 0.02)), 0.003, sh - 0.03), m['glass'])
        for o in (frame, glass):
            o.location = (hinge_x, -4.772, wz0 + 0.05)
    K.box('SM_Office_Window_Sill', (wx0 - 0.05, -4.72, wz0 - 0.04), (wx1 + 0.05, -4.5, wz0), m['oak'], COL, bevel=0.005)
    # The blinds: the rail stays, the slats (built from the rail down) fold up when the window opens.
    K.box('SM_Office_Blinds_Rail', (wx0 + 0.04, -4.68, 2.38), (wx1 - 0.04, -4.58, 2.43), m['frame_white'], COL)
    slats = [((wx0 + 0.05 - 7.0, -0.03, z - 2.38), (wx1 - 0.05 - 7.0, 0.03, z - 2.38 + 0.012))
             for z in [1.45 + i * 0.07 for i in range(14)]]
    K.boxes('SM_Live_Office_Blinds', slats, m['frame_white'], COL).location = (7.0, -4.63, 2.38)
    K.box('SM_Light_Panel_Office', (6.2, -3.3, CEIL - 0.025), (7.4, -2.7, CEIL), m['panel'], COL)
    K.box('SM_Office_Rug', (5.2, -3.4, 0.0), (7.3, -1.9, 0.008), m['rug'], COL)
    frame_lo, frame_hi = on_wall((x1, -4.05, 1.72), '-X', 0.5, 0.38, 0.025)
    K.box('SM_Licence_Frame', frame_lo, frame_hi, m['walnut'], COL, bevel=0.004)
    quad('SM_Paper_Licence', (x1 - 0.027, -4.05, 1.72), (0.42, 0.3), '-X', m['licence'])
    tag('of_room')
    # The desk along the alley wall, facing the room; its monitor is the office screen. (Turned so its long
    # side runs along the wall: before, half of it stood inside the wall and the lamp hung off its end.)
    desk = place('metal_office_desk', (EAST - 0.5, -2.9, 0.0), rot=-90, name='office_desk')
    lo, hi = bounds(desk)
    desk.location += Vector((EAST - 0.006 - hi.x, -2.9 - (lo.y + hi.y) / 2, 0.0))
    desk_lo, desk_hi = bounds(desk)
    top = 0.79
    K.box('SM_Monitor_Foot', (9.12, -3.12, top), (9.32, -2.88, top + 0.012), m['device'], COL, bevel=0.004)
    K.box('SM_Monitor_Neck', (9.25, -3.02, top), (9.29, -2.98, top + 0.24), m['device'], COL)
    screen('SM_Screen_Office', (9.22, -3.0, top + 0.47), (0.74, 0.43), '-X', m, frame=0.02, depth=0.03)
    K.box('SM_Keyboard', (8.86, -3.22, top), (9.0, -2.78, top + 0.018), m['device'], COL, bevel=0.003)
    # The desk lamp stands on the desk's far end, all of it over the top, reaching toward the room (not in front
    # of the monitor).
    lamp = place('desk_lamp_arm_01', (9.3, -3.62, top), rot=-120, scale=0.85)
    lo, hi = bounds(lamp)
    lamp.location += Vector((max(0.0, desk_lo.x + 0.12 - lo.x) - max(0.0, hi.x - (desk_hi.x - 0.08)),
                             max(0.0, desk_lo.y + 0.06 - lo.y), top - lo.z))
    place('modern_arm_chair_01', (8.2, -3.0, 0.0), rot=90, scale=0.9, name='office_chair')
    place('sofa_02', (6.25, -1.62, 0.0), rot=0, name='office_sofa')
    place('modern_coffee_table_01', (6.25, -2.65, 0.0), rot=90)
    place('painted_wooden_shelves', (4.45, -4.25, 0.0), rot=90)
    for i in range(4):
        K.box(f'SM_Binder_{i}', (4.3, -4.45 + i * 0.06, 0.62), (4.56, -4.4 + i * 0.06, 0.92),
              m['binder_a'] if i % 2 else m['binder_b'], COL, bevel=0.004)
    K.lathe_object('SM_Office_Cup', K.CUP, m['ceramic'], COL, (6.4, -2.6, 0.39))
    place('potted_plant_02', (8.9, -4.33, 0.0), rot=0, name='potted_plant_office')
    tag('of_props')


# ---------------------------------------------------------------- the building and the street

def window_on(name, center, facing, w, h, m, lit=False):
    """An upper-floor window on a facade: dark glass in a white frame, a sill."""
    lo, hi = on_wall(center, facing, w, h, 0.02)
    K.box(f'{name}_Glass', lo, hi, m['window_lit'] if lit else m['window_dark'], COL)
    t = 0.06
    c = Vector(center)
    bars = []
    for dz in (-h / 2 + t / 2, h / 2 - t / 2):
        bars.append(on_wall(c + Vector((0, 0, dz)), facing, w, t, 0.07))
    for dr in (-w / 2 + t / 2, w / 2 - t / 2, 0.0):
        right = Vector((1, 0, 0)) if facing in ('-Y', '+Y') else Vector((0, 1, 0))
        bars.append(on_wall(c + right * dr, facing, t, h, 0.07))
    K.boxes(f'{name}_Frame', bars, m['frame_white'], COL, bevel=0.004)
    K.box(f'{name}_Sill', *on_wall(c - Vector((0, 0, h / 2 + 0.03)), facing, w + 0.16, 0.06, 0.12), m['plaster'],
          COL, bevel=0.006)


def build_building(m):
    # Ground floor outside skins: the side street wall (with the café window), the alley wall.
    y0, y1, z0, z1 = -1.7, 1.5, 0.95, 2.7
    for name, lo, hi in (('A', (-4.3, FACADE, 0), (-4.15, y0, CEIL + 0.1)), ('B', (-4.3, y1, 0), (-4.15, NORTH_OUT, CEIL + 0.1)),
                         ('Low', (-4.3, y0, 0), (-4.15, y1, z0)), ('High', (-4.3, y0, z1), (-4.15, y1, CEIL + 0.1))):
        K.box(f'SM_Facade_West_{name}', lo, hi, m['plaster'], COL)
    K.box('SM_Facade_North_Ground', (-4.3, NORTH, 0), (4.0, NORTH_OUT, CEIL + 0.1), m['plaster'], COL)
    # The upper floor and the parapet as one-sided walls, windows on them.
    quad('SM_Facade_South_Upper', (2.725, FACADE, (CEIL + 0.1 + PARAPET) / 2), (14.05, PARAPET - CEIL - 0.1), '-Y',
         m['plaster_upper'], uv=2.4)
    quad('SM_Facade_West_Upper', (-4.3, (FACADE + NORTH_OUT) / 2, (CEIL + 0.1 + PARAPET) / 2),
         (NORTH_OUT - FACADE, PARAPET - CEIL - 0.1), '-X', m['plaster_upper'], uv=2.4)
    quad('SM_Facade_East_Upper', (EAST_OUT, (FACADE + NORTH_OUT) / 2, (CEIL + 0.1 + PARAPET) / 2),
         (NORTH_OUT - FACADE, PARAPET - CEIL - 0.1), '+X', m['plaster_upper'], uv=2.4)
    # The alley wall, around the open back door (y 4.1..5.1, up to 2.2 m).
    for name, ya, yb, za, zb in (('A', FACADE, 4.04, 0.0, CEIL + 0.1), ('B', 5.16, NORTH_OUT, 0.0, CEIL + 0.1),
                                 ('Top', 4.04, 5.16, 2.26, CEIL + 0.1)):
        quad(f'SM_Facade_East_Ground_{name}', (EAST_OUT + 0.001, (ya + yb) / 2, (za + zb) / 2), (yb - ya, zb - za), '+X',
             m['plaster'], uv=2.4)
    quad('SM_Facade_North_Upper', (2.725, NORTH_OUT, (CEIL + 0.1 + PARAPET) / 2), (14.05, PARAPET - CEIL - 0.1), '+Y',
         m['plaster_upper'], uv=2.4)
    K.box('SM_Cornice', (-4.42, FACADE - 0.12, CEIL + 0.05), (EAST_OUT + 0.12, FACADE, CEIL + 0.3), m['frame_white'],
          COL, bevel=0.01)
    K.box('SM_Cornice_West', (-4.42, FACADE, CEIL + 0.05), (-4.3, NORTH_OUT, CEIL + 0.3), m['frame_white'], COL,
          bevel=0.01)
    K.box('SM_Parapet_Cap', (-4.4, FACADE - 0.1, PARAPET), (EAST_OUT + 0.1, NORTH_OUT + 0.1, PARAPET + 0.08),
          m['frame_white'], COL)
    K.box('SM_Roof', (-4.3, FACADE, ROOF), (EAST_OUT, NORTH_OUT, ROOF + 0.12), m['concrete'], COL)
    K.cylinder('SM_Roof_Tank', (7.3, 4.4, ROOF + 0.12), 0.65, 0.62, 1.15, m['tank'], COL, segments=32)
    K.box('SM_Roof_Hut', (-2.6, 3.6, ROOF), (-0.8, 6.0, 9.0), m['plaster_upper'], COL)
    for i, x in enumerate((-2.95, -0.75, 1.45, 3.65, 6.0, 8.3)):
        window_on(f'SM_Win_S{i}', (x, FACADE, 4.95), '-Y', 1.15, 1.45, m, lit=i in (1, 4))
    for i, y in enumerate((-3.2, -0.4, 2.4, 5.0)):
        window_on(f'SM_Win_W{i}', (-4.3, y, 4.95), '-X', 1.15, 1.45, m, lit=i == 2)
    # The sign over the shop front: the chef logo and the name, lit at night.
    K.box('SM_Sign_Board', (-2.05, FACADE - 0.12, 2.66), (1.95, FACADE, 3.3), m['sign_board'], COL, bevel=0.012)
    logo = quad('SM_Sign_Logo', (-1.42, FACADE - 0.123, 2.98), (0.5, 0.5), '-Y', m['sign_logo'])
    letters = text_mesh('SM_Sign_Letters', 'Xedine', 0.6, 0.018, 0.003, m['sign_letters'])
    letters.location = (0.42, FACADE - 0.142, 2.96)
    del logo
    # The awning: stripes on top, the name on its edge.
    ya, yb = FACADE, FACADE - 1.3
    slab('SM_Awning', [(-4.12, ya, 2.6), (4.05, ya, 2.6), (4.05, yb, 2.27), (-4.12, yb, 2.27)], 0.02, m['awning'], uv=1.0)
    quad('SM_Awning_Edge', (-0.035, yb - 0.006, 2.14), (8.17, 0.26), '-Y', m['valance'])
    K.boxes('SM_Awning_Arms', [((x, ya - 1.28, 2.25), (x + 0.025, ya, 2.28)) for x in (-4.0, -0.04, 3.95)],
            m['steel_black'], COL)
    tag('st_facade')
    # The neighbours: a brick building across the alley with its shutters down at dawn.
    K.box('SM_Neighbour_East', (11.6, FACADE, ROAD), (22.0, 8.0, 9.6), m['brick'], COL)
    for i, x in enumerate((13.2, 16.0, 18.8)):
        window_on(f'SM_Win_N{i}', (x, FACADE, 5.0), '-Y', 1.2, 1.5, m, lit=i == 1)
        window_on(f'SM_Win_NU{i}', (x, FACADE, 7.7), '-Y', 1.2, 1.5, m)
    tag('st_facade')
    # The ground: pavements, kerbs, the road with its lane marks, the alley.
    K.box('SM_Road', (-14.0, -19.0, ROAD - 0.1), (26.0, -7.75, ROAD), m['asphalt'], COL)
    K.box('SM_Road_Side', (-14.0, -7.75, ROAD - 0.1), (-6.15, 16.0, ROAD), m['asphalt'], COL)
    K.box('SM_Pavement', (-6.0, -7.6, ROAD - 0.1), (26.0, FACADE, WALK), m['pavers'], COL)
    K.box('SM_Pavement_Side', (-6.0, FACADE, ROAD - 0.1), (-4.3, 16.0, WALK), m['pavers'], COL)
    K.boxes('SM_Kerbs', [((-6.15, -7.75, ROAD - 0.1), (26.0, -7.6, WALK + 0.005)),
                         ((-6.15, -7.6, ROAD - 0.1), (-6.0, 16.0, WALK + 0.005))], m['kerb'], COL)
    K.box('SM_Alley', (EAST_OUT, FACADE, ROAD - 0.1), (11.6, 8.0, WALK - 0.01), m['concrete'], COL)
    marks = [((x, -13.45, ROAD), (x + 1.6, -13.33, ROAD + 0.003)) for x in [-13.0 + i * 3.4 for i in range(12)]]
    marks += [((-10.15, y, ROAD), (-10.03, y + 1.6, ROAD + 0.003)) for y in [-5.0 + i * 3.4 for i in range(6)]]
    K.boxes('SM_Road_Marks', marks, m['road_line'], COL)
    K.box('SM_Pavement_Far', (-14.0, -21.0, ROAD - 0.1), (26.0, -19.0, WALK), m['pavers'], COL)
    tag('st_ground')
    # Street things: lamps, the terrace, the chalk board, a bench under the office window, a bin in the alley.
    for i, (x, y) in enumerate(((-3.2, -7.25), (6.4, -7.25), (-5.6, 2.8))):
        place('street_lamp_01', (x, y, WALK), rot=0 if i < 2 else 90, name=f'street_lamp_{i}')
        K.box(f'SM_Live_Lamp_Glow_{i}', (x - 0.09, y - 0.09, WALK + 3.42), (x + 0.09, y + 0.09, WALK + 3.66),
              m['lamp_glow'], COL)
    for i, x in enumerate((-2.9, -0.55)):
        place('outdoor_table_chair_set_01', (x, -6.05, WALK), rot=90, name=f'terrace_set_{i}')
    aframe('SM_Aframe_Out', (3.05, -6.25, WALK), -18, m)
    place('painted_wooden_bench', (7.0, -5.25, WALK), rot=0, name='street_bench')
    place('metal_trash_can', (10.95, 3.3, WALK - 0.01), part=0, name='alley_bin')
    place('rollershutter_window_01', (14.6, FACADE, WALK), part=0, name='shutter_window')
    place('rollershutter_door', (18.6, FACADE, WALK), part=0, name='shutter_door')
    place('rollershutter_window_01', (20.6, FACADE, WALK), part=0, name='shutter_window_2')
    tag('st_props')


# ---------------------------------------------------------------- light: day and night

def build_lights(m, scene):
    day = C.collection('COL_Light_Day')
    night = C.collection('COL_Light_Night')
    lamps = [((-0.45, 1.28), 1.92), ((0.85, 1.28), 1.92), ((2.1, 1.28), 1.92), ((-3.05, -3.75), 1.95),
             ((-0.95, -3.75), 1.95)]
    for i, ((x, y), z) in enumerate(lamps):
        lamp = place('modern_ceiling_lamp_01', (x, y, z), name=f'pendant_{i}')
        lamp['atlas'] = 'ca_props'
        height = lamp.dimensions.z
        if z + height < CEIL:
            K.cylinder(f'SM_Pendant_Cord_{i}', (x, y, z + height), 0.004, 0.004, CEIL - z - height, m['steel_black'],
                       COL, segments=8)['atlas'] = 'ca_props'
        for col, power in ((day, 30), (night, 52)):
            point_light(f'LGT_{col.name[10:]}_Pendant_{i}', (x, y, z + min(height, 0.4) * 0.35), power, '#FFB86E',
                        0.06, col)
    K.glow('modern_ceiling_globe', '#FFD49A', 5.0)
    K.glow('modern_ceiling_lamp_01_glass', '#FFD49A', 5.0)
    for col, power in ((day, 9), (night, 12)):
        case = bpy.data.objects.new(f'LGT_{col.name[10:]}_Case', bpy.data.lights.new('LGT_Case', 'AREA'))
        case.data.energy, case.data.size = power, 0.9
        case.data.color = C.lin('#FFD9A8')[:3]
        case.location = (-0.52, 1.3, 1.5)
        col.objects.link(case)
    # Work lights: kitchen, storeroom and office panels (on all day and at night).
    for col in (day, night):
        tag_name = col.name[10:]
        for i, x in enumerate((5.6, 7.7)):
            C.area_light(f'LGT_{tag_name}_Kitchen_{i}', (x, 0.8, CEIL - 0.05), (x, 0.8, 0), 150, 1.0, '#F4F6FF', col)
        C.area_light(f'LGT_{tag_name}_Hood', (6.7, 2.0, 2.0), (6.7, 2.0, 0), 90, 3.0, '#FFF1DD', col)
        C.area_light(f'LGT_{tag_name}_Store', (6.9, 4.4, CEIL - 0.05), (6.9, 4.4, 0), 110, 1.2, '#F4F6FF', col)
        C.area_light(f'LGT_{tag_name}_Dairy', (4.6, 3.4, 1.3), (5.5, 3.4, 1.0), 12, 0.6, '#EEF6FF', col)
        C.area_light(f'LGT_{tag_name}_Office', (6.8, -3.0, CEIL - 0.05), (6.8, -3.0, 0),
                     70 if col is day else 35, 1.2, '#FFF4E6', col)
    # Daylight: the sun and the sky.
    sun = bpy.data.objects.new('LGT_Day_Sun', bpy.data.lights.new('LGT_Day_Sun', 'SUN'))
    sun.data.energy = 6.0
    sun.data.angle = math.radians(1.2)
    sun.data.color = C.lin('#FFF0D8')[:3]
    sun.rotation_euler = Vector((0.82, 0.28, -0.5)).to_track_quat('-Z', 'Y').to_euler()
    day.objects.link(sun)
    # Night: the street lamps, the sign lit from below, the desk lamp, a faint moon.
    for i, (x, y) in enumerate(((-3.2, -7.25), (6.4, -7.25), (-5.6, 2.8))):
        point_light(f'LGT_Night_Street_{i}', (x, y, WALK + 3.5), 140, '#FFC27A', 0.12, night)
    C.area_light('LGT_Night_Sign', (0.0, FACADE - 0.9, 2.45), (0.0, FACADE, 3.0), 55, 3.6, '#FFF0D6', night)
    lo, hi = bounds(bpy.data.objects['desk_lamp_arm_01'])
    point_light('LGT_Night_Desk_Lamp', ((lo.x + hi.x) / 2, hi.y - 0.08, hi.z - 0.15), 14, '#FFCF94', 0.05, night)
    point_light('LGT_Night_Monitor', (8.95, -3.0, 1.2), 6, '#DDE4FF', 0.2, night)
    moon = bpy.data.objects.new('LGT_Night_Moon', bpy.data.lights.new('LGT_Night_Moon', 'SUN'))
    moon.data.energy = 0.08
    moon.data.color = C.lin('#9DB4E0')[:3]
    moon.rotation_euler = Vector((0.4, 0.6, -0.7)).to_track_quat('-Z', 'Y').to_euler()
    night.objects.link(moon)
    world = bpy.data.worlds.new('WLD_World')
    scene.world = world
    world.use_nodes = True
    return day, night


def set_time(scene, night):
    """Day: sun and sky; night: the lamps, the lit windows, a dark blue sky."""
    bpy.data.collections['COL_Light_Day'].hide_render = night
    bpy.data.collections['COL_Light_Night'].hide_render = not night
    bg = scene.world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = C.lin('#1A2333' if night else '#C9DCEC')
    bg.inputs['Strength'].default_value = 0.05 if night else 0.9
    lit = bpy.data.materials['MAT_Window_Lit'].node_tree.nodes['Principled BSDF']
    lit.inputs['Emission Strength'].default_value = 2.6 if night else 0.0
    glow = bpy.data.materials['MAT_Lamp_Glow'].node_tree.nodes['Principled BSDF']
    glow.inputs['Emission Strength'].default_value = 6.0 if night else 0.0


CAMERAS = {
    'street': ((1.4, -14.5, 1.75), (0.6, -4.8, 2.7), 22),
    'dining': ((3.6, -4.4, 1.6), (-2.5, -1.4, 1.0), 22),
    'counter': ((3.15, -4.15, 1.55), (0.6, 1.05, 1.12), 30),
    'kitchen': ((8.45, -0.7, 1.7), (5.4, 2.3, 1.15), 20),
    'store': ((5.0, 3.05, 1.7), (9.2, 5.6, 1.1), 20),
    'office': ((4.6, -1.6, 1.6), (9.0, -3.8, 1.0), 20),
    'office_desk': ((7.6, -1.75, 1.5), (9.2, -3.2, 1.0), 22),
    'office_window': ((7.0, -2.3, 1.6), (7.0, -4.8, 1.6), 20),
    'kitchen_wall': ((5.2, 0.9, 1.55), (5.2, -1.0, 1.4), 22),
    'till': ((3.4, -0.7, 1.6), (2.2, 1.3, 1.1), 24),
    'top': ((2.5, -26.0, 22.0), (2.5, 0.0, 2.0), 24),
}


def build(fast=False):
    global COL
    scene = C.reset_scene()
    K.library()
    COL = C.collection('COL_World')
    m = palette()
    build_cafe(m)
    build_kitchen(m)
    build_store(m)
    build_office(m)
    build_building(m)
    build_lights(m, scene)
    for name, (loc, target, lens) in CAMERAS.items():
        C.camera(f'CAM_{name}', loc, target, lens, COL)
    C.setup_cycles(scene, samples=40 if fast else 160, size=(1280, 720))
    scene.cycles.max_bounces = 8
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.cycles.sample_clamp_indirect = 8.0
    set_time(scene, night=False)
    untagged = [o.name for o in scene.objects if o.type == 'MESH' and 'atlas' not in o]
    print('UNTAGGED', untagged)
    return scene


if __name__ == '__main__':
    args = C.flags()
    scene = build(fast='--fast' in args)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(C.WORK, 'world.blend'))
    if '--render' in args:
        which = [a for a in args if a in CAMERAS] or list(CAMERAS)
        for night in ([False, True] if '--night' in args else [False]):
            set_time(scene, night)
            for name in which:
                C.render(scene, bpy.data.objects[f'CAM_{name}'],
                         os.path.join(C.RENDERS, f'world_{name}{"_night" if night else ""}.png'))
    print('WORLD OK')
