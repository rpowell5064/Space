// Artemis II mission autopilot — scripted crewed lunar flyby
// ─────────────────────────────────────────────────────────────────────────────
//  Path geometry creates a true figure-8 shape:
//    Phase 1–2  High Earth Orbit (HEO) — 1.5 elliptical loops
//    Phase 3–4  TLI + Outbound on +az side (above Earth–Moon line)
//    Phase 5–6  Far-side flyby — 270° CW arc around the Moon
//    Phase 7    Free return on −az side, CROSSING the HEO arc at ax≈5.3
//               (symmetric sine arc ensures the paths cross visibly)
//
//  The figure-8 crossing:
//    The return arc az = −sin(t·π)·5.5 combined with ax linearly decreasing
//    from dist−FR to 4 produces az≈−4.44 at ax≈5.35.  The HEO ellipse
//    boundary at ax=5.35 is −5.5·√(1−(5.35/9)²) ≈ −4.43 — they intersect,
//    creating the visible figure-8 crossing ~3 units above Earth's surface.
//
//  Control-point counts → t fractions  (95 pts → last idx = 94)
//    HEO end       t ≈ 0.160  (idx 15)
//    Outbound end  t ≈ 0.457  (idx 43)
//    Flyby end     t ≈ 0.596  (idx 56)
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'https://esm.sh/three@0.160.0';

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

// Segment t-boundaries (idx / 94, 95 control points → last idx = 94)
const T_HEO_END      = 15 / 94;  // ≈ 0.160
const T_OUTBOUND_END = 43 / 94;  // ≈ 0.457
const T_FLYBY_END    = 56 / 94;  // ≈ 0.596

// Path colours matching the reference diagram
const COL_OUTBOUND = 0x8B9C3A;  // olive green  (HEO + outbound)
const COL_FLYBY    = 0x2255CC;  // blue         (flyby arc)
const COL_RETURN   = 0xCC2288;  // magenta/pink (return)

export class ArtemisMission {
    constructor(scene, camera, orbitControls, shipController) {
        this.scene          = scene;
        this.camera         = camera;
        this.orbitControls  = orbitControls;
        this.shipController = shipController;

        this.active       = false;
        this._t           = 0;
        this._curve       = null;
        this._pathObjects = null;  // [{obj, geom, mat}] — disposed in stop()
        this._camLookAt   = new THREE.Vector3();
        this._complete    = false;
        this._earthBody   = null;
        this._moonBody    = null;

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

    // ── Path geometry ─────────────────────────────────────────────────────────
    _buildPath(E, M) {
        const EMvec = M.clone().sub(E);
        const ax    = new THREE.Vector3(EMvec.x, 0, EMvec.z).normalize();
        const az    = new THREE.Vector3(ax.z, 0, -ax.x);  // perpendicular in ecliptic
        const dist  = EMvec.length();

        const heoA = 9.0;   // HEO semi-major axis (Moon-facing)
        const heoB = 5.5;   // HEO semi-minor axis (perpendicular)
        const FR   = 5.5;   // flyby radius — enlarged for a visible Moon loop

        // Helpers: point relative to Earth or Moon in ecliptic frame
        const ep   = (a, z) => E.clone().addScaledVector(ax, a).addScaledVector(az, z).setY(E.y);
        const mp   = (a, z) => M.clone().addScaledVector(ax, a).addScaledVector(az, z).setY(M.y);
        const heoP = (θ)    => ep(heoA * Math.cos(θ), heoB * Math.sin(θ));

        const pts = [];

        // ── Phase 1–2: HEO — 1.5 elliptical loops (16 pts) ──────────────────
        // Starts at anti-Moon apoapsis (θ=π), completes 1.5 loops, ends at
        // Moon-facing apoapsis (θ=2π≡0) — the TLI departure point ep(9, 0).
        for (let i = 0; i <= 15; i++) {
            pts.push(heoP(Math.PI + (i / 10) * Math.PI * 2));
        }
        // Ends at ep(heoA, 0) = ep(9, 0)

        // ── Phase 3–4: Outbound transit on +az side (28 pts) ────────────────
        // Departs HEO Moon-facing apoapsis, arcs ABOVE the Earth–Moon axis,
        // peaks at ~6.5 az, then curves down to approach the Moon from +az side.
        for (let i = 0; i < 28; i++) {
            const t  = i / 27;
            const a_ = heoA + t * (dist - heoA);               // ax: 9 → dist
            const z_ = Math.sin(t * Math.PI) * 5.5 + t * FR;   // az: 0 → peak → FR
            pts.push(ep(a_, z_));
        }
        // Ends at ep(dist, FR) = mp(0, FR) — Moon +az approach

        // ── Phase 5–6: Far-side flyby — 270° CW arc (13 pts) ─────────────────
        // Sweeps CW from Moon's +az side → far (anti-Earth) side → −az → near (Earth-facing).
        // a: π/2 → −π  (decreasing by 3π/2 = 270°)
        for (let i = 0; i <= 12; i++) {
            const a = Math.PI / 2 - (i / 12) * (Math.PI * 1.5);
            pts.push(mp(Math.cos(a) * FR, Math.sin(a) * FR));
        }
        // Ends at mp(cos(−π)·FR, sin(−π)·FR) = mp(−FR, 0) = Earth-facing side

        // ── Phase 7: Free return on −az side — FIGURE-8 CROSSING (38 pts) ────
        // KEY GEOMETRY: Symmetric sine arc — starts at az=0, peaks at −5.5, returns to az=0.
        // This arc crosses the HEO ellipse at approximately ax≈5.35, az≈−4.44:
        //   HEO boundary: −heoB·√(1−(5.35/heoA)²) ≈ −4.43
        //   Return az at ax=5.35: −sin(t·π)·5.5 ≈ −4.45
        // The two paths visibly CROSS there, forming the lower lobe of the figure-8.
        const retStart = dist - FR;  // ≈ 8.5 — Earth-facing side of Moon
        const retEnd   = 4.0;        // near Earth's surface (Earth mesh radius = 4)
        for (let i = 0; i < 38; i++) {
            const t  = i / 37;
            const a_ = retStart + t * (retEnd - retStart);  // 8.5 → 4.0 (toward Earth)
            const z_ = -Math.sin(t * Math.PI) * 5.5;        // 0 → −5.5 peak → 0 (symmetric)
            pts.push(ep(a_, z_));
        }
        // Ends at ep(4, 0) — Earth surface along Earth–Moon axis

        return pts;  // 16 + 28 + 13 + 38 = 95 control points
    }

    // ── Path visuals: tube segments + directional cone arrows ────────────────
    _buildPathVisuals() {
        this._pathObjects = [];
        const SAMPLES = 800;
        const allPts  = this._curve.getPoints(SAMPLES);

        // Slice the master point array for a t-range → sub-curve → TubeGeometry
        const makeTube = (tStart, tEnd, color) => {
            const i0  = Math.round(tStart * SAMPLES);
            const i1  = Math.min(Math.round(tEnd * SAMPLES) + 2, allPts.length - 1);
            const pts = allPts.slice(i0, i1 + 1);
            if (pts.length < 2) return;
            const sub  = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
            const segs = Math.max(pts.length * 2, 40);
            const geom = new THREE.TubeGeometry(sub, segs, 0.12, 6, false);
            const mat  = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92, side: THREE.DoubleSide });
            const mesh = new THREE.Mesh(geom, mat);
            this.scene.add(mesh);
            this._pathObjects.push({ obj: mesh, geom, mat });
        };

        // Olive: HEO loops + outbound transit
        makeTube(0,                T_HEO_END,      COL_OUTBOUND);
        makeTube(T_HEO_END,        T_OUTBOUND_END, COL_OUTBOUND);
        // Blue: 270° flyby arc around the Moon
        makeTube(T_OUTBOUND_END,   T_FLYBY_END,    COL_FLYBY);
        // Magenta: free-return trajectory (crosses HEO = figure-8)
        makeTube(T_FLYBY_END,      1.0,            COL_RETURN);

        // ── Directional arrow cones ───────────────────────────────────────────
        const arrowGeom = new THREE.ConeGeometry(0.26, 0.80, 3);
        this._pathObjects.push({ obj: null, geom: arrowGeom, mat: null });

        const addArrows = (tStart, tEnd, count, color) => {
            const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
            this._pathObjects.push({ obj: null, geom: null, mat });

            for (let i = 0; i < count; i++) {
                const t       = tStart + (i + 0.5) / count * (tEnd - tStart);
                const pos     = this._curve.getPoint(t);
                const tangent = this._curve.getTangent(t).normalize();

                const cone = new THREE.Mesh(arrowGeom, mat);
                cone.position.copy(pos);
                cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
                this.scene.add(cone);
                this._pathObjects.push({ obj: cone, geom: null, mat: null });
            }
        };

        addArrows(T_HEO_END,      T_OUTBOUND_END, 5, COL_OUTBOUND);
        addArrows(T_OUTBOUND_END, T_FLYBY_END,    4, COL_FLYBY);
        addArrows(T_FLYBY_END,    0.95,           6, COL_RETURN);
    }

    // ── Public API ────────────────────────────────────────────────────────────
    start(earthBody, moonBody) {
        if (this.active) return;

        const E = earthBody.getPosition();
        const M = moonBody.getPosition();
        this._earthBody = earthBody;
        this._moonBody  = moonBody;

        // Build parametric curve (used for both flying and path visuals)
        const ctrlPts = this._buildPath(E, M);
        this._curve   = new THREE.CatmullRomCurve3(ctrlPts, false, 'centripetal', 0.5);
        this._buildPathVisuals();

        // Activate ship and suppress normal physics/HUD while mission runs
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

        // Seed camera close behind the ship so the spacecraft is clearly visible
        const startAhead = this._curve.getPoint(0.003);
        const initDir    = startAhead.clone().sub(startPos).normalize();
        const q0         = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), initDir);
        const camOff     = new THREE.Vector3(0, 0.45, 1.5).applyQuaternion(q0);
        this.camera.position.copy(startPos).add(camOff);
        this._camLookAt.copy(startAhead);
        this.camera.lookAt(this._camLookAt);

        this.orbitControls.enabled = false;
        this._t        = 0;
        this._complete = false;
        this.active    = true;
        this._showHUD();
    }

    stop() {
        if (!this.active) return;
        this.active = false;

        // Dispose every scene object created for the path
        if (this._pathObjects) {
            for (const { obj, geom, mat } of this._pathObjects) {
                if (obj)  this.scene.remove(obj);
                if (geom) geom.dispose();
                if (mat)  mat.dispose();
            }
            this._pathObjects = null;
        }
        this._curve = null;

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
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(sc.shipGroup.quaternion);
        sc._spawnParticles(14, fwd, 0.55, 0.55);
        sc._tickParticles();

        // ── Camera: close follow so the ship is clearly visible ───────────────
        // (0, 0.45, 1.5) is 1.5 units behind and 0.45 above — ship fills ~4° of FOV
        const camOff       = new THREE.Vector3(0, 0.45, 1.5).applyQuaternion(sc.shipGroup.quaternion);
        const targetCamPos = pos.clone().add(camOff);

        // Blend look-at toward Moon during lunar approach + flyby + early return
        const MOON_IN  = 0.42;
        const MOON_OUT = 0.62;
        let moonBlend  = 0;
        if (this._t >= MOON_IN && this._t <= MOON_OUT) {
            const halfSpan = (MOON_OUT - MOON_IN) / 2;
            const mid      = MOON_IN + halfSpan;
            moonBlend = this._t <= mid
                ? (this._t - MOON_IN)  / halfSpan
                : 1 - (this._t - mid)  / halfSpan;
            moonBlend = Math.max(0, Math.min(1, moonBlend));
        }

        let lookTarget = ahead.clone();
        if (moonBlend > 0 && this._moonBody) {
            lookTarget.lerp(this._moonBody.getPosition(), moonBlend * 0.85);
        }

        this.camera.position.lerp(targetCamPos, Math.min(dt * 3.5, 1.0));
        this._camLookAt.lerp(lookTarget, Math.min(dt * 5.0, 1.0));
        this.camera.lookAt(this._camLookAt);

        this._updateHUD();

        if (this._t >= 1.0) {
            this._complete = true;
            setTimeout(() => { if (this.active) this.stop(); }, 2500);
        }
    }
}
