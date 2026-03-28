import * as THREE from 'https://esm.sh/three@0.160.0';
import { makeTexture } from '../textures/planetTextures.js';

export function setupLighting(scene) {
    // Space ambient — dark sides of planets are visible but not washed out
    scene.add(new THREE.AmbientLight(0x334466, 0.75));

    // Sun's radiance — primary scene light; casts shadows up to Saturn's orbit
    const sunLight = new THREE.PointLight(0xFFEECC, 4.5, 8000);
    sunLight.position.set(0, 0, 0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width  = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 5;
    sunLight.shadow.camera.far  = 1200;
    sunLight.shadow.bias = -0.002;
    scene.add(sunLight);
}

export function createStars(scene) {
    const starColorOptions = [
        [0.6, 0.7, 1.0],   // blue-white
        [1.0, 1.0, 1.0],   // white
        [1.0, 1.0, 0.8],   // yellow-white
        [1.0, 0.9, 0.4],   // yellow
        [1.0, 0.6, 0.3],   // orange
        [1.0, 0.3, 0.2],   // red
    ];

    // 8000 small stars
    const count = 8000;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 5000 + Math.random() * 1500;
        positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);

        const c = starColorOptions[Math.floor(Math.random() * starColorOptions.length)];
        const brightness = 0.5 + Math.random() * 0.5;
        colors[i * 3]     = c[0] * brightness;
        colors[i * 3 + 1] = c[1] * brightness;
        colors[i * 3 + 2] = c[2] * brightness;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.8, vertexColors: true, sizeAttenuation: true })));

    // 200 larger bright stars
    const brightCount = 200;
    const brightPos = new Float32Array(brightCount * 3);
    const brightCol = new Float32Array(brightCount * 3);

    for (let i = 0; i < brightCount; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 5000 + Math.random() * 1500;
        brightPos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
        brightPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        brightPos[i * 3 + 2] = r * Math.cos(phi);

        const c = starColorOptions[Math.floor(Math.random() * starColorOptions.length)];
        brightCol[i * 3]     = c[0];
        brightCol[i * 3 + 1] = c[1];
        brightCol[i * 3 + 2] = c[2];
    }

    const brightGeo = new THREE.BufferGeometry();
    brightGeo.setAttribute('position', new THREE.Float32BufferAttribute(brightPos, 3));
    brightGeo.setAttribute('color', new THREE.Float32BufferAttribute(brightCol, 3));
    scene.add(new THREE.Points(brightGeo, new THREE.PointsMaterial({ size: 2.0, vertexColors: true, sizeAttenuation: true })));
}

// Private noise helpers
function hash(x, y) {
    return Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
}

function noise(x, y) {
    const xf = Math.floor(x), yf = Math.floor(y);
    const tl = hash(xf, yf);
    const tr = hash(xf + 1, yf);
    const bl = hash(xf, yf + 1);
    const br = hash(xf + 1, yf + 1);
    const xt = x - xf, yt = y - yf;

    const top = tl * (1 - xt) + tr * xt;
    const bottom = bl * (1 - xt) + br * xt;
    return top * (1 - yt) + bottom * yt;
}

function fbm(x, y) {
    let value = 0;
    let amp = 0.5;
    let freq = 0.002;

    for (let i = 0; i < 5; i++) {
        value += noise(x * freq, y * freq) * amp;
        freq *= 2.1;
        amp *= 0.5;
    }
    return value;
}

export function createGalaxyBackground(scene) {
    // High resolution to eliminate aliasing
    const W = 4096, H = 2048;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Base deep space
    ctx.fillStyle = '#000008';
    ctx.fillRect(0, 0, W, H);

    // Galactic core glow
    const core = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, 700);
    core.addColorStop(0,   'rgba(255,220,160,0.55)');
    core.addColorStop(0.2, 'rgba(200,150,100,0.32)');
    core.addColorStop(0.5, 'rgba(100,80,160,0.18)');
    core.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, W, H);

    // Milky Way disk band
    const disk = ctx.createLinearGradient(0, H*0.25, 0, H*0.75);
    disk.addColorStop(0,    'rgba(0,0,0,0)');
    disk.addColorStop(0.15, 'rgba(40,50,90,0.22)');
    disk.addColorStop(0.35, 'rgba(70,80,130,0.38)');
    disk.addColorStop(0.5,  'rgba(90,100,160,0.46)');
    disk.addColorStop(0.65, 'rgba(70,80,130,0.38)');
    disk.addColorStop(0.85, 'rgba(40,50,90,0.22)');
    disk.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = disk;
    ctx.fillRect(0, H*0.25, W, H*0.5);

    // FBM noise for dust lanes
    const dustCanvas = document.createElement('canvas');
    dustCanvas.width = W;
    dustCanvas.height = H;
    const dctx = dustCanvas.getContext('2d');
    const dustData = dctx.createImageData(W, H);
    const dd = dustData.data;

    // Generate dust lanes
    for (let y = 0; y < H; y++) {
        const band = Math.abs((y / H) - 0.5); // distance from galactic equator
        const bandMask = Math.max(0, 1 - band * 3);

        for (let x = 0; x < W; x++) {
            const n = fbm(x, y);
            const dust = Math.max(0, n - 0.45) * bandMask;

            const v = Math.floor(dust * 40);
            const i = (y * W + x) * 4;

            dd[i] = dd[i+1] = dd[i+2] = v;
            dd[i+3] = v * 6;
        }
    }

    dctx.putImageData(dustData, 0, 0);
    ctx.drawImage(dustCanvas, 0, 0);

    // Nebula patches (scaled up for 4K)
    [
        { x:0.14, y:0.48, rx:260, ry:120, c:'rgba(80,40,120,0.08)' },
        { x:0.37, y:0.53, rx:310, ry:124, c:'rgba(40,80,140,0.07)' },
        { x:0.63, y:0.45, rx:230, ry:104, c:'rgba(120,50,80,0.06)' },
        { x:0.83, y:0.56, rx:190, ry:84,  c:'rgba(40,120,80,0.05)' },
        { x:0.07, y:0.63, rx:144, ry:72,  c:'rgba(80,60,140,0.06)' },
        { x:0.93, y:0.41, rx:210, ry:96,  c:'rgba(100,70,40,0.05)' },
    ].forEach(({ x, y, rx, ry, c }) => {
        const cx = x*W, cy = y*H, rmax = Math.max(rx, ry);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rmax);
        g.addColorStop(0, c);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(rx/rmax, ry/rmax);
        ctx.translate(-cx, -cy);
        ctx.beginPath();
        ctx.arc(cx, cy, rmax, 0, Math.PI*2);
        ctx.fill();
        ctx.restore();
    });

    // Dense star field
    for (let i = 0; i < 9000; i++) {
        const inBand = Math.random() < 0.65;
        const px = Math.random() * W;
        const py = inBand ? H*0.30 + Math.random() * H*0.40 : Math.random() * H;
        const bright = 0.12 + Math.random() * 0.70;
        const sz = Math.random() < 0.97 ? 0.5 : 1.3;
        const t = Math.random();
        const rc = t < 0.25 ? 180 : t < 0.40 ? 255 : 220;
        const gc = t < 0.25 ? 200 : t < 0.40 ? 220 : 220;
        const bc = t < 0.25 ? 255 : t < 0.40 ? 150 : 220;
        ctx.fillStyle = `rgba(${Math.floor(rc*bright)},${Math.floor(gc*bright)},${Math.floor(bc*bright)},${bright})`;
        ctx.beginPath();
        ctx.arc(px, py, sz, 0, Math.PI*2);
        ctx.fill();
    }

    // Dither to remove banding
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * 6;
        d[i] += n;
        d[i+1] += n;
        d[i+2] += n;
    }
    ctx.putImageData(img, 0, 0);

    // Create texture and sphere
    const tex = makeTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;

    scene.add(new THREE.Mesh(
        new THREE.SphereGeometry(8000, 256, 128),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide })
    ));
}
