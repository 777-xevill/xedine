"""Shared helpers for the landing page's 3D build scripts (ADR 0064).

Run every step headless with the Blender of the founder's Editing project, without writing to that folder:

    set BLENDER_USER_RESOURCES=E:/xedine.org/.cache/landing-3d/blender-user
    E:/Editing/apps/blender/blender.exe -b --factory-startup -P scripts/landing-3d/<step>.py -- [flags]

Units: 1 Blender unit = 1 metre, Z up, characters face -Y (glTF turns that into +Z, toward three.js' camera).
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
WORK = os.path.join(ROOT, '.cache', 'landing-3d')
RENDERS = os.path.join(WORK, 'renders')
PUBLIC = os.path.join(ROOT, 'public', 'landing', '3d')
for _d in (WORK, RENDERS, PUBLIC):
    os.makedirs(_d, exist_ok=True)


def flags():
    """Arguments after `--` on the Blender command line."""
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def lin(hexstr, alpha=1.0):
    """sRGB hex (as designers write it) to the linear RGBA Blender's shaders expect."""
    h = hexstr.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, alpha)


# The founder's three colours (ADR 0063); Xedine wears them, the café has real colours (ADR 0064).
GREY = '#2B2D31'
SILVER = '#D9DADC'
YELLOW = '#FFC93C'


def reset_scene():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.curves, bpy.data.metaballs, bpy.data.materials,
                 bpy.data.armatures, bpy.data.actions, bpy.data.cameras, bpy.data.lights, bpy.data.images,
                 bpy.data.node_groups, bpy.data.worlds):
        for block in list(coll):
            coll.remove(block)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.render.fps = 30
    return scene


def collection(name, parent=None):
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if col.name not in (parent or bpy.context.scene.collection).children:
        (parent or bpy.context.scene.collection).children.link(col)
    return col


def principled(name, color, roughness=0.5, metallic=0.0, **extra):
    """A Principled BSDF material. extra: coat, coat_rough, sheen, sheen_rough, emission, emission_strength,
    subsurface, specular (IOR level), transmission, alpha."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = lin(color) if isinstance(color, str) else color
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    keys = {
        'coat': 'Coat Weight', 'coat_rough': 'Coat Roughness', 'sheen': 'Sheen Weight',
        'sheen_rough': 'Sheen Roughness', 'emission_strength': 'Emission Strength',
        'subsurface': 'Subsurface Weight', 'specular': 'Specular IOR Level',
        'transmission': 'Transmission Weight', 'alpha': 'Alpha',
    }
    for k, v in extra.items():
        if k == 'emission':
            bsdf.inputs['Emission Color'].default_value = lin(v) if isinstance(v, str) else v
        elif k == 'sheen_tint':
            bsdf.inputs['Sheen Tint'].default_value = lin(v) if isinstance(v, str) else v
        else:
            bsdf.inputs[keys[k]].default_value = v
    return mat


def mesh_object(name, bm, col, material=None, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        me.shade_smooth()
    obj = bpy.data.objects.new(name, me)
    col.objects.link(obj)
    if material:
        me.materials.append(material)
    return obj


def ellipsoid(radii, center=(0, 0, 0), segments=32, rings=16):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * radii[0] + center[0], v.co.y * radii[1] + center[1], v.co.z * radii[2] + center[2]))
    return bm


def capsule(radius, length, segments=24, rings=12):
    """A capsule along +Y from y=0 to y=length (rounded ends included)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    # The sphere's poles are on Z: turn it so they lie on Y, then stretch its +Y half.
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-90), 3, 'X'))
    stretch = max(length - 2 * radius, 0.0)
    for v in bm.verts:
        if v.co.y > 1e-6:
            v.co.y += stretch
        v.co.y += radius
    return bm


def metaball_mesh(elements, resolution=0.008, threshold=0.6):
    """Soft blobs melted into one smooth mesh: elements = [((x, y, z), radius), ...]."""
    mb = bpy.data.metaballs.new('MB_Temp')
    mb.resolution = mb.render_resolution = resolution
    mb.threshold = threshold
    for co, r in elements:
        el = mb.elements.new()
        el.co, el.radius = co, r
    tmp = bpy.data.objects.new('MB_Temp', mb)
    bpy.context.scene.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    bpy.data.metaballs.remove(mb)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    return bm


def torus(major, minor, segments=48, sides=16):
    """A ring around the Y axis, centred on the origin."""
    bm = bmesh.new()
    rings = []
    for i in range(segments):
        a = math.tau * i / segments
        ring = []
        for j in range(sides):
            b = math.tau * j / sides
            r = major + minor * math.cos(b)
            ring.append(bm.verts.new((r * math.cos(a), minor * math.sin(b), r * math.sin(a))))
        rings.append(ring)
    for i in range(segments):
        for j in range(sides):
            a, b = rings[i], rings[(i + 1) % segments]
            bm.faces.new((a[j], b[j], b[(j + 1) % sides], a[(j + 1) % sides]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def transform_bm(bm, matrix):
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    return bm


def lathe(profile, steps=96):
    """Spin an (r, z) profile, top to bottom, around Z into a closed smooth solid."""
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0.0, z)) for r, z in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=math.tau, steps=steps,
                   use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def setup_cycles(scene, samples=96, size=(1000, 1000)):
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == kind]
            if gpus:
                for d in prefs.devices:
                    d.use = d.type == kind
                scene.cycles.device = 'GPU'
                break
        except TypeError:
            continue
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.film_transparent = False
    # Khronos PBR Neutral keeps the brand colours true (three.js: NeutralToneMapping), so Blender and the page
    # look alike.
    scene.view_settings.view_transform = 'Khronos PBR Neutral'


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


def camera(name, location, target, lens=60, col=None):
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    cam.data.lens = lens
    cam.location = location
    look_at(cam, target)
    (col or bpy.context.scene.collection).objects.link(cam)
    return cam


def area_light(name, location, target, power, size, color='#FFFFFF', col=None):
    light = bpy.data.objects.new(name, bpy.data.lights.new(name, 'AREA'))
    light.data.energy = power
    light.data.size = size
    light.data.color = lin(color)[:3]
    light.location = location
    look_at(light, target)
    (col or bpy.context.scene.collection).objects.link(light)
    return light


def studio_world(scene, strength=0.5, hdri='studio.exr'):
    world = bpy.data.worlds.new('WLD_Studio')
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes['Background']
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    path = os.path.join(bpy.utils.resource_path('LOCAL'), 'datafiles', 'studiolights', 'world', hdri)
    env.image = bpy.data.images.load(path)
    nt.links.new(env.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = strength
    return world


def render(scene, cam, path):
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('RENDERED', path)
