#!/usr/bin/env python3
"""
Download free 2K planet textures from Solar System Scope (free for non-commercial use).
Run this once from the project directory, then refresh the browser.

Usage:
    python download-textures.py
"""
import urllib.request, ssl, os, sys

os.makedirs('textures', exist_ok=True)

BASE = 'https://www.solarsystemscope.com/textures/download/'
FILES = [
    '2k_sun.jpg',
    '2k_mercury.jpg',
    '2k_venus_surface.jpg',
    '2k_earth_daymap.jpg',
    '2k_mars.jpg',
    '2k_jupiter.jpg',
    '2k_saturn.jpg',
    '2k_uranus.jpg',
    '2k_neptune.jpg',
    '2k_saturn_ring_alpha.png',
]

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode   = ssl.CERT_NONE

ok = 0
for name in FILES:
    dest = os.path.join('textures', name)
    if os.path.exists(dest):
        print(f'  [skip]  {name}  (already exists)')
        ok += 1
        continue
    print(f'  downloading {name} ...', end=' ', flush=True)
    try:
        req = urllib.request.Request(
            BASE + name,
            headers={
                'User-Agent': 'Mozilla/5.0 (compatible; solar-system-texture-downloader/1.0)',
                'Referer':    'https://www.solarsystemscope.com/textures/',
            }
        )
        with urllib.request.urlopen(req, context=ctx, timeout=30) as r:
            data = r.read()
        if len(data) < 10_000:
            raise ValueError(f'Response too small ({len(data)} bytes) — likely an error page')
        with open(dest, 'wb') as f:
            f.write(data)
        print(f'OK  ({len(data)//1024} KB)')
        ok += 1
    except Exception as e:
        print(f'FAILED\n    Error: {e}')

print(f'\n{ok}/{len(FILES)} textures ready in ./textures/')
if ok < len(FILES):
    print('\nFor any that failed, download them manually from:')
    print('  https://www.solarsystemscope.com/textures/')
    print('and save them to the ./textures/ folder with the names listed above.')
print('\nThen restart the server and refresh your browser.')
