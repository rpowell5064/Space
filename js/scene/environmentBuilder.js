import * as THREE from 'https://esm.sh/three@0.160.0';
import { makeTexture } from '../textures/planetTextures.js';

export function setupLighting(scene) {
    // Space ambient — dark sides of planets are visible but not washed out
    scene.add(new THREE.AmbientLight(0x334466, 0.75));

    // Sun's radiance — primary scene light; casts shadows up to Saturn's orbit.
    // 1.8 keeps the lit hemisphere at ~0.54 linear (pre-tonemap) for a mid-albedo
    // surface, mapping to ~0.70 after ACES — bright but with readable texture detail.
    const sunLight = new THREE.PointLight(0xFFEECC, 1.8, 8000);
    sunLight.position.set(0, 0, 0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width  = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 5;
    sunLight.shadow.camera.far  = 1200;
    sunLight.shadow.bias = -0.002;
    scene.add(sunLight);
}

// ── Starfield with twinkle shader ─────────────────────────────────────────────
// Custom ShaderMaterial replaces PointsMaterial so we can:
//   • Draw circular discs (default Points are square)
//   • Animate per-star brightness flicker (twinkle) driven by a time uniform
//   • Store per-star base size as a vertex attribute for real size variation
//
// Why twinkle matters: atmospheric scintillation (real twinkling) breaks the
// "painted backdrop" feel. In space there is no atmosphere, so we keep the
// flicker very subtle — it reads as thermal shimmer rather than scintillation.

const _starVertGLSL = /* glsl */`
    attribute float aSize;
    attribute float aSeed;
    varying   vec3  vColor;
    varying   float vSeed;
    uniform   float time;

    void main() {
        vColor = color;
        vSeed  = aSeed;

        // Per-star twinkle: high-freq noise on brightness injected via pointSize
        // The multiply on aSize is 1.0 ± 0.18 — subtle, not cartoonish
        float flicker = 1.0 + 0.18 * sin(time * (2.1 + aSeed * 3.7) + aSeed * 6.28318);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * flicker * (600.0 / -mv.z);
        gl_Position  = projectionMatrix * mv;
    }
`;

const _starFragGLSL = /* glsl */`
    varying vec3  vColor;
    varying float vSeed;

    void main() {
        // Soft circular disc: distance from point centre in [0,1]
        vec2  pc   = gl_PointCoord - 0.5;
        float dist = length(pc) * 2.0;           // 0 = centre, 1 = edge
        float alpha = 1.0 - smoothstep(0.55, 1.0, dist);
        if (alpha < 0.01) discard;

        // Brighter at the very centre — adds a specular-point feel
        float core  = 1.0 - smoothstep(0.0, 0.30, dist);
        vec3  col   = vColor + core * vColor * 0.6;

        gl_FragColor = vec4(col, alpha);
    }
`;

export function createStars(scene) {
    const starColorOptions = [
        [0.62, 0.71, 1.00],  // O/B — blue-white
        [0.82, 0.90, 1.00],  // A   — white
        [1.00, 1.00, 0.88],  // F   — yellow-white
        [1.00, 0.94, 0.50],  // G   — yellow (Sun-like)
        [1.00, 0.70, 0.28],  // K   — orange
        [1.00, 0.38, 0.20],  // M   — red dwarf
    ];

    // Stellar population weighted toward faint G/K/M stars (realistic IMF)
    const typeWeights = [0.02, 0.08, 0.12, 0.25, 0.28, 0.25];
    function pickColor() {
        let r = Math.random();
        for (let i = 0; i < typeWeights.length; i++) {
            r -= typeWeights[i];
            if (r <= 0) return starColorOptions[i];
        }
        return starColorOptions[3];
    }

    function buildLayer(count, rMin, rMax, sizeMin, sizeMax, brightnessMin, brightnessMax) {
        const positions = new Float32Array(count * 3);
        const colors    = new Float32Array(count * 3);
        const sizes     = new Float32Array(count);
        const seeds     = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi   = Math.acos(2 * Math.random() - 1);
            const r     = rMin + Math.random() * (rMax - rMin);
            positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = r * Math.cos(phi);

            const c  = pickColor();
            const b  = brightnessMin + Math.random() * (brightnessMax - brightnessMin);
            colors[i * 3]     = Math.min(1, c[0] * b);
            colors[i * 3 + 1] = Math.min(1, c[1] * b);
            colors[i * 3 + 2] = Math.min(1, c[2] * b);

            sizes[i] = sizeMin + Math.random() * (sizeMax - sizeMin);
            seeds[i] = Math.random();  // unique per-star phase seed for twinkle
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('color',    new THREE.Float32BufferAttribute(colors,    3));
        geo.setAttribute('aSize',    new THREE.Float32BufferAttribute(sizes,     1));
        geo.setAttribute('aSeed',    new THREE.Float32BufferAttribute(seeds,     1));
        return geo;
    }

    // Shared shader material — both star layers reuse this, each with its own time ref
    function makeStarMat() {
        return new THREE.ShaderMaterial({
            uniforms:       { time: { value: 0.0 } },
            vertexShader:   _starVertGLSL,
            fragmentShader: _starFragGLSL,
            vertexColors:   true,
            transparent:    true,
            depthWrite:     false,
            blending:       THREE.AdditiveBlending,
        });
    }

    // Layer 1: 9000 faint background stars
    const bgMat = makeStarMat();
    const bgPoints = new THREE.Points(buildLayer(9000, 5000, 6500, 0.6, 1.8, 0.40, 0.80), bgMat);
    bgPoints.userData.starMat = bgMat;
    scene.add(bgPoints);

    // Layer 2: 250 bright foreground stars — large, vivid, twinkle more visibly
    const fgMat = makeStarMat();
    const fgPoints = new THREE.Points(buildLayer(250, 5000, 6000, 2.2, 5.5, 0.75, 1.00), fgMat);
    fgPoints.userData.starMat = fgMat;
    scene.add(fgPoints);

    // Expose an update handle so main.js can tick time each frame
    scene.userData.starLayers = [bgMat, fgMat];
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
