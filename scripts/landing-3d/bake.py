"""Bakes the café world's light into textures, twice (day and night), and exports one file per zone (ADR 0064).

    blender -b --factory-startup .cache/landing-3d/world.blend -P scripts/landing-3d/bake.py -- [--samples N]

Why: Cycles light (sun through the windows, warm pendants, soft bounce) is far too slow to draw live on a phone.
We bake it once into atlases, so the page draws the still world as a few meshes with one texture each (unlit),
and only the moving or see-through things live: glass, the screens (the real UI, drawn live), the clock's hands,
the sign's letters, plants and the characters. Night is a second, smaller set of atlases the page blends in.

Out (in .cache/landing-3d/, then `node scripts/landing-3d/pack.mjs` writes public/landing/3d/):
  world-<zone>-raw.glb  for zone in st (street), ca (café), ki (kitchen), sr (storeroom), of (office)
  public/landing/3d/night/<atlas>.webp, public/landing/3d/env-*.jpg (360° views for reflections)
"""

import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
import bpy  # noqa: E402

import common as C  # noqa: E402
import world as W  # noqa: E402

BAKE_DIR = os.path.join(C.WORK, 'bake')
NIGHT_DIR = os.path.join(C.PUBLIC, 'night')
os.makedirs(BAKE_DIR, exist_ok=True)
os.makedirs(NIGHT_DIR, exist_ok=True)

ZONES = ('st', 'ca', 'ki', 'sr', 'of')
# Live on the page: see-through, animated, lit at night, or replaced by the real UI.
LIVE_MATERIALS = {'MAT_Glass_Clear', 'MAT_Screen_Till', 'MAT_Decal_Window', 'MAT_Sign_Logo', 'MAT_Sign_Letters'}
LIVE_PREFIXES = ('SM_Clock_Hand_', 'potted_plant_', 'SM_Screen_', 'SM_Live_', 'SM_Sign_Letters', 'SM_Sign_Logo',
                 'SM_Decal_', 'SM_Pendant_Globe_', 'SM_Pendant_Glass_')
SOMETIMES = ('SM_Live_Fries',)
ATLAS_SIZES = {
    'ca_floor': (2048, 2048), 'ca_menu': (2048, 1024), 'ca_room': (2048, 2048), 'ca_counter': (2048, 2048),
    'ca_props': (2048, 2048), 'ca_dining': (2048, 2048),
    'ki_room': (2048, 2048), 'ki_line': (2048, 2048), 'ki_props': (1024, 1024),
    'sr_room': (1024, 1024), 'sr_goods': (2048, 2048),
    'of_room': (1024, 1024), 'of_props': (2048, 2048),
    'st_ground': (2048, 2048), 'st_facade': (2048, 2048), 'st_props': (2048, 2048),
}
# Scans are far denser than a phone needs: at most this many triangles each (by name prefix; default below).
TRIS = {'street_lamp': 3500, 'dining_chair': 3000, 'ceiling_fan': 2500, 'cardboard_box': 500, 'wicker_basket': 2200,
        'bananas': 2500, 'desk_lamp': 3000, 'wooden_bowl': 1500, 'gallon': 900, 'yellow_onion': 450,
        'sweet_potato': 400, 'wooden_spoon': 600, 'milk_churn': 1500, 'clipboard': 700, 'pot_enamel': 2000,
        'office_chair': 4000, 'terrace_set': 4000, 'plastic_crate': 2500, 'wooden_crate': 2500, 'office_desk': 4500,
        'potted_plant_01': 9000, 'potted_plant_office': 7000, 'potted_plant_04': 6000, 'pendant_': 4000,
        'strawberry_chocolate_cake': 5000, 'carrot_cake': 5000, 'croissant': 2500, 'SM_Burger_Bun': 2500,
        'SM_Prep_Bun': 1500, 'round_wooden_table': 4000, 'chair_': 1500, 'metal_stool': 3000, 'counter_stool': 3000,
        'alley_bin': 2000, 'street_bench': 1500}
DEFAULT_TRIS = 3000


def arg(name, default):
    a = C.flags()
    return type(default)(a[a.index(name) + 1]) if name in a else default


def is_live(o):
    return o.name.startswith(LIVE_PREFIXES) or any(m and m.name in LIVE_MATERIALS for m in o.data.materials)


def zone_of(o):
    return str(o.get('atlas', 'ca_props')).split('_')[0]


def triangles(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def decimate(o, ratio):
    mod = o.modifiers.new('Decimate', 'DECIMATE')
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    o.modifiers.remove(mod)
    old = o.data
    o.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)


def select_only(objs, active):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active


def blocked(scene, dg, origin, n, see_through):
    """Is there something solid within 1 cm in front of this point? Glass doesn't count."""
    for _ in range(4):
        hit, loc, _, _, obj, _ = scene.ray_cast(dg, origin, n, distance=0.01)
        if not hit:
            return False
        if obj is None or obj.name not in see_through:
            return True
        origin = loc + n * 0.0005
    return False


def cull_hidden(objs, see_through):
    """Drop faces nobody sees, so they take no room in an atlas: faces pressed against something (checked at the
    centre and near every corner), the undersides of the ground and floors, the tops of the ceilings."""
    scene = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    dropped = 0
    for o in objs:
        mw = o.matrix_world
        normal_mat = mw.to_3x3().inverted().transposed()
        ceiling = o.name.startswith('SM_Ceiling')
        bm = bmesh.new()
        bm.from_mesh(o.data)
        hidden = []
        for f in bm.faces:
            n = (normal_mat @ f.normal).normalized()
            centre = f.calc_center_median()
            wc = mw @ centre
            if (n.z < -0.95 and wc.z < 0.02) or (ceiling and n.z > 0.95):
                hidden.append(f)
                continue
            points = [centre] + [centre.lerp(v.co, 0.85) for v in f.verts]
            if all(blocked(scene, dg, mw @ p + n * 0.002, n, see_through) for p in points):
                hidden.append(f)
        if hidden and len(hidden) < len(bm.faces):
            bmesh.ops.delete(bm, geom=hidden, context='FACES')
            bm.to_mesh(o.data)
            dropped += len(hidden)
        bm.free()
    print('CULLED', dropped, 'hidden faces', flush=True)


def lighten(objs):
    """Each object gets its own mesh (linked copies would share every edit), and dense scans are thinned."""
    kept = 0
    for o in objs:
        if o.data.users > 1:
            o.data = o.data.copy()
        if not o.get('scan') and not o.name.startswith(('potted_plant_', 'pendant_')):
            continue
        limit = next((t for key, t in TRIS.items() if o.name.startswith(key)), DEFAULT_TRIS)
        tris = triangles(o)
        if tris > limit:
            decimate(o, limit / tris)
        kept += triangles(o)
    print('SCAN TRIANGLES', kept, flush=True)


def prepare(objs, see_through):
    cull_hidden(objs, see_through)
    for o in objs:
        me = o.data
        render_uv = me.uv_layers.active
        if render_uv is None:
            render_uv = me.uv_layers.new(name='UVMap')
        render_uv.active_render = True
        bake_uv = me.uv_layers.get('BakeUV') or me.uv_layers.new(name='BakeUV')
        me.uv_layers.active = bake_uv


def split_material(o, material_name, new_name):
    """Move the faces that use one material into their own object (the pendant globes glow live)."""
    idx = next((i for i, m in enumerate(o.data.materials) if m and m.name == material_name), None)
    if idx is None:
        return None
    me = o.data.copy()
    part = bpy.data.objects.new(new_name, me)
    for c in o.users_collection:
        c.objects.link(part)
    part.matrix_world = o.matrix_world.copy()
    part['atlas'] = o.get('atlas', 'ca_props')
    for obj, keep in ((o, False), (part, True)):
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        gone = [f for f in bm.faces if (f.material_index == idx) != keep]
        bmesh.ops.delete(bm, geom=gone, context='FACES')
        bm.to_mesh(obj.data)
        bm.free()
    return part


def copy_render_uv(o):
    src = next(layer for layer in o.data.uv_layers if layer.name != 'BakeUV')
    dst = o.data.uv_layers['BakeUV']
    for i, d in enumerate(src.data):
        dst.data[i].uv = d.uv


def smart_project(objs):
    select_only(objs, objs[0])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')


def surface_area(o):
    s = o.matrix_world.to_scale()
    return sum(p.area for p in o.data.polygons) * abs(s.x * s.y * s.z) ** (2 / 3)


def pack_blocks(objs, margin=0.004):
    """Each object's own 0..1 layout becomes one block of the atlas, sized by its surface area (shelf packing).
    Few big islands per object = every pixel used; a chair gets a chair's share, not a crumb."""
    sizes = {o.name: math.sqrt(max(surface_area(o), 1e-6)) for o in objs}
    order = sorted(objs, key=lambda o: -sizes[o.name])

    def layout(scale):
        x = y = row = 0.0
        cells = {}
        for o in order:
            w = sizes[o.name] * scale
            if w + margin > 1:
                return None
            if x + w + margin > 1:
                x, y, row = 0.0, y + row + margin, 0.0
            cells[o.name] = (x + margin, y + margin, w - margin)
            x += w + margin
            row = max(row, w)
        return cells if y + row + 2 * margin <= 1 else None

    lo, hi = 0.0, 1.0 / max(sizes.values())
    while layout(hi) is not None:  # grow until it no longer fits
        lo, hi = hi, hi * 2
    for _ in range(30):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if layout(mid) is not None else (lo, mid)
    cells = layout(lo)
    for o in objs:
        cx, cy, w = cells[o.name]
        uv = o.data.uv_layers['BakeUV'].data
        us = [d.uv.x for d in uv]
        vs = [d.uv.y for d in uv]
        u0, v0 = min(us), min(vs)
        span = max(max(us) - u0, max(vs) - v0, 1e-6)
        for d in uv:
            d.uv = (cx + (d.uv.x - u0) / span * w, cy + (d.uv.y - v0) / span * w)


def unwrap(objs, keep_existing=False):
    if keep_existing:  # a single flat panel already mapped 0..1 (the menu board)
        for o in objs:
            copy_render_uv(o)
        return
    built = [o for o in objs if not o.get('scan')]
    for o in objs:
        if o.get('scan'):
            copy_render_uv(o)  # scanned models come with clean, non-overlapping UVs
    for o in built:  # each built part unwrapped on its own, filling its own square
        smart_project([o])
    pack_blocks(objs)


def join(objs):
    target = objs[0]
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=target, object=target, selected_objects=objs,
                                       selected_editable_objects=objs):
            bpy.ops.object.join()
    me = target.data
    me.uv_layers.active = me.uv_layers['BakeUV']
    return target


def bake(name, size, obj, samples, path, fmt):
    img = bpy.data.images.new(f'T_Bake_{name}_{fmt}', size[0], size[1], float_buffer=True)
    for mat in obj.data.materials:
        if mat is None or not mat.use_nodes:
            continue
        nodes = mat.node_tree.nodes
        node = nodes.get('BAKE_TARGET') or nodes.new('ShaderNodeTexImage')
        node.name = 'BAKE_TARGET'
        node.image = img
        nodes.active = node
    scene = bpy.context.scene
    scene.cycles.samples = samples
    # Denoise on the CPU: the GPU denoiser runs out of memory on 2K bakes (RTX 3050).
    scene.cycles.use_denoising = True
    scene.cycles.denoising_use_gpu = False
    select_only([obj], obj)
    margin = 6 if size[0] >= 2048 else 4
    bpy.ops.object.bake(type='COMBINED', target='IMAGE_TEXTURES', use_clear=True, margin=margin)
    settings = scene.render.image_settings
    settings.file_format = fmt
    if fmt == 'WEBP':
        settings.quality = 80
    # Saved as the camera sees it (Khronos PBR Neutral): the page draws these unlit, untouched.
    img.save_render(filepath=path, scene=scene)
    bpy.data.images.remove(img)
    print('BAKED', name, fmt, size, '->', path, flush=True)
    return path


def merge(name, obj, png):
    """One mesh per atlas, one unlit-ready material, only the baked UVs."""
    obj.name = f'BK_{name}'
    me = obj.data
    for layer in [layer for layer in me.uv_layers if layer.name != 'BakeUV']:
        me.uv_layers.remove(layer)
    me.uv_layers['BakeUV'].name = 'UVMap'
    mat = bpy.data.materials.new(f'MAT_BK_{name}')
    mat.use_nodes = True
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(png)
    bsdf = mat.node_tree.nodes['Principled BSDF']
    mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Specular IOR Level'].default_value = 0.0
    me.materials.clear()
    me.materials.append(mat)
    for p in me.polygons:
        p.material_index = 0
    return obj


def live_glass():
    """For the page: glass as a faint see-through surface (the env map gives it its sheen)."""
    mat = bpy.data.materials.get('MAT_Glass_Clear')
    if not mat:
        return
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    for n in list(nodes):
        if n.type != 'OUTPUT_MATERIAL':
            nodes.remove(n)
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (0.92, 0.95, 0.96, 1)
    bsdf.inputs['Roughness'].default_value = 0.04
    bsdf.inputs['Alpha'].default_value = 0.12
    links.new(bsdf.outputs['BSDF'], nodes['Material Output'].inputs['Surface'])
    mat.surface_render_method = 'BLENDED'


def keep_colour_only(objs):
    """Live scans keep only their colour (and see-through) texture: the page lights them itself, and their extra
    maps (roughness, normals) are copies Blender cannot write out."""
    for o in objs:
        for mat in o.data.materials:
            if not mat or not mat.node_tree:
                continue
            nt = mat.node_tree
            bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            keep = set()
            if bsdf:
                for name in ('Base Color', 'Alpha'):
                    for link in bsdf.inputs[name].links:
                        keep.add(link.from_node.name)
            for n in list(nt.nodes):
                if n.type in ('TEX_IMAGE', 'NORMAL_MAP') and n.name not in keep:
                    nt.nodes.remove(n)


def export_zones(merged, live):
    keep_colour_only(live)
    for zone in ZONES:
        out = [o for o in merged + live if zone_of(o) == zone]
        if not out:
            continue
        select_only(out, out[0])
        path = os.path.join(C.WORK, f'world-{zone}-raw.glb')
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                                  export_yup=True, export_animations=False, export_lights=False,
                                  export_cameras=False, export_extras=False, export_image_format='WEBP',
                                  export_image_quality=82, export_materials='EXPORT')
        print('EXPORTED', zone, os.path.getsize(path), 'live:', [o.name for o in out if o in live], flush=True)


def env_panorama(at, path):
    """A 360° view of the lit world from one place: reflections for the live objects."""
    scene = bpy.context.scene
    cam = bpy.data.objects.get('CAM_Env') or bpy.data.objects.new('CAM_Env', bpy.data.cameras.new('CAM_Env'))
    if cam.name not in scene.collection.objects:
        scene.collection.objects.link(cam)
    cam.data.type = 'PANO'
    cam.data.panorama_type = 'EQUIRECTANGULAR'
    cam.location = at
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.camera = cam
    rx, ry, samples = scene.render.resolution_x, scene.render.resolution_y, scene.cycles.samples
    scene.render.resolution_x, scene.render.resolution_y = 1024, 512
    scene.render.resolution_percentage = 100
    scene.cycles.samples = 96
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = 86
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    scene.render.resolution_x, scene.render.resolution_y, scene.cycles.samples = rx, ry, samples
    print('ENV', path, flush=True)


def main():
    samples = arg('--samples', 192)
    scene = bpy.context.scene
    C.setup_cycles(scene, samples=samples, size=(1280, 720))
    W.set_time(scene, night=False)
    statics = [o for o in scene.objects if o.type == 'MESH' and o.visible_get() and not o.name.startswith('PROTO_')]
    lighten(statics)
    # The pendants' frosted glass and globes glow live (a bake makes lit glass look blotchy).
    for o in [o for o in statics if o.name.startswith('pendant_')]:
        i = o.name.split('_')[-1]
        for material, part in (('modern_ceiling_lamp_01_glass', 'Glass'), ('modern_ceiling_globe', 'Globe')):
            piece = split_material(o, material, f'SM_Pendant_{part}_{i}')
            if piece:
                statics.append(piece)
    live = [o for o in statics if is_live(o)]
    baked = [o for o in statics if o not in live]
    # What the story shows only now and then (the dropped fries) casts no shadow into the still world: before,
    # their dark marks waited on the kitchen floor all day (the founder, 2026-11-17).
    for o in live:
        if o.name.startswith(SOMETIMES):
            o.hide_render = True
    groups = {}
    for o in baked:
        groups.setdefault(str(o.get('atlas', 'ca_props')), []).append(o)
    print('ATLASES', {k: len(v) for k, v in groups.items()}, flush=True)
    prepare(baked, see_through={o.name for o in live})
    for name, members in groups.items():
        unwrap(members, keep_existing=name == 'ca_menu')
    # One object per atlas before baking: Cycles bakes objects one by one, ~16 s of overhead each.
    joined = {name: join(members) for name, members in groups.items()}
    pngs = {}
    # `--only ca_dining,ca_floor` bakes just those atlases (day and night) and reuses the saved day pictures
    # and night maps of the rest: for a small change on a machine short of memory. Safe only while the other
    # atlases' geometry is unchanged (their UVs unwrap the same way again).
    only = [n for n in arg('--only', '').split(',') if n]
    # `--texture-limit 2048` shrinks the scans' source textures while rendering, for a machine short of memory.
    limit = arg('--texture-limit', '')
    if limit:
        scene.cycles.texture_limit_render = limit
    for night in (False, True):
        W.set_time(scene, night)
        for name, obj in joined.items():
            started = time.time()
            size = ATLAS_SIZES.get(name, (2048, 2048))
            if only and name not in only:
                if not night:
                    pngs[name] = os.path.join(BAKE_DIR, f'{name}.png')
                    assert os.path.exists(pngs[name]), f'no saved bake for {name}'
                continue
            if night:
                bake(name, (size[0] // 2, size[1] // 2), obj, max(96, samples // 2),
                     os.path.join(NIGHT_DIR, f'{name}.webp'), 'WEBP')
            else:
                pngs[name] = bake(name, size, obj, samples, os.path.join(BAKE_DIR, f'{name}.png'), 'PNG')
            print('TOOK', name, 'night' if night else 'day', round(time.time() - started), 's', flush=True)
    W.set_time(scene, night=False)
    if not only:
        env_views(scene)
    merged = [merge(name, obj, pngs[name]) for name, obj in joined.items()]
    live_glass()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(C.WORK, 'world-baked.blend'))
    export_zones(merged, live)


def env_views(scene):
    """The 360° views the page lights its live parts with."""
    env_panorama((2.9, 0.0, 1.3), os.path.join(C.PUBLIC, 'env-cafe-day.jpg'))
    env_panorama((1.75, -6.6, 1.5), os.path.join(C.PUBLIC, 'env-street-day.jpg'))
    W.set_time(scene, night=True)
    env_panorama((2.9, 0.0, 1.3), os.path.join(C.PUBLIC, 'env-cafe-night.jpg'))
    W.set_time(scene, night=False)


def export_only():
    """Re-export the zones from world-baked.blend without baking again."""
    scene = bpy.context.scene
    merged = [o for o in scene.objects if o.name.startswith('BK_')]
    live = [o for o in scene.objects if o.type == 'MESH' and o.visible_get()
            and not o.name.startswith(('PROTO_', 'BK_'))]
    export_zones(merged, live)


if __name__ == '__main__':
    if '--export-only' in C.flags():
        export_only()
    else:
        main()
    print('BAKE OK')
