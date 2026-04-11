import * as THREE from 'https://esm.sh/three@0.160.0';
import { CSS2DObject } from 'https://esm.sh/three@0.160.0/examples/jsm/renderers/CSS2DRenderer.js';
import { loadPlanetTexture, createSaturnRingTexture, createMoonTexture } from '../textures/planetTextures.js';
import { createScatteringAtmosphereMaterial, createJupiterOverlayMaterial, createEarthCloudMaterial } from '../shaders/sunShader.js';
import { ATMOSPHERE_COLORS, ATMOSPHERE_CONFIG } from '../data/solarSystemData.js';

// ── Per-planet PBR surface properties ────────────────────────────────────────
// Why this matters: a gas giant's cloud tops scatter light differently from
// a barren rocky body. Roughness controls the spread of specular highlights.
// Metalness is 0 for all planets (none are conductive at macroscopic scale),
// but gas/ice giants get slightly lower roughness for their reflective cloud tops.
// Roughness ≥ 0.85 keeps highlights broad and diffuse so planet textures read
// clearly at scene scale. Lower values (< 0.8) produce a tight specular blob
// that washes out the texture when lit by the sun's point light.
const PLANET_PBR = {
    Mercury: { roughness: 0.95, metalness: 0.02 }, // bare cratered silicate rock
    Venus:   { roughness: 0.90, metalness: 0.00 }, // thick cloud deck — bright but diffuse
    Earth:   { roughness: 0.88, metalness: 0.00 }, // mixed land and ocean
    Mars:    { roughness: 0.93, metalness: 0.02 }, // iron-oxide dust, thin atmosphere
    Jupiter: { roughness: 0.88, metalness: 0.00 }, // cloud tops — broad diffuse highlight
    Saturn:  { roughness: 0.88, metalness: 0.00 }, // ammonia ice haze
    Uranus:  { roughness: 0.85, metalness: 0.00 }, // methane-ice cloud deck
    Neptune: { roughness: 0.85, metalness: 0.00 }, // methane-ice cloud tops
};

// ── Async texture loader helper ───────────────────────────────────────────────
// Wraps TextureLoader.load() in a Promise; resolves to null on failure so callers
// can use the ?? operator to fall back to a procedural texture gracefully.
// linear=true skips the sRGB tag — correct for normal/bump maps (linear data).
async function loadTex(path, loader, linear = false) {
    return new Promise(resolve => {
        loader.load(path,
            tex => { if (!linear) tex.colorSpace = THREE.SRGBColorSpace; resolve(tex); },
            undefined,
            () => resolve(null));
    });
}

// ── Procedural Earth city lights (emissive map) ───────────────────────────────
// Painted onto a 2048×1024 canvas and assigned as MeshStandardMaterial.emissiveMap.
// City lights are only visible on the night side because on the day side the sun's
// diffuse contribution (≫ emissiveIntensity) completely overwhelms the faint glow.
// Approach: major metropolitan cluster radial gradients + scattered random dots
// for the long tail of smaller cities.
function createEarthNightLightsTexture() {
    const W = 2048, H = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);

    // lonDeg, latDeg → canvas pixel (equirectangular projection)
    function px(lon, lat) {
        return [(lon + 180) / 360 * W, (90 - lat) / 180 * H];
    }

    function cluster(lon, lat, r, intensity) {
        const [x, y] = px(lon, lat);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0.00, `rgba(255,210,120,${Math.min(1, intensity)})`);
        g.addColorStop(0.45, `rgba(255,175, 70,${Math.min(1, intensity * 0.45)})`);
        g.addColorStop(1.00, 'rgba(255,140, 40,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // Major clusters: [lon, lat, radius_px, intensity]
    // Clustered by continent to keep the list short but geographically accurate
    [
        // ── Eastern North America ────────────────────────────────────────────
        [-74, 40.7, 38, 0.90], [-87, 41.8, 32, 0.82], [-71, 42.3, 26, 0.70],
        [-79, 43.7, 24, 0.65], [-80, 25.8, 22, 0.58], [-75, 39.9, 20, 0.58],
        [-84, 33.7, 20, 0.55], [-95, 29.7, 26, 0.60], [-90, 29.9, 20, 0.50],
        // ── Western North America ────────────────────────────────────────────
        [-118, 34.0, 30, 0.78], [-122, 37.7, 24, 0.65], [-122, 47.6, 20, 0.55],
        [-96, 32.8, 18, 0.48], [-112, 33.4, 16, 0.45],
        // ── Western Europe ───────────────────────────────────────────────────
        [-0.1, 51.5, 36, 0.92], [2.3, 48.9, 34, 0.90], [13.4, 52.5, 30, 0.86],
        [11.6, 48.1, 28, 0.80], [4.9, 52.4, 26, 0.76], [12.5, 41.9, 28, 0.80],
        [2.2, 41.4, 24, 0.68], [18.0, 59.3, 16, 0.50], [24.9, 60.2, 14, 0.44],
        [21.0, 52.2, 18, 0.55], [30.3, 59.9, 20, 0.60], [37.6, 55.7, 28, 0.74],
        [28.9, 41.0, 26, 0.70],
        // ── Middle East / North Africa ───────────────────────────────────────
        [31.2, 30.1, 24, 0.68], [35.2, 31.8, 20, 0.58], [44, 33.0, 20, 0.55],
        [55.3, 25.2, 22, 0.62], [46.7, 24.7, 20, 0.58],
        // ── South Asia ───────────────────────────────────────────────────────
        [72.8, 19.1, 30, 0.82], [77.2, 28.6, 28, 0.80], [88.4, 22.5, 24, 0.70],
        [80.3, 13.1, 24, 0.70], [77.6, 12.9, 22, 0.65], [67.0, 24.9, 20, 0.58],
        [74.3, 31.5, 18, 0.52],
        // ── East Asia ────────────────────────────────────────────────────────
        [139.7, 35.7, 38, 0.96], [135.5, 34.7, 28, 0.82], [127.0, 37.6, 26, 0.76],
        [121.5, 31.2, 36, 0.92], [116.4, 39.9, 34, 0.90], [113.2, 23.1, 28, 0.82],
        [114.2, 22.3, 28, 0.82], [104.0, 30.7, 20, 0.58], [106.5, 29.6, 18, 0.52],
        [121.5, 25.0, 26, 0.72],
        // ── Southeast Asia ───────────────────────────────────────────────────
        [103.8,  1.3, 20, 0.65], [106.8, -6.2, 22, 0.62], [100.5, 13.7, 20, 0.58],
        [120.9, 14.6, 16, 0.48],
        // ── Australia ────────────────────────────────────────────────────────
        [151.2, -33.9, 22, 0.65], [144.9, -37.8, 20, 0.60], [153.0, -27.5, 16, 0.48],
        // ── South America ────────────────────────────────────────────────────
        [-46.6, -23.5, 30, 0.80], [-43.2, -22.9, 26, 0.75], [-58.4, -34.6, 22, 0.65],
        [-70.6, -33.5, 18, 0.55], [-74.1,   4.7, 16, 0.50],
        // ── Sub-Saharan Africa ───────────────────────────────────────────────
        [3.4, 6.4, 20, 0.58], [36.8, -1.3, 16, 0.46], [28.0, -26.2, 18, 0.52],
        [18.4, -33.9, 14, 0.44],
    ].forEach(([lon, lat, r, i]) => cluster(lon, lat, r, i));

    // Scattered background light — hundreds of smaller cities as random dots
    for (let i = 0; i < 1800; i++) {
        const lon = -180 + Math.random() * 360;
        const lat =  -60 + Math.random() * 140;
        // Skip polar regions and open ocean (rough heuristic: skip high latitudes beyond 65°)
        if (Math.abs(lat) > 65 && Math.random() > 0.1) continue;
        const [x, y] = px(lon, lat);
        const r = 0.8 + Math.random() * 1.8;
        const a = Math.random() * 0.22;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,195,90,${a})`;
        ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

// Singleton — only generate once
let _earthNightLights = null;
function getEarthNightLights() {
    if (!_earthNightLights) _earthNightLights = createEarthNightLightsTexture();
    return _earthNightLights;
}

export async function createPlanet(data, scene, textureLoader) {
    const planetGroup = new THREE.Group();
    const startAngle = Math.random() * Math.PI * 2;

    // Elliptical orbit parameters — sun sits at one focus
    const e  = data.eccentricity || 0;
    const a  = data.distance;           // semi-major axis
    const b  = a * Math.sqrt(1 - e*e); // semi-minor axis
    const fc = a * e;                   // focal offset (center -> focus)

    // Starting position on ellipse (sun at origin = one focus)
    planetGroup.position.set(
        fc + a * Math.cos(startAngle),
        0,
        b  * Math.sin(startAngle)
    );

    // Orbit path — EllipseCurve centered so sun is at the correct focus
    const curve = new THREE.EllipseCurve(fc, 0, a, b, 0, 2 * Math.PI, false, 0);
    const orbitGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(128));
    const orbitLine = new THREE.Line(orbitGeo, new THREE.LineBasicMaterial({
        color: 0x444466, transparent: true, opacity: 0.35
    }));
    orbitLine.rotation.x = Math.PI / 2;
    scene.add(orbitLine);

    // Planet mesh — MeshStandardMaterial with per-planet PBR properties.
    // Different worlds have measurably different surface scattering:
    //   Rocky bodies (Mercury, Mars) are rough; reflectance is diffuse and low.
    //   Gas/ice giant cloud tops (Jupiter→Neptune) are smoother and more reflective
    //   because you're seeing continuous layered aerosol clouds, not jagged terrain.
    const texture = await loadPlanetTexture(data.name, textureLoader);
    const geo = new THREE.SphereGeometry(data.size, 64, 64);
    const pbr = PLANET_PBR[data.name] ?? { roughness: 0.85, metalness: 0.0 };
    const matOpts = { map: texture, roughness: pbr.roughness, metalness: pbr.metalness };

    // ── Per-planet extra maps loaded in parallel ──────────────────────────────
    let _earthCloudTex = null;

    if (data.name === 'Earth') {
        // NASA night-lights (city glow on dark side), surface normal map, cloud texture
        const [nightTex, normalTex, cloudTex] = await Promise.all([
            loadTex('./textures/earth_lights_2048.png', textureLoader),
            loadTex('./textures/earth_normal_2048.jpg',  textureLoader, true),
            loadTex('./textures/earth_clouds_1024.png',  textureLoader),
        ]);
        if (nightTex) {
            matOpts.emissiveMap       = nightTex;
            matOpts.emissive          = new THREE.Color(0xffffff);
            matOpts.emissiveIntensity = 0.85; // visible at night, overwhelmed on day side
        } else {
            // Fallback: procedural canvas city lights
            matOpts.emissiveMap       = getEarthNightLights();
            matOpts.emissive          = new THREE.Color(0xffffff);
            matOpts.emissiveIntensity = 0.6;
        }
        if (normalTex) {
            matOpts.normalMap   = normalTex;
            matOpts.normalScale = new THREE.Vector2(0.5, 0.5);
        }
        _earthCloudTex = cloudTex; // used below for cloud mesh
    }

    if (data.name === 'Mercury') {
        const bumpTex = await loadTex('./textures/mercury_bump.jpg', textureLoader, true);
        if (bumpTex) { matOpts.bumpMap = bumpTex; matOpts.bumpScale = 0.04; }
    }

    if (data.name === 'Mars') {
        const bumpTex = await loadTex('./textures/mars_bump.jpg', textureLoader, true);
        if (bumpTex) { matOpts.bumpMap = bumpTex; matOpts.bumpScale = 0.07; }
    }

    const mat = new THREE.MeshStandardMaterial(matOpts);
    const planet = new THREE.Mesh(geo, mat);
    planet.castShadow    = true;
    planet.receiveShadow = false; // night side handled by NdotL; cube shadow map creates black-square artifacts at close range
    planet.rotation.z = THREE.MathUtils.degToRad(data.axialTilt || 0);
    planet.userData = { name: data.name, distance: data.distance, speed: data.speed, angle: startAngle, isPlanet: true };
    planetGroup.add(planet);

    // Floating label above the planet
    const labelDiv = document.createElement('div');
    labelDiv.className = 'planet-label';
    labelDiv.textContent = data.name;
    const label = new CSS2DObject(labelDiv);
    label.position.set(0, data.size * 1.4 + 2, 0);
    planet.add(label);

    // Saturn rings with UV remap for ring-band gradient
    if (data.hasRing) {
        const innerR = data.size * 1.4;
        const outerR = data.size * 2.8;
        const ringGeo = new THREE.RingGeometry(innerR, outerR, 128);
        const pos = ringGeo.attributes.position;
        const uvAttr = ringGeo.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
            const vx = pos.getX(i), vy = pos.getY(i);
            const r = Math.sqrt(vx * vx + vy * vy);
            uvAttr.setXY(i, (r - innerR) / (outerR - innerR), 0.5);
        }
        uvAttr.needsUpdate = true;
        // Prefer the real 2K ring PNG (alpha channel encodes Cassini division gaps);
        // fall back to procedural gradient if the file isn't found.
        const ringTex = await loadTex('./textures/2k_saturn_ring_alpha.png', textureLoader)
            ?? createSaturnRingTexture();
        const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
            map: ringTex,
            side: THREE.DoubleSide,
            transparent: true,
            alphaTest: 0.01,
            depthWrite: false
        }));
        ring.rotation.x = Math.PI / 2;
        planet.add(ring);
    }

    // Atmosphere — physically-based Rayleigh + Mie scattering.
    // The shell is slightly larger than the planet so it appears as an outer glow
    // visible from space. Unlike the old Fresnel-only approach, the new shader only
    // scatters light on the illuminated hemisphere, giving a correct day/night split
    // and a warm twilight band at the terminator.
    if (ATMOSPHERE_COLORS[data.name] !== undefined) {
        const cfg = ATMOSPHERE_CONFIG[data.name] ?? { power: 3.0, opacity: 0.8, scale: 1.12, mieStrength: 0.4, mieColor: 0xFFEECC };
        planet.add(new THREE.Mesh(
            new THREE.SphereGeometry(data.size * cfg.scale, 32, 32),
            createScatteringAtmosphereMaterial(
                ATMOSPHERE_COLORS[data.name],
                cfg.power,
                cfg.opacity,
                cfg.mieStrength ?? 0.4,
                cfg.mieColor    ?? 0xFFEECC
            )
        ));
    }

    // Earth: cloud layer — real NASA cloud texture when available, procedural fallback.
    // The cloud sphere is slightly larger than Earth so it sits visually above the surface.
    // alphaMap driven by the cloud texture's luminance: bright = cloud, dark = clear sky.
    let cloudMesh = null;
    if (data.name === 'Earth') {
        const cloudMat = _earthCloudTex
            ? new THREE.MeshStandardMaterial({
                map:       _earthCloudTex,
                alphaMap:  _earthCloudTex, // luminance → alpha; sky areas become transparent
                transparent: true,
                depthWrite:  false,
                roughness:   1.0,
                metalness:   0.0,
                opacity:     0.88,
            })
            : createEarthCloudMaterial();
        cloudMesh = new THREE.Mesh(
            new THREE.SphereGeometry(data.size * 1.015, 64, 64),
            cloudMat
        );
        cloudMesh.renderOrder = 1;
        planet.add(cloudMesh);
    }

    // Jupiter: 3-layer animated overlay (differential rotation + GRS vortex)
    let jupiterOverlay = null;
    if (data.name === 'Jupiter') {
        const overlayMat = createJupiterOverlayMaterial();
        const overlayMesh = new THREE.Mesh(
            new THREE.SphereGeometry(data.size * 1.002, 64, 64),
            overlayMat
        );
        overlayMesh.renderOrder = 1;
        planet.add(overlayMesh);
        jupiterOverlay = overlayMat;
    }

    // Moon-orbit group — tilted to planet's equatorial plane so moons orbit realistically
    // (Uranus's moons orbit nearly perpendicular to the ecliptic, matching its 97.8° tilt)
    const moonGroup = new THREE.Group();
    moonGroup.rotation.z = THREE.MathUtils.degToRad(data.axialTilt || 0);
    planetGroup.add(moonGroup);

    scene.add(planetGroup);

    return { group: planetGroup, mesh: planet, moonGroup, orbitLine, data: { ...data, angle: startAngle }, cloudMesh, jupiterOverlay };
}

export async function createMoon(moonDef, parentPlanet, scene, textureLoader) {
    // Pivot group — rotating this around Y orbits the moon around the planet
    const pivot = new THREE.Group();
    pivot.rotation.y = Math.random() * Math.PI * 2; // random starting angle
    parentPlanet.moonGroup.add(pivot);

    // Earth's Moon: load real NASA/Three.js lunar texture + bump map for crater detail.
    // All other moons (Galilean, Saturnian, etc.) use improved procedural coloring.
    let moonMat;
    if (moonDef.name === 'Moon' && textureLoader) {
        const [moonTex, moonBump] = await Promise.all([
            loadTex('./textures/moon_2k.jpg',  textureLoader),
            loadTex('./textures/moon_bump.jpg', textureLoader, true),
        ]);
        moonMat = new THREE.MeshStandardMaterial({
            map:       moonTex ?? createMoonTexture(moonDef.color),
            bumpMap:   moonBump ?? undefined,
            bumpScale: 0.06,
            roughness: 0.95,
            metalness: 0.0,
        });
    } else {
        moonMat = new THREE.MeshStandardMaterial({
            map:      createMoonTexture(moonDef.color),
            roughness: 0.90,
            metalness: 0.0,
        });
    }

    // Higher segment count for Earth's Moon so the bump map shows crater detail
    const segments = moonDef.name === 'Moon' ? 32 : 16;
    const moonMesh = new THREE.Mesh(
        new THREE.SphereGeometry(moonDef.size, segments, segments),
        moonMat
    );
    moonMesh.castShadow    = true;
    moonMesh.receiveShadow = false; // cube shadow map creates black-square artifacts at close range
    moonMesh.position.set(moonDef.orbitRadius, 0, 0);
    pivot.add(moonMesh);

    // Faint orbit ring
    const pts = new THREE.EllipseCurve(0, 0, moonDef.orbitRadius, moonDef.orbitRadius, 0, Math.PI*2).getPoints(64);
    const orbitLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x334455, transparent: true, opacity: 0.22 })
    );
    orbitLine.rotation.x = Math.PI / 2;
    parentPlanet.moonGroup.add(orbitLine);

    return { pivot, moonDef, orbitLine };
}
