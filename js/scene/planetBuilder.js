import * as THREE from 'https://esm.sh/three@0.160.0';
import { CSS2DObject } from 'https://esm.sh/three@0.160.0/examples/jsm/renderers/CSS2DRenderer.js';
import { loadPlanetTexture, createSaturnRingTexture, createMoonTexture } from '../textures/planetTextures.js';
import { createAtmosphereMaterial, createJupiterOverlayMaterial, createEarthCloudMaterial } from '../shaders/sunShader.js';
import { ATMOSPHERE_COLORS, ATMOSPHERE_CONFIG } from '../data/solarSystemData.js';

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

    // Planet mesh — MeshStandardMaterial for realistic sun lighting and shadows
    const texture = await loadPlanetTexture(data.name, textureLoader);
    const geo = new THREE.SphereGeometry(data.size, 64, 64);
    const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85, metalness: 0.0 });
    const planet = new THREE.Mesh(geo, mat);
    planet.castShadow    = true;
    planet.receiveShadow = true;
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
        const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
            map: createSaturnRingTexture(),
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: false
        }));
        ring.rotation.x = Math.PI / 2;
        planet.add(ring);
    }

    // Atmosphere glow — each planet uses tuned Fresnel power/opacity
    if (ATMOSPHERE_COLORS[data.name] !== undefined) {
        const cfg = ATMOSPHERE_CONFIG[data.name] || { power: 3.0, opacity: 0.8, scale: 1.12 };
        planet.add(new THREE.Mesh(
            new THREE.SphereGeometry(data.size * cfg.scale, 32, 32),
            createAtmosphereMaterial(ATMOSPHERE_COLORS[data.name], cfg.power, cfg.opacity)
        ));
    }

    // Earth: animated cloud layer — domain-warped FBM shader, sun-lit per fragment
    let cloudMesh = null;
    if (data.name === 'Earth') {
        cloudMesh = new THREE.Mesh(
            new THREE.SphereGeometry(data.size * 1.015, 64, 64),
            createEarthCloudMaterial()
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

export function createMoon(moonDef, parentPlanet, scene) {
    // Pivot group — rotating this around Y orbits the moon around the planet
    const pivot = new THREE.Group();
    pivot.rotation.y = Math.random() * Math.PI * 2; // random starting angle
    parentPlanet.moonGroup.add(pivot);

    // Moon mesh — MeshStandardMaterial so it receives sun lighting and shadows
    const moonMesh = new THREE.Mesh(
        new THREE.SphereGeometry(moonDef.size, 16, 16),
        new THREE.MeshStandardMaterial({ map: createMoonTexture(moonDef.color), roughness: 0.90, metalness: 0.0 })
    );
    moonMesh.castShadow    = true;
    moonMesh.receiveShadow = true;
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
