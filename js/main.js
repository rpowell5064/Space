// main.js — thin composition root
import * as THREE from 'https://esm.sh/three@0.160.0';
import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'https://esm.sh/three@0.160.0/examples/jsm/renderers/CSS2DRenderer.js';

import { PLANET_DATA, SUN_DATA, MOON_DATA } from './data/solarSystemData.js';
import { setupLighting, createStars, createGalaxyBackground } from './scene/environmentBuilder.js';
import { createSun, SUN_RADIUS } from './scene/sunBuilder.js';
import { createPlanet, createMoon } from './scene/planetBuilder.js';
import { createAsteroidBelt, updateAsteroids } from './scene/asteroidBelt.js';
import { FocusController } from './camera/focusController.js';
import { initControls } from './ui/controlsPanel.js';
import { showFocusPanel, hideFocusPanel } from './ui/infoPanel.js';
import { ShipController } from './spaceship.js';
import { ArtemisMission } from './missions/artemisII.js';
import { createPostProcessing } from './effects/postProcessing.js';
import { initMobileControls }  from './ui/mobileControls.js';

// ── Scene ─────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000005);

// ── Camera ────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 15000);
camera.position.set(0, 400, 900);
camera.lookAt(0, 0, 0);

// ── Renderer ──────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.6;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.useLegacyLights = true; // scene tuned for legacy (non-physical) attenuation
document.body.appendChild(renderer.domElement);

// ── CSS2DRenderer ─────────────────────────────────────────────────────────
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'fixed';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.left = '0';
labelRenderer.domElement.style.zIndex = '10';
labelRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(labelRenderer.domElement);

// ── OrbitControls ─────────────────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 8;
controls.maxDistance = 7000;

// ── State ─────────────────────────────────────────────────────────────────
const textureLoader = new THREE.TextureLoader();
const clock = new THREE.Clock();
let _prevElapsed = 0;
let rotationSpeed = 0.2;

let planets = [];
let _shipWasActive = false;
let moons = [];
let sun = null;
let orbitLines = [];
let focusController = null;
let shipController = null;
let artemisMission = null;
let heatDistortion = null;
let mobileControls = null;
let bodyMap = new Map(); // name → { getPosition, radius, name }

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
    setupLighting(scene);
    createGalaxyBackground(scene);
    createStars(scene);

    sun = await createSun(scene);

    const planetResults = await Promise.all(
        PLANET_DATA.map(data => createPlanet(data, scene, textureLoader))
    );
    planets = planetResults;
    orbitLines.push(...planetResults.map(p => p.orbitLine));

    const moonResults = await Promise.all(
        MOON_DATA.map(moonDef => {
            const parent = planets.find(p => p.data.name === moonDef.planet);
            if (!parent) return Promise.resolve(null);
            return createMoon(moonDef, parent, scene, textureLoader);
        })
    );
    moonResults.forEach(moonResult => {
        if (!moonResult) return;
        moons.push({ pivot: moonResult.pivot, moonDef: moonResult.moonDef });
        orbitLines.push(moonResult.orbitLine);
    });

    await createAsteroidBelt(scene);

    // ── Controllers ───────────────────────────────────────────────────────
    focusController = new FocusController(camera, controls);
    shipController = new ShipController(scene, camera, controls, renderer.domElement);

    // ── Bodies map for ship orbit/warp ────────────────────────────────────
    const sunBody = { name: 'Sun', radius: SUN_RADIUS, noOrbit: true, getPosition: () => new THREE.Vector3(0, 0, 0) };
    bodyMap.set('Sun', sunBody);
    planets.forEach(p => {
        const body = {
            name: p.data.name,
            radius: p.data.size,
            getPosition: () => { const v = new THREE.Vector3(); p.group.getWorldPosition(v); return v; }
        };
        bodyMap.set(p.data.name, body);
    });
    // Moon body — needed for Artemis mission and ship orbit detection
    const earthMoonEntry = moons.find(m => m.moonDef.name === 'Moon');
    if (earthMoonEntry) {
        const moonMesh = earthMoonEntry.pivot.children[0];
        const moonBody = {
            name: 'Moon',
            radius: earthMoonEntry.moonDef.size,
            getPosition: () => { const v = new THREE.Vector3(); moonMesh.getWorldPosition(v); return v; }
        };
        bodyMap.set('Moon', moonBody);
    }

    shipController.setBodies([sunBody, ...planets.map(p => bodyMap.get(p.data.name))]);
    shipController.setPlanets(planets);

    // Show planet info panel when ship enters orbit; hide when it leaves
    shipController.onOrbitEnter = (bodyName) => {
        const found = planets.find(p => p.data.name === bodyName);
        if (found) showFocusPanel(found.data);
    };
    shipController.onOrbitExit = () => hideFocusPanel();

    // ── UI ────────────────────────────────────────────────────────────────
    initControls({
        onPlanetSelect: onPlanetSelect,
        onSpeedChange: onSpeedChange,
        onFly: (flyBtn) => {
            if (!shipController) return;
            shipController.active ? shipController.exit() : shipController.enter();
            flyBtn.classList.toggle('active', shipController.active);
            if (mobileControls) {
                shipController.active ? mobileControls.show() : mobileControls.hide();
            }
        },
        onClosePanel: () => {
            focusController.clear();
            const planetSelect = document.getElementById('planetSelect');
            if (planetSelect) planetSelect.value = '';
        },
        labelRenderer,
        orbitLines
    });

    // ── Artemis II special event ──────────────────────────────────────────
    artemisMission = new ArtemisMission(scene, camera, controls, shipController, renderer);
    artemisMission.onStop = () => {
        const btn = document.getElementById('artemisBtn');
        if (btn) { btn.classList.remove('active'); btn.textContent = '⬤ ARTEMIS II MISSION'; }
        const flyBtn = document.getElementById('flyBtn');
        if (flyBtn) flyBtn.classList.remove('active');
        // Restore the hamburger so the menu is accessible again after mission ends
        document.getElementById('menuToggle')?.style.removeProperty('display');
    };

    const artemisBtn = document.getElementById('artemisBtn');
    if (artemisBtn) {
        artemisBtn.addEventListener('click', () => {
            if (artemisMission.active) {
                artemisMission.stop();
            } else {
                const earthBody = bodyMap.get('Earth');
                const moonBody  = bodyMap.get('Moon');
                if (!earthBody || !moonBody) return;

                // Exit any active fly mode first (mission will re-enter it)
                if (shipController.active) shipController.exit();

                // Clear any active focus (mission owns the camera)
                focusController.clear();

                artemisMission.start(earthBody, moonBody);
                artemisBtn.classList.add('active');
                artemisBtn.textContent = '■ ABORT MISSION';

                const flyBtn = document.getElementById('flyBtn');
                if (flyBtn) flyBtn.classList.add('active');

                // Close the mobile menu and hide the hamburger for the mission duration.
                // The HUD has pointer-events:none so an open menu would intercept taps
                // meant for the abort button — hiding the toggle prevents re-opening it.
                document.getElementById('uiContainer')?.classList.remove('open');
                document.getElementById('menuToggle')?.classList.remove('open');
                document.getElementById('menuToggle')?.style.setProperty('display', 'none');
            }
        });
    }

    // ── Cinematic post-processing (bloom + heat + vignette + chroma) ─────
    heatDistortion = createPostProcessing(renderer, scene, camera);

    // ── Mobile controls (no-op on desktop) ────────────────────────────────
    mobileControls = initMobileControls(shipController);

    // ── Events ────────────────────────────────────────────────────────────
    window.addEventListener('resize', onWindowResize);
    // orientationchange fires before the browser has settled on new dimensions.
    // Two staggered timeouts: 350ms for most devices, 750ms fallback for slow iOS.
    window.addEventListener('orientationchange', () => {
        setTimeout(onWindowResize, 350);
        setTimeout(onWindowResize, 750);
    });
    // visualViewport fires after the browser has committed to the new size —
    // more reliable than resize/orientationchange on mobile.
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', onWindowResize);
    }
    renderer.domElement.addEventListener('click', onMouseClick);

    // Touch tap-to-focus: OrbitControls swallows touch events so 'click'
    // never fires on mobile. Track tap manually and call onMouseClick.
    let _touchStartX = 0, _touchStartY = 0, _touchStartTime = 0;
    renderer.domElement.addEventListener('touchstart', e => {
        _touchStartX = e.touches[0].clientX;
        _touchStartY = e.touches[0].clientY;
        _touchStartTime = Date.now();
    }, { passive: true });
    renderer.domElement.addEventListener('touchend', e => {
        if (Date.now() - _touchStartTime > 500) return; // too slow — was a drag
        const t  = e.changedTouches[0];
        const dx = t.clientX - _touchStartX;
        const dy = t.clientY - _touchStartY;
        if (Math.hypot(dx, dy) > 22) return; // moved too far — was a pan
        // In orbit mode: tap canvas to break orbit instead of using the button
        if (shipController?.active && shipController?._orbitMode) {
            shipController._breakOrbit();
            return;
        }
        onMouseClick({ clientX: t.clientX, clientY: t.clientY, _fromTouch: true });
    }, { passive: true });

    animate();
}

// ── Planet select handler ─────────────────────────────────────────────────
function onPlanetSelect(event) {
    const value = event.target.value;
    if (value === '') {
        focusController.clear();
        shipController?.setWarpTarget(null);
        event.target.value = '';
    } else if (value === 'sun') {
        focusController.focusOn(sun, SUN_DATA);
        shipController?.setWarpTarget(bodyMap.get('Sun'));
    } else {
        const found = planets.find(p => p.data.name.toLowerCase() === value);
        if (found) {
            focusController.focusOn(found.group, found.data);
            shipController?.setWarpTarget(bodyMap.get(found.data.name));
        }
    }
}

// ── Speed change handler ──────────────────────────────────────────────────
function onSpeedChange(event) {
    rotationSpeed = parseFloat(event.target.value);
    const el = document.getElementById('speedValue');
    if (el) el.textContent = rotationSpeed.toFixed(1) + 'x';
}

// ── Resize handler ────────────────────────────────────────────────────────
function onWindowResize() {
    // visualViewport updates before window.innerWidth/Height on iOS Safari,
    // so it gives the correct landscape dimensions immediately after rotation.
    const w = window.visualViewport?.width  ?? window.innerWidth;
    const h = window.visualViewport?.height ?? window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    if (heatDistortion) heatDistortion.setSize(w, h);
    if (mobileControls && !shipController?.active) mobileControls.hide();
}

// ── Click/tap-to-focus ────────────────────────────────────────────────────
function onMouseClick(event) {
    if (shipController?.active) return;
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    let found = null;

    // Exact mesh intersection (works well on desktop)
    const intersects = raycaster.intersectObjects(planets.map(p => p.mesh));
    if (intersects.length > 0) {
        found = planets.find(p => p.mesh === intersects[0].object) ?? null;
    }

    // Touch fallback: project every planet to screen space, pick the closest
    // one within 48px of the tap — handles small/distant planets reliably
    if (!found && event._fromTouch) {
        const _tmp = new THREE.Vector3();
        let closestDist = 48;
        planets.forEach(p => {
            p.group.getWorldPosition(_tmp);
            _tmp.project(camera);
            const sx = ( _tmp.x * 0.5 + 0.5) * window.innerWidth;
            const sy = (-_tmp.y * 0.5 + 0.5) * window.innerHeight;
            const d  = Math.hypot(sx - event.clientX, sy - event.clientY);
            if (d < closestDist) { closestDist = d; found = p; }
        });
    }

    if (found) {
        focusController.focusOn(found.group, found.data);
        shipController?.setWarpTarget(bodyMap.get(found.data.name));
        const planetSelect = document.getElementById('planetSelect');
        if (planetSelect) planetSelect.value = found.data.name.toLowerCase();
    }
}

// ── Animate loop ──────────────────────────────────────────────────────────
function animate() {
    requestAnimationFrame(animate);
    controls.update();

    const elapsed = clock.getElapsedTime();
    const delta   = elapsed - _prevElapsed;
    _prevElapsed  = elapsed;

    // Hide planet labels in flight mode — restored when exiting (handles all exit paths)
    const shipActive = !!shipController?.active;
    if (shipActive !== _shipWasActive) {
        _shipWasActive = shipActive;
        labelRenderer.domElement.style.display = shipActive ? 'none' : '';
    }

    // Star twinkle — tick each layer's time uniform
    if (scene.userData.starLayers) {
        scene.userData.starLayers.forEach(mat => { mat.uniforms.time.value = elapsed; });
    }

    // Sun shader uniforms — time for animation, pulse for brightness variation
    if (sun && sun._sunMat) {
        sun._sunMat.uniforms.time.value  = elapsed;
        sun._sunMat.uniforms.pulse.value = 1.0 + Math.sin(elapsed * 1.5) * 0.12;
    }
    // Sun always spins at fixed rate
    if (sun) sun.rotation.y += 0.0002;

    // Planet orbits (speed-controlled) and realistic axial spin.
    // Freeze all orbits during Artemis mission — the flight path was computed
    // from a position snapshot, so moving planets would drift away from the path.
    if (!artemisMission?.active) {
        const orbitedName = shipController.orbitedBody?.name ?? null;
        planets.forEach(({ group, mesh, data, cloudMesh, jupiterOverlay }) => {
            if (data.name !== orbitedName) data.angle += data.speed * rotationSpeed;
            const e  = data.eccentricity || 0;
            const a  = data.distance;
            const b  = a * Math.sqrt(1 - e * e);
            const fc = a * e;
            group.position.x = fc + a * Math.cos(data.angle);
            group.position.z = b  * Math.sin(data.angle);
            if (!focusController.isFocused) {
                mesh.rotation.y += 0.0003 * (data.selfRotation || 1.0);
                // Cloud layer drifts slightly faster than Earth surface
                if (cloudMesh) cloudMesh.rotation.y += 0.0003 * (data.selfRotation || 1.0) * 0.14;
            }
            // Cloud shader time (only for procedural shader fallback — real texture has no uniforms)
            if (cloudMesh?.material?.uniforms?.time !== undefined) cloudMesh.material.uniforms.time.value = elapsed;
            // Jupiter overlay: update time for animated bands + GRS
            if (jupiterOverlay) jupiterOverlay.uniforms.time.value = elapsed;
        });

        // Moon orbits — independent of the orbit-speed slider
        moons.forEach(({ pivot, moonDef }) => {
            pivot.rotation.y += moonDef.speed * rotationSpeed;
        });
    }

    // Sun prominences update
    if (sun && sun.update) {
        sun.update(delta);
    }

    updateAsteroids(camera.position);

    mobileControls?.tick(delta);
    focusController.update();
    artemisMission?.update(delta);
    shipController?.update(delta);

    if (heatDistortion) {
        heatDistortion.updateExposure(renderer, camera.position.length(), delta);
        heatDistortion.render(elapsed);
    } else {
        renderer.render(scene, camera);
    }
    labelRenderer.render(scene, camera);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
