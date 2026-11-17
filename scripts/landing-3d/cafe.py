"""The café corner (ADR 0064, approval 2): the counter with the till, the espresso machine, the pastry case, the
back wall (green tiles, shelves, the menu board, the clock), a table for two by the window, pendant lights,
daylight; Xedine floats by the counter. Real colours, real materials (CC0 Poly Haven scans + modelled parts).

    python scripts/landing-3d/fetch_assets.py        (once)
    python scripts/landing-3d/make_textures.py       (once)
    blender -b --factory-startup -P scripts/landing-3d/cafe.py -- [--render] [--fast]

Layout (metres, Z up, the camera looks toward +Y): the back wall at y=2.6, the window wall at x=-4, the kitchen
side at x=+4; the counter runs along x from -1.3 to 2.5 at y≈1.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import common as C  # noqa: E402

ASSETS = os.path.join(C.WORK, 'assets')
MADE = os.path.join(ASSETS, 'made')
CEILING = 3.2
PROTOS = {}


# ---------------------------------------------------------------- helpers

def sock(sockets, identifier):
    return next(s for s in sockets if s.identifier == identifier)


def box_uv(bm, size=1.0):
    """UVs in metres from the face's main axis (1 UV unit = `size` metres)."""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for loop in f.loops:
            co = loop.vert.co
            u, v = ((co.y, co.z), (co.x, co.z), (co.x, co.y))[ax]
            loop[uv].uv = (u / size, v / size)


def cube_into(bm, lo, hi):
    res = bmesh.ops.create_cube(bm, size=1.0)
    for v in res['verts']:
        v.co = Vector((lo[0] if v.co.x < 0 else hi[0], lo[1] if v.co.y < 0 else hi[1], lo[2] if v.co.z < 0 else hi[2]))
    return res['verts']


def box(name, lo, hi, mat, col, bevel=0.0, uv=1.0):
    bm = bmesh.new()
    cube_into(bm, lo, hi)
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect='EDGES', profile=0.5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    box_uv(bm, uv)
    return C.mesh_object(name, bm, col, mat, smooth=False)


def boxes(name, parts, mat, col, bevel=0.0, uv=1.0):
    """Many boxes in one mesh (slats, frames)."""
    bm = bmesh.new()
    for lo, hi in parts:
        verts = cube_into(bm, lo, hi)
        if bevel:
            edges = list({e for v in verts for e in v.link_edges})
            bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=2, affect='EDGES', profile=0.5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    box_uv(bm, uv)
    return C.mesh_object(name, bm, col, mat, smooth=False)


def cylinder(name, center, r1, r2, depth, mat, col, segments=48, smooth=True):
    """A cylinder standing on `center` (its origin), so rotating it turns it in place."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=r1, radius2=r2, depth=depth)
    bmesh.ops.translate(bm, vec=(0, 0, depth / 2), verts=bm.verts)
    box_uv(bm, 0.5)
    o = C.mesh_object(name, bm, col, mat, smooth=smooth)
    o.location = center
    return o


def disc(name, center, radius, mat, col, segments=64):
    """A round face toward -Y with its image filling the circle (the clock face)."""
    bm = bmesh.new()
    verts = [bm.verts.new((radius * math.cos(math.tau * i / segments), 0, radius * math.sin(math.tau * i / segments)))
             for i in range(segments)]
    face = bm.faces.new(verts)  # counter-clockwise seen from the room: it faces -Y (the page draws one side)
    uv = bm.loops.layers.uv.verify()
    for loop in face.loops:
        co = loop.vert.co
        loop[uv].uv = (co.x / (2 * radius) + 0.5, co.z / (2 * radius) + 0.5)
    o = C.mesh_object(name, bm, col, mat, smooth=False)
    o.location = center
    return o


def glow(material_name, color, strength):
    mat = bpy.data.materials.get(material_name)
    if mat and mat.use_nodes:
        bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf:
            bsdf.inputs['Emission Color'].default_value = C.lin(color)
            bsdf.inputs['Emission Strength'].default_value = strength


def textured(name, tex_id, size=1.0, tint=None, rough=None, normal=1.0, coat=0.0):
    """A scanned PBR texture on box-projected UVs; `size` = metres one texture repeat covers."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = nodes['Principled BSDF']
    coord = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (1 / size, 1 / size, 1)
    links.new(coord.outputs['UV'], mapping.inputs['Vector'])

    def image(key, space):
        path = os.path.join(ASSETS, 'textures', tex_id, f'{key}.jpg')
        if not os.path.exists(path):
            return None
        node = nodes.new('ShaderNodeTexImage')
        node.image = bpy.data.images.load(path, check_existing=True)
        node.image.colorspace_settings.name = space
        links.new(mapping.outputs['Vector'], node.inputs['Vector'])
        return node

    diffuse = image('Diffuse', 'sRGB')
    if diffuse is not None:
        if tint:
            mix = nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            sock(mix.inputs, 'Factor_Float').default_value = 1.0
            links.new(diffuse.outputs['Color'], sock(mix.inputs, 'A_Color'))
            sock(mix.inputs, 'B_Color').default_value = C.lin(tint)
            links.new(sock(mix.outputs, 'Result_Color'), bsdf.inputs['Base Color'])
        else:
            links.new(diffuse.outputs['Color'], bsdf.inputs['Base Color'])
    if rough is None:
        r = image('Rough', 'Non-Color')
        if r is not None:
            links.new(r.outputs['Color'], bsdf.inputs['Roughness'])
    else:
        bsdf.inputs['Roughness'].default_value = rough
    nrm = image('nor_gl', 'Non-Color')
    if nrm is not None:
        nm = nodes.new('ShaderNodeNormalMap')
        nm.inputs['Strength'].default_value = normal
        links.new(nrm.outputs['Color'], nm.inputs['Color'])
        links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if coat:
        bsdf.inputs['Coat Weight'].default_value = coat
        bsdf.inputs['Coat Roughness'].default_value = 0.08
    return mat


def image_material(name, path, emission=0.0, roughness=0.6):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes['Principled BSDF']
    img = nodes.new('ShaderNodeTexImage')
    img.image = bpy.data.images.load(path, check_existing=True)
    links.new(img.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = roughness
    if emission:
        links.new(img.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = emission
    return mat


def plane_with_image(name, center, size, normal_axis, mat, col, flip=False):
    """A rectangle facing -Y (normal_axis='Y') or +X ('X'), UV 0..1 across it."""
    w, h = size
    bm = bmesh.new()
    if normal_axis == 'Y':
        pts = [(-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2)]
    else:
        pts = [(0, w / 2, -h / 2), (0, -w / 2, -h / 2), (0, -w / 2, h / 2), (0, w / 2, h / 2)]
    verts = [bm.verts.new(Vector(p) + Vector(center)) for p in pts]
    face = bm.faces.new(verts if not flip else list(reversed(verts)))
    uv = bm.loops.layers.uv.verify()
    for loop, (u, v) in zip(face.loops, [(0, 0), (1, 0), (1, 1), (0, 1)] if not flip else [(0, 1), (1, 1), (1, 0), (0, 0)]):
        loop[uv].uv = (u, v)
    return C.mesh_object(name, bm, col, mat, smooth=False)


# ---------------------------------------------------------------- scanned models

def library():
    lib = C.collection('COL_Library')
    bpy.context.view_layer.layer_collection.children['COL_Library'].exclude = True
    return lib


def load_model(asset_id, join=True):
    """Imports a Poly Haven glTF once; returns a single prototype mesh (origin at its bottom centre), or the
    separate parts when join=False."""
    key = (asset_id, join)
    if key in PROTOS:
        return PROTOS[key]
    path = os.path.join(ASSETS, 'models', asset_id, f'{asset_id}.gltf')
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    for o in meshes:
        if o.data.users > 1:
            o.data = o.data.copy()
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
    for o in new:
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    lib = bpy.data.collections['COL_Library']
    parts = meshes
    if join and len(meshes) > 1:
        with bpy.context.temp_override(active_object=meshes[0], object=meshes[0], selected_objects=meshes,
                                       selected_editable_objects=meshes):
            bpy.ops.object.join()
        parts = [meshes[0]]
    for o in parts:
        me = o.data
        xs = [v.co.x for v in me.vertices]
        ys = [v.co.y for v in me.vertices]
        zs = [v.co.z for v in me.vertices]
        me.transform(Matrix.Translation((-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, -min(zs))))
        for c in list(o.users_collection):
            c.objects.unlink(o)
        lib.objects.link(o)
        o.name = f'PROTO_{asset_id}'
        print('MODEL', asset_id, 'size', tuple(round(d, 3) for d in o.dimensions),
              'materials', [m.name for m in me.materials])
    PROTOS[key] = parts[0] if join else parts
    return PROTOS[key]


def place(asset_id, loc, rot=0.0, scale=1.0, col=None, name=None, part=None):
    proto = load_model(asset_id, join=part is None)
    if part is not None:
        proto = proto[part]
    o = proto.copy()
    o.name = name or asset_id
    o['scan'] = 1  # a scanned model with its own good UVs: the bake keeps them (bake.py)
    (col or bpy.context.scene.collection).objects.link(o)
    o.location = loc
    # glTF imports come in quaternion mode, where an Euler angle is silently ignored: every scan stood in its
    # file's own direction until 2026-11-17 (the desk half inside the wall, chairs turned away from tables).
    o.rotation_mode = 'XYZ'
    o.rotation_euler = (0, 0, math.radians(rot))
    o.scale = (scale, scale, scale) if isinstance(scale, (int, float)) else scale
    return o


# ---------------------------------------------------------------- materials

def palette():
    return {
        'floor': textured('MAT_Floor_Parquet', 'herringbone_parquet', size=1.25, rough=0.42, normal=0.6),
        'wall': paint('MAT_Wall_Paint', '#F1EADF'),
        'tiles': textured('MAT_Tiles_Green', 'long_white_tiles', size=0.9, tint='#3E6A57', rough=0.3, normal=0.8,
                          coat=0.15),
        'marble': textured('MAT_Stone_Marble', 'marble_01', size=1.6, rough=0.12, normal=0.3, coat=0.3),
        'oak': textured('MAT_Wood_Oak', 'oak_veneer_01', size=1.2, normal=0.5),
        'walnut': textured('MAT_Wood_Walnut', 'walnut_veneer', size=1.2, normal=0.5),
        'ceiling': C.principled('MAT_Ceiling_Plaster', '#F4F1EA', roughness=0.9),
        'steel_black': C.principled('MAT_Metal_Black', '#1C1D20', roughness=0.38, metallic=1.0),
        'stainless': C.principled('MAT_Metal_Stainless', '#C9CCD0', roughness=0.2, metallic=1.0),
        'brass': C.principled('MAT_Metal_Brass', '#C8A160', roughness=0.28, metallic=1.0),
        'ceramic': C.principled('MAT_Ceramic_White', '#F2F0EB', roughness=0.12, coat=0.6, coat_rough=0.05),
        'cabinet': C.principled('MAT_Paint_Sage', '#5E7F6F', roughness=0.5, coat=0.2, coat_rough=0.3),
        'cream': C.principled('MAT_Enamel_Cream', '#EDE3CF', roughness=0.25, coat=0.5, coat_rough=0.1),
        'rubber': C.principled('MAT_Rubber_Black', '#141416', roughness=0.7),
        'device': C.principled('MAT_Device_Graphite', '#26272B', roughness=0.35, metallic=0.4),
        'outside': C.principled('MAT_Outside_Daylight', '#DCE8F2', roughness=1.0, emission='#E9F1F8',
                                emission_strength=3.0),
        'led': C.principled('MAT_Light_Strip_Warm', '#FFD7A0', roughness=0.5, emission='#FFC98A',
                            emission_strength=6.0),
        'glass': glass_material(),
        'coffee_beans': C.principled('MAT_Food_Beans', '#3B2416', roughness=0.45, coat=0.3),
        'patty': C.principled('MAT_Food_Patty', '#4A2A1A', roughness=0.75),
        'cheese': C.principled('MAT_Food_Cheese', '#F2B23A', roughness=0.35, subsurface=0.2),
        'lettuce': C.principled('MAT_Food_Lettuce', '#6FAE3E', roughness=0.45, subsurface=0.2),
        'tomato': C.principled('MAT_Food_Tomato', '#D9412B', roughness=0.3, coat=0.4),
        'fries': C.principled('MAT_Food_Fries', '#E9B954', roughness=0.55),
        'menu': image_material('MAT_Board_Menu', os.path.join(MADE, 'menu_board.png'), roughness=0.85),
        'clock': image_material('MAT_Clock_Face', os.path.join(MADE, 'clock_face.png'), roughness=0.3),
        'latte': image_material('MAT_Food_Latte', os.path.join(MADE, 'latte.png'), roughness=0.25),
        'screen': image_material('MAT_Screen_Till', os.path.join(MADE, 'till_stand_in.png'), emission=1.6,
                                 roughness=0.1),
    }


def paint(name, color):
    """Smooth painted plaster: a flat colour with a faint trowel texture in the bump only."""
    mat = C.principled(name, color, roughness=0.82)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 9.0
    noise.inputs['Detail'].default_value = 6.0
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.06
    links.new(noise.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], nodes['Principled BSDF'].inputs['Normal'])
    return mat


def glass_material():
    """Thin glass the sun passes through (no caustic noise): mostly transparent with a glossy sheen."""
    mat = bpy.data.materials.new('MAT_Glass_Clear')
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    out = nodes['Material Output']
    nodes.remove(nodes['Principled BSDF'])
    transparent = nodes.new('ShaderNodeBsdfTransparent')
    glossy = nodes.new('ShaderNodeBsdfGlossy')
    glossy.inputs['Roughness'].default_value = 0.02
    fresnel = nodes.new('ShaderNodeFresnel')
    fresnel.inputs['IOR'].default_value = 1.5
    mix = nodes.new('ShaderNodeMixShader')
    links.new(fresnel.outputs['Fac'], mix.inputs['Fac'])
    links.new(transparent.outputs['BSDF'], mix.inputs[1])
    links.new(glossy.outputs['BSDF'], mix.inputs[2])
    links.new(mix.outputs['Shader'], out.inputs['Surface'])
    return mat


# ---------------------------------------------------------------- the room

def build_room(col, m):
    box('SM_Floor', (-4.15, -3.2, -0.06), (4.15, 2.75, 0.0), m['floor'], col, uv=1.0)
    box('SM_Ceiling', (-4.15, -3.2, CEILING), (4.15, 2.75, CEILING + 0.1), m['ceiling'], col)
    box('SM_Wall_Back', (-4.15, 2.6, 0), (4.15, 2.75, CEILING), m['wall'], col)
    # The window wall: four pieces around a wide opening.
    wx, y0, y1, z0, z1 = (-4.15, -4.0), -1.7, 1.5, 0.95, 2.7
    for name, lo, hi in (('Low', (wx[0], -3.2, 0), (wx[1], 2.6, z0)), ('High', (wx[0], -3.2, z1), (wx[1], 2.6, CEILING)),
                         ('Front', (wx[0], -3.2, z0), (wx[1], y0, z1)), ('Back', (wx[0], y1, z0), (wx[1], 2.6, z1))):
        box(f'SM_Wall_Window_{name}', lo, hi, m['wall'], col)
    # Black steel window frame with two mullions, thin glass, bright daylight outside.
    f = 0.045
    frame = [((-4.1, y0, z0), (-4.03, y1, z0 + f)), ((-4.1, y0, z1 - f), (-4.03, y1, z1)),
             ((-4.1, y0, z0), (-4.03, y0 + f, z1)), ((-4.1, y1 - f, z0), (-4.03, y1, z1)),
             ((-4.1, -0.6, z0), (-4.03, -0.6 + 0.03, z1)), ((-4.1, 0.45, z0), (-4.03, 0.45 + 0.03, z1)),
             ((-4.1, y0, 1.95), (-4.03, y1, 1.95 + 0.03))]
    boxes('SM_Window_Frame', frame, m['steel_black'], col, bevel=0.004)
    box('SM_Window_Glass', (-4.075, y0, z0), (-4.07, y1, z1), m['glass'], col)
    box('SM_Window_Sill', (-4.05, y0 - 0.05, z0 - 0.04), (-3.72, y1 + 0.05, z0), m['walnut'], col, bevel=0.006)
    outside = plane_with_image('SM_Outside', (-6.5, -0.1, 1.8), (9, 5), 'X', m['outside'], col, flip=True)
    outside.visible_shadow = False  # bright daylight beyond the glass, but it must not block the sun
    # The kitchen side: a wall with a doorway (the kitchen comes later in the day).
    box('SM_Wall_Kitchen_Front', (4.0, -3.2, 0), (4.15, 0.7, CEILING), m['wall'], col)
    box('SM_Wall_Kitchen_Back', (4.0, 1.9, 0), (4.15, 2.6, CEILING), m['wall'], col)
    box('SM_Wall_Kitchen_Top', (4.0, 0.7, 2.25), (4.15, 1.9, CEILING), m['wall'], col)
    # Skirting boards
    boxes('SM_Skirting', [((-3.99, -3.2, 0), (-3.97, 2.6, 0.1)), ((-4.0, 2.58, 0), (4.0, 2.6, 0.1))], m['walnut'], col)


def build_counter(col, m):
    x0, x1, yf, yb, h = -1.3, 2.5, 0.95, 1.6, 0.98
    box('SM_Counter_Body', (x0, yf + 0.02, 0.08), (x1, yb, h), m['walnut'], col)
    box('SM_Counter_Kick', (x0 + 0.03, yf + 0.06, 0), (x1 - 0.03, yb - 0.02, 0.085), m['rubber'], col)
    slats, x, w, gap = [], x0, 0.046, 0.011
    while x + w <= x1 + 1e-6:
        slats.append(((x, yf - 0.02, 0.085), (x + w, yf + 0.02, h)))
        x += w + gap
    for side in (x0 - 0.03, x1 - 0.0):
        slats.append(((side, yf - 0.02, 0.085), (side + 0.03, yb, h)))
    boxes('SM_Counter_Slats', slats, m['oak'], col, bevel=0.004, uv=1.0)
    box('SM_Counter_Top', (x0 - 0.06, yf - 0.07, h), (x1 + 0.06, yb + 0.04, h + 0.04), m['marble'], col, bevel=0.008,
        uv=1.0)
    # The back counter along the wall: sage cabinets with a walnut top.
    box('SM_BackCounter_Body', (-1.4, 2.06, 0.1), (3.0, 2.58, 0.88), m['cabinet'], col, bevel=0.004)
    doors = []
    x = -1.38
    while x + 0.5 <= 3.0:
        doors.append(((x + 0.01, 2.035, 0.13), (x + 0.49, 2.06, 0.86)))
        x += 0.5
    boxes('SM_BackCounter_Doors', doors, m['cabinet'], col, bevel=0.006)
    boxes('SM_BackCounter_Handles', [((d[0][0] + 0.2, 2.02, 0.74), (d[0][0] + 0.28, 2.035, 0.752)) for d in doors],
          m['brass'], col, bevel=0.002)
    box('SM_BackCounter_Kick', (-1.38, 2.1, 0), (2.98, 2.56, 0.1), m['rubber'], col)
    box('SM_BackCounter_Top', (-1.42, 2.0, 0.88), (3.02, 2.6, 0.92), m['walnut'], col, bevel=0.006)


def build_back_wall(col, m):
    box('SM_Backsplash_Tiles', (-1.42, 2.585, 0.92), (3.02, 2.6, 2.0), m['tiles'], col, uv=1.0)
    shelves = [((-1.1, 2.33, 1.42), (1.25, 2.585, 1.46)), ((1.45, 2.33, 1.42), (2.85, 2.585, 1.46)),
               ((-1.1, 2.33, 1.8), (1.25, 2.585, 1.84)), ((1.45, 2.33, 1.8), (2.85, 2.585, 1.84))]
    boxes('SM_Shelves', shelves, m['walnut'], col, bevel=0.005)
    brackets = []
    for (lo, hi) in shelves:
        for bx in (lo[0] + 0.12, hi[0] - 0.14):
            brackets.append(((bx, 2.36, lo[2] - 0.12), (bx + 0.02, 2.585, lo[2])))
    boxes('SM_Shelf_Brackets', brackets, m['brass'], col, bevel=0.003)
    boxes('SM_Shelf_Lights', [((lo[0] + 0.05, 2.5, lo[2] - 0.008), (hi[0] - 0.05, 2.56, lo[2])) for lo, hi in shelves],
          m['led'], col)
    # The menu board above the shelves (no words: pictures and dotted price lines).
    box('SM_Menu_Frame', (-0.55, 2.55, 2.03), (2.3, 2.6, 2.95), m['walnut'], col, bevel=0.006)
    plane_with_image('SM_Menu_Board', (0.875, 2.548, 2.49), (2.75, 1.34), 'Y', m['menu'], col)
    # The wall clock: its hands are separate so the story can move the time of day.
    cylinder('SM_Clock_Rim', (-1.05, 2.6, 2.45), 0.23, 0.23, 0.055, m['steel_black'], col).rotation_euler = (
        math.radians(90), 0, 0)
    disc('SM_Clock_Face', (-1.05, 2.542, 2.45), 0.21, m['clock'], col)
    for name, length, width in (('Hour', 0.11, 0.016), ('Minute', 0.17, 0.011)):
        hand = box(f'SM_Clock_Hand_{name}', (-width / 2, -0.004, -0.02), (width / 2, 0.0, length),
                   m['steel_black'], col)
        hand.location = (-1.05, 2.54 - (0.004 if name == 'Minute' else 0), 2.45)
    set_clock(10, 10)


def set_clock(hours, minutes):
    h = bpy.data.objects.get('SM_Clock_Hand_Hour')
    mnt = bpy.data.objects.get('SM_Clock_Hand_Minute')
    if h and mnt:
        h.rotation_euler = (0, math.radians(((hours % 12) + minutes / 60) * 30), 0)
        mnt.rotation_euler = (0, math.radians(minutes * 6), 0)


def lathe_object(name, profile, mat, col, loc, steps=48):
    bm = C.lathe(profile, steps=steps)
    box_uv(bm, 0.3)
    o = C.mesh_object(name, bm, col, mat)
    o.location = loc
    return o


CUP = [(0.0, 0.085), (0.042, 0.085), (0.044, 0.08), (0.04, 0.03), (0.032, 0.006), (0.026, 0.0), (0.0, 0.0)]
SAUCER = [(0.0, 0.012), (0.075, 0.016), (0.078, 0.012), (0.06, 0.004), (0.035, 0.0), (0.0, 0.0)]
PLATE = [(0.0, 0.014), (0.11, 0.014), (0.135, 0.024), (0.14, 0.02), (0.12, 0.006), (0.08, 0.0), (0.0, 0.0)]


def build_counter_props(col, m):
    top = 1.02
    # The till: a big tablet on a stand near the counter's open end, where the cashier stands in full view,
    # turned toward the room (swivel stands do that to show the bill; the founder, 2026-11-17).
    tx, ty = 2.2, 1.22
    stand = cylinder('SM_Till_Stand_Base', (tx, ty, top), 0.09, 0.085, 0.012, m['device'], col)
    cylinder('SM_Till_Stand_Neck', (tx, ty, top + 0.012), 0.016, 0.016, 0.15, m['device'], col)
    tablet = box('SM_Till_Tablet', (-0.182, -0.007, -0.12), (0.182, 0.007, 0.12), m['device'], col, bevel=0.007)
    screen = plane_with_image('SM_Till_Screen', (0, -0.0075, 0), (0.336, 0.215), 'Y', m['screen'], col)
    for o in (tablet, screen):
        o.location = (tx, ty, top + 0.27)
        o.rotation_euler = (math.radians(-15), 0, math.radians(22))
    box('SM_Card_Reader', (1.84, 1.12, top), (1.92, 1.24, top + 0.025), m['device'], col, bevel=0.006)
    # The pastry case at the counter's left: glass on a walnut base, cakes below, croissants on a glass shelf.
    cx = -1.05
    box('SM_Case_Base', (cx, 1.05, top), (cx + 1.05, 1.55, top + 0.04), m['walnut'], col, bevel=0.004)
    box('SM_Case_Glass', (cx + 0.02, 1.07, top + 0.04), (cx + 1.03, 1.53, top + 0.5), m['glass'], col)
    box('SM_Case_Shelf', (cx + 0.04, 1.09, top + 0.27), (cx + 1.01, 1.51, top + 0.28), m['glass'], col)
    place('carrot_cake', (cx + 0.25, 1.3, top + 0.04), rot=20, col=col)
    place('strawberry_chocolate_cake', (cx + 0.75, 1.3, top + 0.04), rot=-10, col=col)
    for i, x in enumerate((0.17, 0.41, 0.65, 0.89)):
        place('croissant', (cx + x, 1.3 + (0.04 if i % 2 else -0.04), top + 0.28), rot=15 + i * 40, col=col)
    # Cups waiting by the till, a succulent at the end.
    for i, x in enumerate((1.2, 1.33)):
        lathe_object(f'SM_Saucer_Counter_{i}', SAUCER, m['ceramic'], col, (x, 1.3, top))
        lathe_object(f'SM_Cup_Counter_{i}', CUP, m['ceramic'], col, (x, 1.3, top + 0.012))
    place('potted_plant_04', (1.62, 1.42, top), rot=30, scale=0.8, col=col)


def build_back_props(col, m):
    top = 0.92
    # The espresso machine on the back counter, facing the room, in the gap between the case and the till.
    x, y = 0.75, 2.32
    box('SM_Espresso_Body', (x - 0.36, y - 0.22, top + 0.08), (x + 0.36, y + 0.22, top + 0.46), m['stainless'], col,
        bevel=0.02)
    box('SM_Espresso_Side_L', (x - 0.38, y - 0.23, top + 0.08), (x - 0.355, y + 0.23, top + 0.46), m['cream'], col,
        bevel=0.008)
    box('SM_Espresso_Side_R', (x + 0.355, y - 0.23, top + 0.08), (x + 0.38, y + 0.23, top + 0.46), m['cream'], col,
        bevel=0.008)
    box('SM_Espresso_Tray', (x - 0.33, y - 0.27, top), (x + 0.33, y - 0.05, top + 0.035), m['stainless'], col,
        bevel=0.006)
    box('SM_Espresso_Feet', (x - 0.33, y - 0.2, top), (x + 0.33, y + 0.2, top + 0.08), m['steel_black'], col)
    for i, gx in enumerate((x - 0.17, x + 0.17)):
        cylinder(f'SM_Espresso_Group_{i}', (gx, y - 0.25, top + 0.28), 0.045, 0.04, 0.07, m['stainless'], col)
        handle = box(f'SM_Espresso_Handle_{i}', (-0.012, -0.16, -0.012), (0.012, 0.0, 0.012), m['rubber'], col,
                     bevel=0.008)
        handle.location = (gx, y - 0.25, top + 0.265)
        lathe_object(f'SM_Espresso_Cup_{i}', CUP, m['ceramic'], col, (gx, y - 0.2, top + 0.035))
    for i, gx in enumerate((x - 0.12, x, x + 0.12)):
        lathe_object(f'SM_Espresso_TopCup_{i}', CUP, m['ceramic'], col, (gx, y + 0.05, top + 0.47))
    for i, gx in enumerate((x - 0.24, x + 0.24)):
        g = cylinder(f'SM_Espresso_Gauge_{i}', (gx, y - 0.225, top + 0.39), 0.035, 0.035, 0.012, m['brass'], col)
        g.rotation_euler = (math.radians(90), 0, 0)
    # The grinder beside it.
    cylinder('SM_Grinder_Body', (x + 0.62, y, top), 0.075, 0.085, 0.32, m['steel_black'], col)
    cylinder('SM_Grinder_Hopper', (x + 0.62, y, top + 0.32), 0.05, 0.085, 0.16, m['glass'], col)
    cylinder('SM_Grinder_Beans', (x + 0.62, y, top + 0.33), 0.047, 0.07, 0.1, m['coffee_beans'], col)
    place('wooden_cutting_board', (-0.75, 2.45, top), rot=0, col=col)
    place('ceramic_vase_01', (2.65, 2.42, top), rot=0, scale=0.9, col=col)
    # Cups and jars on the shelves.
    for row, z in enumerate((1.46, 1.84)):
        for i in range(9):
            lathe_object(f'SM_Shelf_Cup_{row}_{i}', CUP, m['ceramic'], col, (-0.95 + i * 0.22, 2.46, z))
        for i in range(4):
            cylinder(f'SM_Shelf_Jar_{row}_{i}', (1.62 + i * 0.3, 2.46, z), 0.06, 0.06, 0.2, m['glass'], col)
            cylinder(f'SM_Shelf_Jar_Beans_{row}_{i}', (1.62 + i * 0.3, 2.46, z + 0.005), 0.055, 0.055, 0.13,
                     m['coffee_beans'], col)


def build_dining(col, m):
    tx, ty = -2.35, -0.55
    # The scan is a tall bar table (1.4 m wide, 1 m high): a café table for two is ~0.77 m wide, 0.75 m high.
    place('round_wooden_table_01', (tx, ty, 0), rot=0, scale=(0.55, 0.55, 0.75), col=col)
    place('painted_wooden_chair_01', (tx - 0.75, ty, 0), rot=90, col=col, name='chair_a')
    place('painted_wooden_chair_01', (tx + 0.75, ty, 0), rot=-90, col=col, name='chair_b')
    place('potted_plant_01', (-3.45, 2.1, 0), rot=0, scale=1.3, col=col)
    place('metal_stool_03', (-3.45, -1.15, 0), rot=10, col=col)
    place('metal_stool_01', (-3.45, 0.85, 0), rot=-20, col=col)
    place('standing_chalkboard_01', (-1.6, -2.75, 0), rot=25, col=col)
    for i, (x, y) in enumerate(((1.1, 0.6), (1.7, 0.62), (2.3, 0.6))):
        place('metal_stool_01', (x - 0.2, y - 0.1, 0), rot=15 * i, col=col, name=f'counter_stool_{i}')
    return tx, ty


def build_meal(col, m, table_top):
    """A burger and fries on a plate and a latte, on the table for two."""
    x, y, z = table_top
    lathe_object('SM_Plate', PLATE, m['ceramic'], col, (x + 0.1, y - 0.08, z))
    bz = z + 0.02
    buns = load_model('hamburger_buns', join=False)
    bun = buns[0]
    bottom = bun.copy()
    bottom.name = 'SM_Burger_Bun_Bottom'
    bottom['scan'] = 1
    col.objects.link(bottom)
    bottom.scale = (1.0, 1.0, 0.45)
    bottom.rotation_euler = (math.radians(180), 0, 0)
    dims = bun.dimensions
    bottom.location = (x + 0.1, y - 0.08, bz + dims.z * 0.45)
    cylinder('SM_Burger_Patty', (x + 0.1, y - 0.08, bz + dims.z * 0.42), dims.x * 0.5, dims.x * 0.49, 0.022,
             m['patty'], col)
    cheese = box('SM_Burger_Cheese', (-dims.x * 0.45, -dims.x * 0.45, 0), (dims.x * 0.45, dims.x * 0.45, 0.004),
                 m['cheese'], col)
    cheese.location = (x + 0.1, y - 0.08, bz + dims.z * 0.42 + 0.022)
    cheese.rotation_euler = (0, 0, math.radians(20))
    lettuce = cylinder('SM_Burger_Lettuce', (x + 0.1, y - 0.08, bz + dims.z * 0.42 + 0.026), dims.x * 0.56,
                       dims.x * 0.55, 0.006, m['lettuce'], col)
    lettuce.scale = (1.0, 0.96, 1.0)
    cylinder('SM_Burger_Tomato', (x + 0.1, y - 0.08, bz + dims.z * 0.42 + 0.032), dims.x * 0.4, dims.x * 0.4,
             0.008, m['tomato'], col)
    top_bun = bun.copy()
    top_bun.name = 'SM_Burger_Bun_Top'
    top_bun['scan'] = 1
    col.objects.link(top_bun)
    top_bun.location = (x + 0.1, y - 0.08, bz + dims.z * 0.42 + 0.04)
    fries = []
    for i in range(14):
        a = i * 0.45
        fx = x + 0.1 + 0.075 * math.cos(a) + 0.02 * math.sin(i * 1.7)
        fy = y - 0.08 + 0.075 * math.sin(a) * 0.4 - 0.05
        fries.append(((fx - 0.006, fy - 0.04, z + 0.02 + 0.006 * (i % 3)), (fx + 0.006, fy + 0.04, z + 0.032 + 0.006 * (i % 3))))
    boxes('SM_Fries', fries, m['fries'], col, bevel=0.002)
    lathe_object('SM_Saucer_Table', SAUCER, m['ceramic'], col, (x - 0.16, y + 0.12, z))
    lathe_object('SM_Cup_Table', CUP, m['ceramic'], col, (x - 0.16, y + 0.12, z + 0.012))
    latte = cylinder('SM_Latte_Top', (x - 0.16, y + 0.12, z + 0.012 + 0.075), 0.039, 0.039, 0.001, m['latte'], col)
    uv = latte.data.uv_layers.active
    for poly in latte.data.polygons:
        for li in poly.loop_indices:
            co = latte.data.vertices[latte.data.loops[li].vertex_index].co
            uv.data[li].uv = ((co.x - (x - 0.16)) / 0.08 + 0.5, (co.y - (y + 0.12)) / 0.08 + 0.5)


def build_lights(col, m, scene):
    sun = bpy.data.objects.new('LGT_Sun', bpy.data.lights.new('LGT_Sun', 'SUN'))
    sun.data.energy = 6.0
    sun.data.angle = math.radians(1.2)
    sun.data.color = C.lin('#FFF0D8')[:3]
    col.objects.link(sun)
    sun.rotation_euler = Vector((0.82, 0.28, -0.5)).to_track_quat('-Z', 'Y').to_euler()
    world = bpy.data.worlds.new('WLD_Cafe')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = C.lin('#C9DCEC')
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    C.area_light('LGT_Front_Fill', (0.6, -6.8, 2.3), (0.2, 1.0, 1.1), 420, 5.0, '#FFF6EC', col)
    lamps = []
    for i, x in enumerate((-0.45, 0.85, 2.1)):
        lamp = place('modern_ceiling_lamp_01', (x, 1.28, 1.92), col=col, name=f'pendant_{i}')
        lamps.append(lamp)
        height = lamp.dimensions.z
        cord_from = 1.92 + height
        if cord_from < CEILING:
            cylinder(f'SM_Pendant_Cord_{i}', (x, 1.28, cord_from), 0.004, 0.004, CEILING - cord_from,
                     m['steel_black'], col, segments=8)
        bulb = bpy.data.objects.new(f'LGT_Pendant_{i}', bpy.data.lights.new(f'LGT_Pendant_{i}', 'POINT'))
        bulb.data.energy = 38
        bulb.data.shadow_soft_size = 0.06
        bulb.data.color = C.lin('#FFB86E')[:3]
        bulb.location = (x, 1.28, 1.92 + min(height, 0.4) * 0.35)
        col.objects.link(bulb)
    # The globes glow warm, like lit frosted glass.
    glow('modern_ceiling_globe', '#FFD49A', 5.0)
    glow('modern_ceiling_lamp_01_glass', '#FFD49A', 5.0)
    case = bpy.data.objects.new('LGT_Case', bpy.data.lights.new('LGT_Case', 'AREA'))
    case.data.energy = 9
    case.data.size = 0.9
    case.data.color = C.lin('#FFD9A8')[:3]
    case.location = (-0.52, 1.3, 1.5)
    col.objects.link(case)
    return lamps


XEDINE_SCALE = 0.62  # in the café Xedine is a floating helper at eye level, smaller than the people


def add_xedine(col, location, rot_z, move=('AN_Wave', 22), yaw=0.0, pitch=0.0, scale=XEDINE_SCALE):
    path = os.path.join(C.WORK, 'xedine.blend')
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.collections = ['COL_Xedine']
        dst.actions = list(src.actions)
    xcol = dst.collections[0]
    col.children.link(xcol)
    arm = next(o for o in xcol.objects if o.type == 'ARMATURE')
    arm.location = location
    arm.rotation_euler = (0, 0, rot_z)
    arm.scale = (scale, scale, scale)
    import xedine as X
    X.play(arm, *move)
    X.look_eyes(arm, yaw=yaw, pitch=pitch)
    return arm


def build(fast=False):
    scene = C.reset_scene()
    library()
    col = C.collection('COL_Cafe')
    m = palette()
    build_room(col, m)
    build_counter(col, m)
    build_back_wall(col, m)
    build_counter_props(col, m)
    build_back_props(col, m)
    tx, ty = build_dining(col, m)
    table = bpy.data.objects['round_wooden_table_01']
    build_meal(col, m, (tx, ty, table.dimensions.z))
    build_lights(col, m, scene)
    # The same shot as the page's camera (cafe-stage.tsx: CAMERA, TARGET, XEDINE_AT).
    cam = C.camera('CAM_Corner', (3.15, -4.15, 1.55), (0.6, 1.05, 1.12), 30, col)
    # Xedine floats beside the till at eye level, waving at the visitor.
    add_xedine(col, (2.85, -0.15, 0.62), math.atan2(3.15 - 2.85, 4.15 - 0.15) - 0.25, yaw=0.12, pitch=0.02)
    C.setup_cycles(scene, samples=48 if fast else 192, size=(1600, 900))
    scene.cycles.max_bounces = 8
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.cycles.sample_clamp_indirect = 8.0
    return scene, cam


if __name__ == '__main__':
    args = C.flags()
    scene, cam = build(fast='--fast' in args)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(C.WORK, 'cafe.blend'))
    if '--render' in args:
        C.render(scene, cam, os.path.join(C.RENDERS, 'cafe_corner.png'))
    print('CAFE OK')
