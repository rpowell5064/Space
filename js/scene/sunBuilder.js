import * as THREE from 'https://esm.sh/three@0.160.0';
import { CSS2DObject } from 'https://esm.sh/three@0.160.0/examples/jsm/renderers/CSS2DRenderer.js';
import { createSunMaterial } from '../shaders/sunShader.js';
import { makeTexture } from '../textures/planetTextures.js';

export const SUN_RADIUS = 25;

// Single filament tube: deep red at feet → orange → yellow-white at crown
function makeFilamentTube(p0, ctrl, p2, tubeRadius) {
    const curve = new THREE.QuadraticBezierCurve3(p0, ctrl, p2);
    const TSEG  = 32, RSEG = 5;
    const tube  = new THREE.TubeGeometry(curve, TSEG, tubeRadius, RSEG, false);
    const pAttr = tube.attributes.position;
    const colors = new Float32Array(pAttr.count * 3);

    for (let v = 0; v < pAttr.count; v++) {
        const t    = Math.floor(v / (RSEG + 1)) / TSEG;
        const apex = Math.sin(t * Math.PI);
        colors[v * 3]     = 1.00;
        colors[v * 3 + 1] = 0.10 + apex * 0.68;
        colors[v * 3 + 2] = apex * apex * 0.28;
    }
    tube.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    return new THREE.Mesh(tube, new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
}

// Prominence loop: 3 thin filament tubes anchored to the sun surface
function createProminence(isEruption) {
    const phi   = Math.random() * Math.PI;
    const theta = Math.random() * Math.PI * 2;
    const r     = SUN_RADIUS;

    // Foot spread — keeps prominences a reasonable fraction of R apart
    const spread = 0.18 + Math.random() * 0.26;
    const dir0 = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta)
    ).normalize();
    const dir2 = new THREE.Vector3(
        Math.sin(phi + spread) * Math.cos(theta + spread * 0.6),
        Math.cos(phi + spread),
        Math.sin(phi + spread) * Math.sin(theta + spread * 0.6)
    ).normalize();
    const p0 = dir0.clone().multiplyScalar(r * 1.004);
    const p2 = dir2.clone().multiplyScalar(r * 1.004);

    const midDir    = dir0.clone().add(dir2).normalize();
    // Heights: normal = 5–14% of R above surface (1.2–3.5 units)
    //          eruption = 14–26% of R (3.5–6.5 units)
    const apexScale = isEruption
        ? r * (0.14 + Math.random() * 0.12)
        : r * (0.05 + Math.random() * 0.09);
    const ctrl = midDir.clone().multiplyScalar(r + apexScale);

    const group = new THREE.Group();

    for (let f = 0; f < 3; f++) {
        const jitter = new THREE.Vector3(
            (Math.random() - 0.5) * apexScale * 0.18,
            (Math.random() - 0.5) * apexScale * 0.18,
            (Math.random() - 0.5) * apexScale * 0.18
        );
        const ctrlV = ctrl.clone().add(jitter);
        // Tube radius: thin strands, 1.2–2.0% of sun radius
        const tubeR = r * (0.012 + Math.random() * 0.008);
        const mesh  = makeFilamentTube(p0, ctrlV, p2, tubeR);
        mesh.userData.baseOpacity = isEruption
            ? 0.50 + Math.random() * 0.28
            : 0.32 + Math.random() * 0.20;
        mesh.material.opacity = mesh.userData.baseOpacity;
        group.add(mesh);
    }

    group.userData.driftSpeed = (0.004 + Math.random() * 0.008) * (Math.random() < 0.5 ? 1 : -1);
    group.userData.phase      = Math.random() * Math.PI * 2;
    group.userData.period     = 5 + Math.random() * 9;   // 5–14 s per pulse — visibly animated
    group.userData.isEruption = !!isEruption;

    return group;
}

// Radial ray burst sprite — two counter-rotating layers for flickering corona
function createRaySprite(numRays, baseOpacity, spriteScale) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');

    for (let i = 0; i < numRays; i++) {
        const angle = (i / numRays) * Math.PI * 2 + (Math.random() - 0.5) * 0.45;
        const len   = 185 + Math.random() * 65;
        const w     = 1.4 + Math.random() * 3.0;

        ctx.save();
        ctx.translate(256, 256);
        ctx.rotate(angle);

        const grad = ctx.createLinearGradient(0, 0, len, 0);
        grad.addColorStop(0.00, `rgba(255,200, 80,${baseOpacity.toFixed(3)})`);
        grad.addColorStop(0.15, `rgba(255,100, 15,${(baseOpacity * 0.60).toFixed(3)})`);
        grad.addColorStop(0.50, `rgba(210, 40,  0,${(baseOpacity * 0.20).toFixed(3)})`);
        grad.addColorStop(1.00,  'rgba(150,  0,  0, 0)');

        ctx.fillStyle = grad;
        ctx.fillRect(0, -w * 0.5, len, w);
        ctx.restore();
    }

    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map:         makeTexture(canvas),
        blending:    THREE.AdditiveBlending,
        transparent: true,
        depthWrite:  false,
    }));
    sprite.scale.set(spriteScale, spriteScale, 1);
    return sprite;
}

// Draw a soft radial glow on a canvas and return a Sprite
function makeGlowSprite(sz, stops) {
    const c  = document.createElement('canvas');
    c.width  = 256; c.height = 256;
    const gc = c.getContext('2d');
    const g  = gc.createRadialGradient(128, 128, 0, 128, 128, 128);
    stops.forEach(([t, col]) => g.addColorStop(t, col));
    gc.fillStyle = g;
    gc.fillRect(0, 0, 256, 256);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeTexture(c), blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false,
    }));
    spr.scale.set(sz, sz, 1);
    return spr;
}

export async function createSun(scene) {
    const sunMat = createSunMaterial();
    const sun    = new THREE.Mesh(new THREE.SphereGeometry(SUN_RADIUS, 64, 64), sunMat);
    sun._sunMat  = sunMat;
    scene.add(sun);

    // Label
    const labelDiv = document.createElement('div');
    labelDiv.className   = 'planet-label';
    labelDiv.textContent = 'Sun';
    const sunLabel = new CSS2DObject(labelDiv);
    sunLabel.position.set(0, SUN_RADIUS * 1.35, 0);
    sun.add(sunLabel);

    // Transition region (chromosphere shell)
    scene.add(new THREE.Mesh(
        new THREE.SphereGeometry(SUN_RADIUS * 1.15, 32, 32),
        new THREE.MeshBasicMaterial({
            color: 0xFF5511, transparent: true, opacity: 0.08,
            blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
        })
    ));

    // Corona — shells all use the same warm-white colour so there is no visible
    // colour-banding ring at each shell boundary; only opacity changes with radius.
    [
        { r: 1.40, opacity: 0.090 },
        { r: 1.90, opacity: 0.048 },
        { r: 2.80, opacity: 0.024 },
        { r: 4.50, opacity: 0.012 },
        { r: 7.00, opacity: 0.006 },
        { r: 12.0, opacity: 0.003 },
    ].forEach(({ r, opacity }) =>
        scene.add(new THREE.Mesh(
            new THREE.SphereGeometry(SUN_RADIUS * r, 48, 48),
            new THREE.MeshBasicMaterial({
                color: 0xFFEECC, transparent: true, opacity,
                side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
            })
        ))
    );

    // Prominences — plasma arcs (8 normal, 2 eruptive — subtle, not dominant)
    sun.prominences = [];
    for (let i = 0; i < 8; i++) {
        const p = createProminence(false);
        sun.prominences.push(p);
        scene.add(p);
    }
    for (let i = 0; i < 2; i++) {
        const p = createProminence(true);
        sun.prominences.push(p);
        scene.add(p);
    }

    // Solar ray sprites — two counter-rotating layers
    sun._ray1 = createRaySprite(22, 0.44, SUN_RADIUS * 3.8);
    sun._ray2 = createRaySprite(16, 0.30, SUN_RADIUS * 5.2);
    scene.add(sun._ray1);
    scene.add(sun._ray2);

    // Glow sprites — inner blaze, mid halo, wide diffuse halo
    const glows = [
        {
            sz: SUN_RADIUS * 7,
            stops: [
                [0.00, 'rgba(255,190, 70,0.88)'],
                [0.10, 'rgba(255,130, 25,0.72)'],
                [0.28, 'rgba(235, 65,  5,0.38)'],
                [0.55, 'rgba(185, 22,  0,0.14)'],
                [1.00, 'rgba(140,  0,  0,0.00)'],
            ],
        },
        {
            sz: SUN_RADIUS * 14,
            stops: [
                [0.00, 'rgba(255,150, 40,0.52)'],
                [0.14, 'rgba(245, 85, 10,0.32)'],
                [0.38, 'rgba(205, 32,  0,0.13)'],
                [0.68, 'rgba(160, 10,  0,0.04)'],
                [1.00, 'rgba(125,  0,  0,0.00)'],
            ],
        },
        {
            sz: SUN_RADIUS * 22,
            stops: [
                [0.00, 'rgba(230, 90, 12,0.18)'],
                [0.22, 'rgba(200, 45,  0,0.08)'],
                [0.55, 'rgba(165, 18,  0,0.03)'],
                [1.00, 'rgba(120,  0,  0,0.00)'],
            ],
        },
        {
            sz: SUN_RADIUS * 36,
            stops: [
                [0.00, 'rgba(200, 60,  8,0.08)'],
                [0.30, 'rgba(170, 30,  0,0.03)'],
                [0.65, 'rgba(140, 10,  0,0.01)'],
                [1.00, 'rgba(110,  0,  0,0.00)'],
            ],
        },
    ];
    glows.forEach(({ sz, stops }) => scene.add(makeGlowSprite(sz, stops)));

    // Secondary point light — same colour as primary so no colour-banding ring at range boundary
    const sunLight = new THREE.PointLight(0xFFEECC, 1.4, 5500);
    sunLight.position.set(0, 0, 0);
    sunLight.castShadow = false;
    scene.add(sunLight);

    // Per-frame hook
    sun._elapsed = 0;
    sun.update = function(delta) {
        sun._elapsed += delta;
        const yAxis = new THREE.Vector3(0, 1, 0);
        sun.prominences.forEach(p => {
            // Drift around the Y-axis — visible at normal playback speed
            p.rotateOnAxis(yAxis, p.userData.driftSpeed * delta);

            // Pulsing brightness — abs(sin) gives a rise/hold/fall cycle
            // Range 0.08→1.0 so prominences visibly swell and dim
            const t     = p.userData.phase + (sun._elapsed / p.userData.period) * Math.PI;
            const pulse = 0.08 + 0.92 * Math.pow(Math.abs(Math.sin(t)), 0.6);
            p.children.forEach(child => {
                if (child.material && child.userData.baseOpacity !== undefined) {
                    child.material.opacity = child.userData.baseOpacity * pulse;
                }
            });
        });
        sun._ray1.material.rotation += 0.0055 * delta;
        sun._ray2.material.rotation -= 0.0038 * delta;
    };

    return sun;
}
