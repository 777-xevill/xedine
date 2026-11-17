"""Downloads the free (CC0, Poly Haven) models and textures the 3D café uses, once, into .cache/landing-3d/assets.

Plain Python (not Blender):  python scripts/landing-3d/fetch_assets.py
Poly Haven assets are CC0: no attribution needed, free for commercial use. Nothing with a brand name or
writing on it is used (the café must work in every country), and no alcohol.
"""

import json
import os
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ASSETS = os.path.join(ROOT, '.cache', 'landing-3d', 'assets')
HEADERS = {'User-Agent': 'landing-3d-build/1.0'}

MODELS = [
    # The dining room
    'round_wooden_table_01', 'painted_wooden_chair_01', 'metal_stool_01', 'metal_stool_03',
    'modern_ceiling_lamp_01', 'potted_plant_01', 'potted_plant_04', 'ceramic_vase_01', 'standing_chalkboard_01',
    'steel_frame_shelves_01',
    # Food and the counter
    'croissant', 'carrot_cake', 'strawberry_chocolate_cake', 'hamburger_buns', 'lemon', 'wooden_cutting_board',
    # The storeroom
    'cardboard_box_01', 'wooden_crate_01', 'steel_frame_shelves_03', 'steel_frame_shelves_02', 'wooden_crate_02',
    'plastic_crate_01', 'plastic_crate_02', 'CheeseBox_01', 'plastic_bottle_gallon', 'wicker_basket_01',
    'wicker_basket_02', 'food_apple_01', 'bananas', 'metal_trash_can',
    # The kitchen
    'brass_pan_01', 'pot_enamel_01', 'brass_pot_01', 'wooden_spoon', 'yellow_onion', 'sweet_potato', 'wooden_bowl_01',
    'metal_jug', 'clipboard',
    # The office
    'metal_office_desk', 'modern_arm_chair_01', 'sofa_02', 'desk_lamp_arm_01', 'potted_plant_02', 'painted_wooden_shelves', 'modern_coffee_table_01',
    # The street and the dining room
    'street_lamp_01', 'modular_street_seating', 'planter_box_01', 'outdoor_table_chair_set_01', 'rollershutter_door',
    'rollershutter_window_01', 'utility_box_01', 'round_wooden_table_02', 'dining_chair_02', 'painted_wooden_bench',
    'ceiling_fan',
]
TEXTURES = {
    'herringbone_parquet': '2k', 'plastered_wall_02': '2k', 'long_white_tiles': '2k', 'marble_01': '2k',
    'oak_veneer_01': '2k', 'walnut_veneer': '2k',
    # The street, the kitchen, the storeroom and the office
    'interlocking_concrete_pavers': '2k', 'clean_asphalt': '2k', 'painted_plaster_wall': '2k', 'anti_skid_tiles': '2k',
    'painted_concrete': '2k', 'laminate_floor_02': '2k', 'brown_brick_02': '2k', 'concrete_floor_02': '1k',
}
# The page's own typeface (Inter, SIL Open Font License) for the name on the sign and the boards.
FONTS = {'Inter-ExtraBold.ttf': 'Inter:wght@800', 'Inter-SemiBold.ttf': 'Inter:wght@600'}


def fetch_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60) as r:
        return json.load(r)


def download(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=120) as r:
        data = r.read()
    with open(path, 'wb') as f:
        f.write(data)
    return True


def fetch_model(asset_id, res='1k'):
    info = fetch_json(f'https://api.polyhaven.com/files/{asset_id}')
    if 'gltf' not in info:
        print('no glTF for', asset_id, flush=True)
        return False
    gltf = info['gltf'][res]['gltf']
    base = os.path.join(ASSETS, 'models', asset_id)
    got = download(gltf['url'], os.path.join(base, f'{asset_id}.gltf'))
    for rel, f in gltf.get('include', {}).items():
        got |= download(f['url'], os.path.join(base, rel))
    return got


def fetch_texture(asset_id, res):
    info = fetch_json(f'https://api.polyhaven.com/files/{asset_id}')
    got = False
    for key in ('Diffuse', 'nor_gl', 'Rough', 'AO'):
        if key in info and res in info[key] and 'jpg' in info[key][res]:
            got |= download(info[key][res]['jpg']['url'], os.path.join(ASSETS, 'textures', asset_id, f'{key}.jpg'))
    return got


def fetch_font(name, family):
    """Google Fonts hands a plain TTF to a client that doesn't ask for WOFF2."""
    path = os.path.join(ASSETS, 'fonts', name)
    if os.path.exists(path):
        return False
    req = urllib.request.Request(f'https://fonts.googleapis.com/css2?family={family}', headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as r:
        css = r.read().decode('utf-8')
    import re
    url = re.search(r'url\((https://[^)]+)\)', css).group(1)
    return download(url, path)


if __name__ == '__main__':
    for m in MODELS:
        print('model', m, 'downloaded' if fetch_model(m) else 'cached', flush=True)
    for t, res in TEXTURES.items():
        print('texture', t, 'downloaded' if fetch_texture(t, res) else 'cached', flush=True)
    for name, family in FONTS.items():
        print('font', name, 'downloaded' if fetch_font(name, family) else 'cached', flush=True)
    print('ASSETS OK')
