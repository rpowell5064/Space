// Artemis II mission autopilot — scripted crewed lunar flyby
// ─────────────────────────────────────────────────────────────────────────────
//  Path geometry is provided by FigureEightFreeReturnCurve (figureEightCurve.js)
//
//  t-landmarks (read from curve.tHeoEnd / tOutboundEnd / tPeriapsis):
//    tHeoEnd      ≈ 0.128  (end of HEO, TLI departure)
//    tOutboundEnd ≈ 0.362  (end of outbound transit, start of flyby)
//    tPeriapsis   ≈ 0.500  (lunar periapsis — closest-approach point)
//
//  Cinematic camera:
//    DEPARTURE      t = 0        → tHeoEnd    pull-back from LEO
//    TRANSIT        t = tHeoEnd  → tOutbound  wide follow, sine drift
//    APPROACH       t = tOutbound → tPeri-0.02 swing to lateral reveal
//    FLYBY          t = tPeri±0.05             orbit-reveal wide shot
//    GRAVITY ASSIST t = tPeri+0.05 → 0.72      motion blur, pull-out
//    RETURN         t = 0.72     → 1.0         full figure-eight framing
//
//  Effects (CinematicEffects):
//    – Lens flare   DOM overlay, screen-space positioned on Earth/Sun
//    – Rim glow     THREE.Sprite, additive, behind Moon from Earth's POV
//    – White flash  DOM overlay, fires once at periapsis crossing
//    – Vignette     DOM overlay, intensity driven by phase
//    – Exposure     renderer.toneMappingExposure smooth lerp
//    – Motion blur  canvas CSS filter, peaks in gravity-assist phase
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'https://esm.sh/three@0.160.0';
import { FigureEightFreeReturnCurve, validateMoonAlignment } from './figureEightCurve.js';

const MISSION_DURATION = 90; // wall-clock seconds for full mission

const PHASES = [
    { t: 0.00, label: 'PHASE 1  ·  HIGH EARTH ORBIT  ·  DAYS 1–2' },
    { t: 0.08, label: 'PHASE 2  ·  PROXIMITY OPERATIONS  ·  SPENT STAGE DEMO' },
    { t: 0.16, label: 'PHASE 3  ·  TRANSLUNAR INJECTION  ·  DAY 2  ·  6-MIN ENGINE BURN' },
    { t: 0.28, label: 'PHASE 4  ·  OUTBOUND TRANSIT  ·  DEEP SPACE  ·  DAYS 3–5' },
    { t: 0.44, label: 'PHASE 5  ·  LUNAR APPROACH  ·  DAY 6' },
    { t: 0.50, label: 'PHASE 6  ·  FAR-SIDE FLYBY  ·  252,797 MI FROM EARTH  ·  RECORD' },
    { t: 0.60, label: 'PHASE 7  ·  FREE RETURN TRAJECTORY  ·  DAYS 7–10' },
    { t: 0.88, label: 'PHASE 8  ·  EARTH APPROACH  ·  REENTRY  ·  PACIFIC SPLASHDOWN' },
];

// Path colours matching the reference diagram
const COL_OUTBOUND = 0x8B9C3A;  // olive green  (HEO + outbound)
const COL_FLYBY    = 0x2255CC;  // blue         (flyby arc)
const COL_RETURN   = 0xCC2288;  // magenta/pink (return)

// ── CinematicEffects ──────────────────────────────────────────────────────────
/**
 * Manages all visual effects for the Artemis II mission:
 *   – Lens flare (DOM overlay, screen-space positioned)
 *   – Rim glow   (THREE.Sprite with additive blending, behind Moon)
 *   – Flash      (single white DOM burst at periapsis)
 *   – Vignette   (DOM radial-gradient overlay)
 *   – Exposure   (smooth renderer.toneMappingExposure changes)
 *   – Motion blur (CSS filter on renderer canvas)
 *
 * Construct once in ArtemisMission.start(), call update(dt) every frame,
 * call dispose() in ArtemisMission.stop().
 */
class CinematicEffects {
    /**
     * @param {THREE.Scene}          scene
     * @param {THREE.WebGLRenderer|null} renderer  Pass the renderer to enable
     *                                              exposure + motion-blur effects.
     */
    constructor(scene, renderer) {
        this._scene    = scene;
        this._renderer = renderer;
        this._baseExp  = renderer?.toneMappingExposure ?? 1;
        this._targetExp = this._baseExp;
        this._curExp    = this._baseExp;

        // ── Rim-glow sprite ───────────────────────────────────────────────
        // Additive soft disc positioned behind the Moon (anti-Earth side).
        const cv  = document.createElement('canvas');
        cv.width  = cv.height = 128;
        const ctx = cv.getContext('2d');
        const grd = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
        grd.addColorStop(0,   'rgba(160,200,255,1)');
        grd.addColorStop(0.25,'rgba(100,155,255,0.6)');
        grd.addColorStop(0.6, 'rgba(50,90,255,0.15)');
        grd.addColorStop(1,   'rgba(0,20,180,0)');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, 128, 128);
        const rimTex = new THREE.CanvasTexture(cv);
        const rimMat = new THREE.SpriteMaterial({
            map: rimTex, blending: THREE.AdditiveBlending,
            transparent: true, depthWrite: false, opacity: 0,
        });
        this._rimSprite = new THREE.Sprite(rimMat);
        this._rimSprite.scale.set(28, 28, 1);
        scene.add(this._rimSprite);

        // ── DOM overlays ──────────────────────────────────────────────────
        this._flareEl = this._makeEl('z-index:52;transition:opacity 0.35s;opacity:0;');
        this._flashEl = this._makeEl('z-index:53;background:white;opacity:0;');
        this._vigEl   = this._makeEl([
            'z-index:50;',
            'background:radial-gradient(ellipse at center,transparent 30%,rgba(0,0,0,0.78) 100%);',
            'opacity:0;',
        ].join(''));
    }

    _makeEl(extra) {
        const el = document.createElement('div');
        el.style.cssText = `position:fixed;inset:0;pointer-events:none;${extra}`;
        document.body.appendChild(el);
        return el;
    }

    // ── Lens flare (DOM overlay) ──────────────────────────────────────────
    // cx, cy: screen-space fractions [0,1].  Caller computes these by
    // projecting the Earth/Sun position with camera.project().
    setLensFlare(intensity, cx = 0.5, cy = 0.5) {
        const i = Math.max(0, Math.min(1, intensity));
        this._flareEl.style.opacity = i.toFixed(3);
        const x = (cx * 100).toFixed(1);
        const y = (cy * 100).toFixed(1);
        this._flareEl.style.background = [
            `radial-gradient(ellipse at ${x}% ${y}%,`,
            `rgba(255,235,190,${(i * 0.55).toFixed(2)}) 0%,`,
            `rgba(255,170,70,${(i * 0.28).toFixed(2)}) 18%,`,
            `rgba(255,100,30,${(i * 0.10).toFixed(2)}) 35%,`,
            'transparent 60%)',
        ].join('');
    }

    // ── Rim glow (Three.js sprite) ────────────────────────────────────────
    // Positions the glow sprite on the anti-Earth face of the Moon.
    setRimGlow(intensity, moonPos, earthPos) {
        this._rimSprite.material.opacity = Math.max(0, intensity);
        if (moonPos && earthPos && intensity > 0) {
            const toEarth = earthPos.clone().sub(moonPos).normalize();
            // Place sprite 4 units behind the Moon (anti-Earth side)
            this._rimSprite.position.copy(moonPos).addScaledVector(toEarth, -4);
        }
    }

    // ── White flash ───────────────────────────────────────────────────────
    // Fire once at periapsis crossing.  intensity 0→1.
    flashWhite(intensity = 0.6, decaySec = 1.4) {
        this._flashEl.style.transition = 'none';
        this._flashEl.style.opacity    = intensity.toFixed(2);
        requestAnimationFrame(() => {
            this._flashEl.style.transition = `opacity ${decaySec}s ease-out`;
            this._flashEl.style.opacity    = '0';
        });
    }

    // ── Renderer tone-mapping exposure ────────────────────────────────────
    setTargetExposure(v) { this._targetExp = v; }

    // ── Vignette ──────────────────────────────────────────────────────────
    setVignette(intensity) {
        this._vigEl.style.opacity = Math.max(0, Math.min(1, intensity)).toFixed(3);
    }

    // ── Motion blur (CSS filter on renderer canvas) ───────────────────────
    setMotionBlur(intensity) {
        const canvas = this._renderer?.domElement;
        if (!canvas) return;
        canvas.style.filter = intensity > 0.01 ? `blur(${(intensity * 2).toFixed(1)}px)` : '';
    }

    // ── Per-frame update ──────────────────────────────────────────────────
    update(dt) {
        this._curExp += (this._targetExp - this._curExp) * Math.min(dt * 1.8, 1);
        if (this._renderer) this._renderer.toneMappingExposure = this._curExp;
    }

    dispose() {
        this._scene.remove(this._rimSprite);
        this._rimSprite.material.map.dispose();
        this._rimSprite.material.dispose();
        this._flareEl.remove();
        this._flashEl.remove();
        this._vigEl.remove();
        if (this._renderer) {
            this._renderer.toneMappingExposure = this._baseExp;
            this._renderer.domElement.style.filter = '';
        }
    }
}

// ── ArtemisMission ────────────────────────────────────────────────────────────
export class ArtemisMission {
    /**
     * @param {THREE.Scene}             scene
     * @param {THREE.Camera}            camera
     * @param {OrbitControls}           orbitControls
     * @param {ShipController}          shipController
     * @param {THREE.WebGLRenderer|null} renderer  Optional — enables exposure
     *                                              and motion-blur effects.
     *                                              Pass the scene renderer for
     *                                              the full cinematic experience.
     */
    constructor(scene, camera, orbitControls, shipController, renderer = null) {
        this.scene          = scene;
        this.camera         = camera;
        this.orbitControls  = orbitControls;
        this.shipController = shipController;
        this._renderer      = renderer;

        this.active       = false;
        this._t           = 0;
        this._curve       = null;
        this._pathObjects = null;
        this._camLookAt   = new THREE.Vector3();
        this._complete    = false;
        this._earthBody   = null;
        this._moonBody    = null;
        this._effects     = null;
        this._cameraRig   = null;
        this._periFlashed = false;

        this.onStop = null;
        this._buildHUD();
    }

    // ── HUD ──────────────────────────────────────────────────────────────────
    _buildHUD() {
        this._hud = document.createElement('div');
        this._hud.id = 'missionHUD';
        this._hud.innerHTML = `
            <div id="mhTitle">✦ ARTEMIS II ✦</div>
            <div id="mhSub">Crewed Lunar Flyby Mission · April 1–10, 2026</div>
            <div id="mhPhase"></div>
            <div id="mhProgressWrap"><div id="mhProgressBar"></div></div>
            <div id="mhAbort"><span class="abort-kbd">[ESC]</span><span class="abort-touch">[TAP]</span> ABORT MISSION</div>
        `;
        this._hud.style.display = 'none';
        document.body.appendChild(this._hud);

        this._phaseEl    = document.getElementById('mhPhase');
        this._progressEl = document.getElementById('mhProgressBar');

        document.addEventListener('keydown', e => {
            if (e.code === 'Escape' && this.active) { e.preventDefault(); this.stop(); }
        });
        document.getElementById('mhAbort').addEventListener('click', () => {
            if (this.active) this.stop();
        });
    }

    _showHUD() { this._hud.style.display = 'block'; }
    _hideHUD() { this._hud.style.display = 'none'; }

    _updateHUD() {
        let label = PHASES[0].label;
        for (const p of PHASES) { if (this._t >= p.t) label = p.label; }
        if (this._phaseEl)    this._phaseEl.textContent = label;
        if (this._progressEl) this._progressEl.style.width = (this._t * 100).toFixed(1) + '%';
    }

    // ── Path geometry — delegates to FigureEightFreeReturnCurve ─────────────
    _buildPath(E, M) {
        return new FigureEightFreeReturnCurve(E, M);
    }

    // ── Path visuals: tube segments + directional cone arrows ────────────────
    _buildPathVisuals() {
        this._pathObjects = [];
        const SAMPLES = 800;
        const allPts  = this._curve.getPoints(SAMPLES);

        const makeTube = (tStart, tEnd, color) => {
            const i0  = Math.round(tStart * SAMPLES);
            const i1  = Math.min(Math.round(tEnd * SAMPLES) + 2, allPts.length - 1);
            const pts = allPts.slice(i0, i1 + 1);
            if (pts.length < 2) return;
            const sub  = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
            const segs = Math.max(pts.length * 2, 40);
            const geom = new THREE.TubeGeometry(sub, segs, 0.12, 6, false);
            const mat  = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.38, side: THREE.DoubleSide });
            const mesh = new THREE.Mesh(geom, mat);
            this.scene.add(mesh);
            this._pathObjects.push({ obj: mesh, geom, mat });
        };

        const tHeo  = this._curve.tHeoEnd;
        const tOut  = this._curve.tOutboundEnd;
        const tPeri = this._curve.tPeriapsis;

        makeTube(0,     tHeo,  COL_OUTBOUND);
        makeTube(tHeo,  tOut,  COL_OUTBOUND);
        makeTube(tOut,  tPeri, COL_FLYBY);
        makeTube(tPeri, 1.0,   COL_RETURN);

        const arrowGeom = new THREE.ConeGeometry(0.26, 0.80, 3);
        this._pathObjects.push({ obj: null, geom: arrowGeom, mat: null });

        const addArrows = (tStart, tEnd, count, color) => {
            const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
            this._pathObjects.push({ obj: null, geom: null, mat });
            for (let i = 0; i < count; i++) {
                const t       = tStart + (i + 0.5) / count * (tEnd - tStart);
                const pos     = this._curve.getPoint(t);
                const tangent = this._curve.getTangent(t).normalize();
                const cone    = new THREE.Mesh(arrowGeom, mat);
                cone.position.copy(pos);
                cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
                this.scene.add(cone);
                this._pathObjects.push({ obj: cone, geom: null, mat: null });
            }
        };

        addArrows(tHeo,  tOut,  5, COL_OUTBOUND);
        addArrows(tOut,  tPeri, 4, COL_FLYBY);
        addArrows(tPeri, 0.95,  6, COL_RETURN);
    }

    // ── Cinematic camera ──────────────────────────────────────────────────────
    /**
     * Creates the cinematic camera rig.
     * Returns a per-frame updater function bound to this mission instance.
     * The camera follows a spline derived from the trajectory: its offset is
     * computed relative to the spacecraft position + orientation each frame,
     * so there is no separate camera path — the trajectory IS the camera path.
     *
     * @returns {function(dt:number):void}
     */
    createCinematicCameraRig() {
        return (dt) => this._cinematicCameraUpdate(dt);
    }

    _cinematicCameraUpdate(dt) {
        const t   = this._t;
        const sc  = this.shipController;
        const pos = this._curve.getPoint(t);
        const nxt = this._curve.getPoint(Math.min(t + 0.003, 1.0));

        const earthPos = this._earthBody.getPosition();
        const moonPos  = this._moonBody.getPosition();

        // Earth→Moon basis vectors (ecliptic plane), recomputed each frame
        const EMraw = moonPos.clone().sub(earthPos);
        const ax    = new THREE.Vector3(EMraw.x, 0, EMraw.z).normalize(); // Earth→Moon
        const az    = new THREE.Vector3(ax.z, 0, -ax.x);                  // perpendicular (right-hand)

        const tHeo  = this._curve.tHeoEnd;      // ≈ 0.128
        const tOut  = this._curve.tOutboundEnd; // ≈ 0.362
        const tPeri = this._curve.tPeriapsis;   // ≈ 0.500

        let camTarget  = new THREE.Vector3();
        let lookTarget = new THREE.Vector3();
        let posRate    = 2.5;  // lerp rate for camera position
        let lookRate   = 4.0;  // lerp rate for lookAt

        const q = sc.shipGroup.quaternion;

        if (t < tHeo) {
            // ── DEPARTURE: slow pull-back from LEO to HEO ────────────────
            const s    = t / tHeo;                              // 0→1
            const se   = s * s;                                 // quadratic ease-in
            const back = THREE.MathUtils.lerp(2.0, 11.0, se);
            const up   = THREE.MathUtils.lerp(0.5,  4.5, s);
            camTarget.copy(pos).add(new THREE.Vector3(0, up, back).applyQuaternion(q));
            lookTarget.copy(nxt);
            posRate  = 1.8;
            lookRate = 3.5;

        } else if (t < tOut) {
            // ── TRANSIT: wide follow with subtle sinusoidal lateral drift ─
            const drift = Math.sin(t * 8.4 + 1.2) * 2.2;
            camTarget.copy(pos).add(new THREE.Vector3(drift, 5.0, 14.0).applyQuaternion(q));
            lookTarget.copy(nxt);
            posRate  = 1.0;
            lookRate = 2.0;

        } else if (t < tPeri - 0.02) {
            // ── APPROACH: lerp from follow-cam to lateral orbit-reveal ────
            const s  = (t - tOut) / (tPeri - 0.02 - tOut);
            const se = s * s * (3 - 2 * s);                    // smoothstep

            const followOff = new THREE.Vector3(0, 5.0, 14.0).applyQuaternion(q);
            // Reveal offset: +az side elevated, shows spacecraft approaching Moon
            const revealOff = az.clone().multiplyScalar(24).setY(13);

            camTarget.copy(pos).add(followOff.lerp(revealOff, se));
            lookTarget.copy(nxt).lerp(moonPos, se * 0.85);
            posRate  = 0.8;
            lookRate = 1.5;

        } else if (t < tPeri + 0.06) {
            // ── FLYBY: wide orbit-reveal shot ─────────────────────────────
            // Camera hangs on the +az side watching spacecraft arc around Moon.
            // Camera is anchored relative to spacecraft position so it tracks
            // the flyby naturally as the spacecraft moves around the Moon.
            const revealOff = az.clone().multiplyScalar(26).setY(15);
            camTarget.copy(pos).add(revealOff);
            lookTarget.copy(moonPos);
            posRate  = 0.45;
            lookRate = 0.9;

        } else if (t < 0.72) {
            // ── GRAVITY ASSIST: pull out from flyby to broad return view ──
            const s  = (t - tPeri - 0.06) / (0.72 - tPeri - 0.06);
            const se = s * s * (3 - 2 * s);

            const flybyOff  = az.clone().multiplyScalar(26).setY(15);
            const returnOff = new THREE.Vector3(0, 24, 38).applyQuaternion(q);
            camTarget.copy(pos).add(flybyOff.lerp(returnOff, se));
            lookTarget.copy(moonPos).lerp(nxt, se);
            posRate  = 0.55;
            lookRate = 1.1;

        } else {
            // ── RETURN: very wide — full figure-eight + Earth approach ────
            const s  = (t - 0.72) / 0.28;
            const se = s * s;
            const back = THREE.MathUtils.lerp(38, 68, se);
            const up   = THREE.MathUtils.lerp(24, 48, se);
            camTarget.copy(pos).add(new THREE.Vector3(0, up, back).applyQuaternion(q));
            // Fade look-at from trajectory ahead toward Earth as we approach reentry
            lookTarget.copy(nxt).lerp(earthPos, se * 0.65);
            posRate  = 0.45;
            lookRate = 0.75;
        }

        this.camera.position.lerp(camTarget, Math.min(dt * posRate, 1.0));
        this._camLookAt.lerp(lookTarget,     Math.min(dt * lookRate, 1.0));
        this.camera.lookAt(this._camLookAt);
    }

    // ── Effect beats ──────────────────────────────────────────────────────────
    /**
     * Activates and interpolates CinematicEffects based on mission progress t.
     * Designed to be called every frame via runCinematicSequence().
     * @param {number} t  Normalised mission progress [0, 1]
     */
    triggerCinematicBeats(t) {
        const fx = this._effects;
        if (!fx) return;

        const earthPos = this._earthBody.getPosition();
        const moonPos  = this._moonBody.getPosition();
        const tHeo     = this._curve.tHeoEnd;
        const tOut     = this._curve.tOutboundEnd;
        const tPeri    = this._curve.tPeriapsis;

        // Compute screen-space position of Earth for lens-flare anchor
        const sv = earthPos.clone().project(this.camera);
        const cx = (sv.x + 1) / 2;
        const cy = (1 - sv.y) / 2;

        if (t < tHeo) {
            // ── DEPARTURE ─────────────────────────────────────────────────
            // Atmospheric limb glow + atmosphere-framed vignette
            const s = t / tHeo;
            fx.setLensFlare(0.28 + s * 0.14, cx, cy);
            fx.setVignette(0.48 + s * 0.22);
            fx.setRimGlow(0, moonPos, earthPos);
            fx.setTargetExposure(fx._baseExp * (1 - s * 0.12));
            fx.setMotionBlur(0);

        } else if (t < tOut) {
            // ── TRANSIT ───────────────────────────────────────────────────
            fx.setLensFlare(0.06, cx, cy);
            fx.setVignette(0.20);
            fx.setRimGlow(0, moonPos, earthPos);
            fx.setTargetExposure(fx._baseExp);
            fx.setMotionBlur(0);

        } else if (t < tPeri + 0.06) {
            // ── APPROACH + FLYBY ──────────────────────────────────────────
            const window = tPeri + 0.06 - tOut;
            const s      = (t - tOut) / window;         // 0→1 over approach+flyby

            // Rim glow ramps up toward periapsis, decays on departure
            const rimS = Math.sin(Math.PI * Math.min(s * 1.1, 1.0));
            fx.setRimGlow(rimS * 0.95, moonPos, earthPos);

            // Exposure darkens near periapsis (spacecraft enters Moon's shadow)
            const periProx = Math.max(0, 1 - Math.abs(t - tPeri) / 0.04);
            fx.setTargetExposure(fx._baseExp * (1 - 0.32 * periProx));

            // Lens flare dims near occultation, grows on far-side departure
            fx.setLensFlare(0.20 * (1 - periProx * 0.75), cx * 0.7, cy * 1.1);
            fx.setVignette(0.28 + 0.38 * periProx);
            fx.setMotionBlur(0);

            // One-shot white flash at exact periapsis crossing
            if (!this._periFlashed && t >= tPeri - 0.002 && t <= tPeri + 0.006) {
                this._periFlashed = true;
                fx.flashWhite(0.55, 1.6);
            }

        } else if (t < 0.72) {
            // ── GRAVITY ASSIST ────────────────────────────────────────────
            // Motion blur peaks mid-phase to sell the gravity-assist turn
            const s    = (t - tPeri - 0.06) / (0.72 - tPeri - 0.06);
            const blur = Math.sin(Math.PI * s * 0.85) * 0.65;
            fx.setRimGlow(Math.max(0, 1 - s * 4), moonPos, earthPos);
            fx.setMotionBlur(blur);
            fx.setVignette(0.14 + blur * 0.18);
            fx.setLensFlare(0.04, cx, cy);
            fx.setTargetExposure(fx._baseExp);

        } else {
            // ── RETURN ────────────────────────────────────────────────────
            // Earth limb glow fades back in as spacecraft heads home
            const s = (t - 0.72) / 0.28;
            fx.setMotionBlur(0);
            fx.setRimGlow(0, moonPos, earthPos);
            fx.setLensFlare(0.07 + s * 0.22, cx, cy);
            fx.setVignette(Math.max(0.10, 0.22 - s * 0.12));
            fx.setTargetExposure(fx._baseExp * (1 + s * 0.10));
        }
    }

    // ── Orchestrator ──────────────────────────────────────────────────────────
    /**
     * Master per-frame orchestrator: blends spacecraft motion, camera motion,
     * and cinematic effects.  Called automatically by update(); can also be
     * called externally if finer control is needed.
     * @param {number} dt  Frame delta-time in seconds
     */
    runCinematicSequence(dt) {
        if (this._cameraRig) this._cameraRig(dt);
        this.triggerCinematicBeats(this._t);
        if (this._effects) this._effects.update(dt);
    }

    // ── Public API ────────────────────────────────────────────────────────────
    start(earthBody, moonBody) {
        if (this.active) return;

        const E = earthBody.getPosition();
        const M = moonBody.getPosition();
        this._earthBody = earthBody;
        this._moonBody  = moonBody;

        // Build parametric curve
        this._curve = this._buildPath(E, M);

        // Validate Moon alignment and warn if the curve misses the flyby corridor
        const alignment = validateMoonAlignment(this._curve, M);
        if (!alignment.ok) {
            console.warn('[ArtemisII] Moon alignment warning:', alignment.message);
        } else {
            console.info('[ArtemisII]', alignment.message);
        }

        this._buildPathVisuals();

        // Activate ship and suppress normal physics/HUD
        const sc = this.shipController;
        if (!sc.active) sc.enter();
        sc._missionActive = true;
        sc._orbitMode     = false;
        sc._warpAnimating = false;
        sc._orbitCooldown = 99999;
        if (sc._hud) sc._hud.style.display = 'none';

        const startPos   = this._curve.getPoint(0);
        sc.shipGroup.position.copy(startPos);
        sc.shipGroup.visible = true;

        // Seed camera close behind ship
        const startAhead = this._curve.getPoint(0.003);
        const initDir    = startAhead.clone().sub(startPos).normalize();
        const q0         = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), initDir);
        const camOff     = new THREE.Vector3(0, 0.5, 2.0).applyQuaternion(q0);
        this.camera.position.copy(startPos).add(camOff);
        this._camLookAt.copy(startAhead);
        this.camera.lookAt(this._camLookAt);

        this.orbitControls.enabled = false;
        this._t           = 0;
        this._complete    = false;
        this._periFlashed = false;

        // Initialise cinematic systems
        this._effects    = new CinematicEffects(this.scene, this._renderer);
        this._cameraRig  = this.createCinematicCameraRig();

        this.active = true;
        this._showHUD();
    }

    stop() {
        if (!this.active) return;
        this.active = false;

        if (this._pathObjects) {
            for (const { obj, geom, mat } of this._pathObjects) {
                if (obj)  this.scene.remove(obj);
                if (geom) geom.dispose();
                if (mat)  mat.dispose();
            }
            this._pathObjects = null;
        }
        this._curve      = null;
        this._cameraRig  = null;
        this._periFlashed = false;

        if (this._effects) {
            this._effects.dispose();
            this._effects = null;
        }

        const sc = this.shipController;
        sc._missionActive = false;
        sc._orbitCooldown = 0;
        sc.exit();

        this._hideHUD();
        if (this.onStop) this.onStop();
    }

    // Called every frame from main.js animate()
    update(dt) {
        if (!this.active || !this._curve) return;
        dt = Math.min(dt, 0.05);
        if (this._complete) return;

        this._t = Math.min(this._t + dt / MISSION_DURATION, 1.0);

        const sc     = this.shipController;
        const pos    = this._curve.getPoint(this._t);
        const tAhead = Math.min(this._t + 0.004, 1.0);
        const ahead  = this._curve.getPoint(tAhead);

        // Move ship along path
        sc.shipGroup.position.copy(pos);

        // Orient nose (−Z) toward direction of travel
        const dir = ahead.clone().sub(pos);
        if (dir.lengthSq() > 1e-6) {
            sc.shipGroup.quaternion.setFromUnitVectors(
                new THREE.Vector3(0, 0, -1), dir.normalize()
            );
        }

        // Engine particles
        const mFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(sc.shipGroup.quaternion);
        sc._enginePlume.spawn(14, sc.shipGroup.position, sc.shipGroup.quaternion, sc._vel, new THREE.Vector3(), mFwd, 0.55, 0.55, dt);
        sc._enginePlume.tick(dt, sc.camera, 0.65, sc._elapsed);

        // Cinematic camera + effects
        this.runCinematicSequence(dt);

        this._updateHUD();

        if (this._t >= 1.0) {
            this._complete = true;
            setTimeout(() => { if (this.active) this.stop(); }, 2500);
        }
    }
}
