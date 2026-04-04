// Artemis II mission autopilot — scripted crewed lunar flyby
// Draws the full flight path in advance, then flies the ship along it.
// Activated from the Special Events panel; press ESC to abort.

import * as THREE from 'https://esm.sh/three@0.160.0';

const MISSION_DURATION = 90; // seconds, total mission wall-clock time

// Phase labels keyed by approximate t-value (0..1).
// Control-point distribution mirrors the 10-day timeline:
//   HEO (Days 1–2) ≈ 16% t │ Transit (Days 2–5) ≈ 28% │
//   Flyby (Day 6)  ≈  9% t │ Return  (Days 7–10) ≈ 38% │ Reentry ≈ 9%
const PHASES = [
    { t: 0.00, label: 'PHASE 1  ·  HIGH EARTH ORBIT  ·  DAYS 1–2' },
    { t: 0.08, label: 'PHASE 2  ·  PROXIMITY OPERATIONS  ·  SPENT STAGE DEMO' },
    { t: 0.16, label: 'PHASE 3  ·  TRANSLUNAR INJECTION  ·  DAY 2  ·  6-MIN ENGINE BURN' },
    { t: 0.30, label: 'PHASE 4  ·  OUTBOUND TRANSIT  ·  DEEP SPACE  ·  DAYS 3–5' },
    { t: 0.44, label: 'PHASE 5  ·  LUNAR APPROACH  ·  DAY 6' },
    { t: 0.49, label: 'PHASE 6  ·  FAR-SIDE FLYBY  ·  252,797 MI FROM EARTH  ·  RECORD' },
    { t: 0.54, label: 'PHASE 7  ·  FREE RETURN TRAJECTORY  ·  DAYS 7–10' },
    { t: 0.92, label: 'PHASE 8  ·  REENTRY  ·  25,000 MPH  ·  PACIFIC SPLASHDOWN  ·  APR 10' },
];

export class ArtemisMission {
    constructor(scene, camera, orbitControls, shipController) {
        this.scene          = scene;
        this.camera         = camera;
        this.orbitControls  = orbitControls;
        this.shipController = shipController;

        this.active      = false;
        this._t          = 0;
        this._curve      = null;
        this._pathLine   = null;
        this._camLookAt  = new THREE.Vector3();
        this._complete   = false;
        this._earthBody  = null;
        this._moonBody   = null;

        // Callback wired from main.js so button state can be restored
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
            if (e.code === 'Escape' && this.active) {
                e.preventDefault();
                this.stop();
            }
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
        if (this._phaseEl) this._phaseEl.textContent = label;
        if (this._progressEl) this._progressEl.style.width = (this._t * 100).toFixed(1) + '%';
    }

    // ── Path construction ─────────────────────────────────────────────────────
    // Control-point counts are chosen to make t proportional to real mission time:
    //   HEO 16 pts (~18% t) | Transit 28 pts (~28%) | Flyby 9 pts (~9%)
    //   Return 38 pts (~38%) | Reentry 9 pts (~9%)   total ≈ 100 pts
    //
    // Local frame (ecliptic plane):
    //   ax = Earth → Moon unit vector
    //   az = perpendicular right (ecliptic)
    _buildPath(E, M) {
        const EMvec = M.clone().sub(E);
        const ax    = new THREE.Vector3(EMvec.x, 0, EMvec.z).normalize();
        const az    = new THREE.Vector3(ax.z, 0, -ax.x);
        const dist  = EMvec.length(); // Earth→Moon distance ≈ 14 scene units

        // HEO ellipse (artistic — visibly elliptical, not Keplerian)
        const heoA  = 9.0;  // semi-axis in Moon-facing / anti-Moon direction
        const heoB  = 5.5;  // semi-axis perpendicular (heoB < heoA → clearly elliptical)
        // Flyby radius from Moon center — mirrors ~6,000-mile altitude (4,000–6,000 mi range)
        const FR    = 3.5;

        const ep    = (a, z) => E.clone().addScaledVector(ax, a).addScaledVector(az, z).setY(E.y);
        const mp    = (a, z) => M.clone().addScaledVector(ax, a).addScaledVector(az, z);
        const heoP  = (θ)    => ep(heoA * Math.cos(θ), heoB * Math.sin(θ));

        const pts   = [];

        // ── Phases 1–2: High Earth Orbit — 1.5 elliptical revolutions ────────
        // Start at anti-Moon "periapsis" (θ=π).  After 1.5 revolutions the ship
        // arrives at the Moon-facing "apoapsis" (θ=4π≡0) — TLI firing point.
        // 16 control points ≈ 18% of total t, mirroring Days 1–2 (20% of 10 days).
        for (let i = 0; i <= 15; i++) {
            pts.push(heoP(Math.PI + (i / 10) * Math.PI * 2));
        }
        // Ends at heoP(0) = ep(heoA, 0) = E + ax·9 (Moon-facing apoapsis).

        // ── Phases 3–4: TLI + Outbound Transit on +az side ───────────────────
        // 28 control points ≈ 28% of total t, mirroring ~3 days outbound (Days 2–5).
        // Arc rises to +7 az at mid-transit then descends to FR as it nears Moon.
        for (let i = 0; i < 28; i++) {
            const t   = i / 27;
            const a_  = heoA + t * (dist - FR - heoA);   // ax: heoA → dist−FR ≈ 10.5
            const z_  = Math.sin(t * Math.PI) * 7.0 + t * FR; // az: 0 → +7 → FR=3.5
            pts.push(ep(a_, z_));
        }
        // Ends at ep(dist−FR, FR) ≈ (10.5, 3.5) — approaching Moon from +az.

        // ── Phases 5–6: Far-Side Lunar Flyby ─────────────────────────────────
        // CW sweep: a=+π/2 (+az approach) → a=0 (anti-Earth far side) → a=−π/2 (−az).
        // a=0 gives mp(FR, 0) = Moon + ax·FR = Moon's anti-Earth face — the FAR SIDE.
        // 9 control points ≈ 9% of total t, mirroring Day 6.
        for (let i = 0; i <= 8; i++) {
            const a = Math.PI / 2 - (i / 8) * Math.PI;
            pts.push(mp(Math.cos(a) * FR, Math.sin(a) * FR));
        }
        // Ends at mp(0, −FR) = ep(dist, −FR) — Moon's −az departure side.

        // ── Phase 7: Free Return Trajectory on −az side ──────────────────────
        // 38 control points ≈ 38% of total t, mirroring Days 7–10 (4 days).
        // Mirrors outbound shape but below ecliptic, forming the figure-8 silhouette.
        for (let i = 0; i < 38; i++) {
            const t   = i / 37;
            const a_  = dist * (1 - t) + 1.5 * t;                    // Moon → near Earth
            const z_  = -FR + t * (-FR) + Math.sin(t * Math.PI) * -(7 - FR); // −FR → −7 → −2FR
            pts.push(ep(a_, z_));
        }
        // Ends at ep(1.5, −7.0) — near Earth on −az side.

        // ── Phase 8: Reentry Approach ─────────────────────────────────────────
        // Arc around Earth from −az arrival toward Pacific splashdown.
        // 9 control points ≈ 9% of total t.
        const startA = Math.atan2(-2 * FR, 1.5); // angle of last return point
        for (let i = 0; i <= 8; i++) {
            const a = startA + (i / 8) * (Math.PI * 0.85);
            pts.push(ep(Math.cos(a) * 5.5, Math.sin(a) * 5.5));
        }

        return pts;
    }

    // ── Public API ────────────────────────────────────────────────────────────
    start(earthBody, moonBody) {
        if (this.active) return;

        const E = earthBody.getPosition();
        const M = moonBody.getPosition();

        this._earthBody = earthBody;
        this._moonBody  = moonBody;

        // Build and cache the parametric curve
        const ctrlPts = this._buildPath(E, M);
        this._curve = new THREE.CatmullRomCurve3(ctrlPts, false, 'centripetal', 0.5);

        // Draw the full path line in the scene
        const linePts = this._curve.getPoints(500);
        this._pathLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(linePts),
            new THREE.LineBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.60 })
        );
        this.scene.add(this._pathLine);

        // Activate the ship and place it at path start
        const sc = this.shipController;
        if (!sc.active) sc.enter();
        // Suppress orbit detection and normal physics while mission is running
        sc._missionActive   = true;
        sc._orbitMode       = false;
        sc._warpAnimating   = false;
        sc._orbitCooldown   = 99999;
        // Hide the normal ship HUD — mission HUD takes over
        if (sc._hud) sc._hud.style.display = 'none';

        const startPos = this._curve.getPoint(0);
        sc.shipGroup.position.copy(startPos);
        sc.shipGroup.visible = true;

        // Seed camera behind start position — zoomed out to show the full mission arc
        const startAhead = this._curve.getPoint(0.003);
        const initDir = startAhead.clone().sub(startPos).normalize();
        const q0 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), initDir);
        const camOff = new THREE.Vector3(0, 8, 25).applyQuaternion(q0);
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

        // Remove path line
        if (this._pathLine) {
            this.scene.remove(this._pathLine);
            this._pathLine.geometry.dispose();
            this._pathLine.material.dispose();
            this._pathLine = null;
        }
        this._curve = null;

        // Restore ship controller to normal state
        const sc = this.shipController;
        sc._missionActive = false;
        sc._orbitCooldown = 0;
        sc.exit(); // exits flight mode, re-enables orbit controls

        this._hideHUD();
        if (this.onStop) this.onStop();
    }

    // Called every frame from main.js animate()
    update(dt) {
        if (!this.active || !this._curve) return;
        dt = Math.min(dt, 0.05);

        // Mission complete — linger at finish for 2 s then exit
        if (this._complete) return;

        this._t = Math.min(this._t + dt / MISSION_DURATION, 1.0);

        const sc  = this.shipController;
        const pos = this._curve.getPoint(this._t);
        const tAhead = Math.min(this._t + 0.004, 1.0);
        const ahead   = this._curve.getPoint(tAhead);

        // Move ship along path
        sc.shipGroup.position.copy(pos);

        // Orient nose (−Z) toward direction of travel
        const dir = ahead.clone().sub(pos);
        if (dir.lengthSq() > 1e-6) {
            sc.shipGroup.quaternion.setFromUnitVectors(
                new THREE.Vector3(0, 0, -1), dir.normalize()
            );
        }

        // Engine particles — give the ship a nice plume in flight
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(sc.shipGroup.quaternion);
        sc._spawnParticles(14, fwd, 0.55, 0.55);
        sc._tickParticles();

        // ── Camera ───────────────────────────────────────────────────────────
        // Zoomed-out overview: camera sits well above and behind ship so the
        // whole Earth-Moon arc is visible most of the time.
        const overviewOff = new THREE.Vector3(0, 8, 26).applyQuaternion(sc.shipGroup.quaternion);
        const targetCamPos = pos.clone().add(overviewOff);

        // Moonshot view: during lunar approach (Phase 5) and far-side flyby
        // (Phase 6), shift look-at toward the Moon so it fills the frame.
        // t-range 0.42–0.57 matches the new flyby control-point distribution.
        const MOON_IN  = 0.42; // blend starts — lunar approach
        const MOON_OUT = 0.57; // blend ends — after flyby departure
        let moonBlend = 0;
        if (this._t >= MOON_IN && this._t <= MOON_OUT) {
            const halfSpan = (MOON_OUT - MOON_IN) / 2;
            const mid = MOON_IN + halfSpan;
            moonBlend = this._t <= mid
                ? (this._t - MOON_IN) / halfSpan
                : 1 - (this._t - mid) / halfSpan;
            moonBlend = Math.max(0, Math.min(1, moonBlend));
        }

        let lookTarget = ahead.clone();
        if (moonBlend > 0 && this._moonBody) {
            const moonPos = this._moonBody.getPosition();
            // Blend look-at from ahead-of-ship toward the Moon
            lookTarget.lerp(moonPos, moonBlend * 0.85);
        }

        this.camera.position.lerp(targetCamPos, Math.min(dt * 3.5, 1.0));
        this._camLookAt.lerp(lookTarget, Math.min(dt * 5.0, 1.0));
        this.camera.lookAt(this._camLookAt);

        // Update mission HUD
        this._updateHUD();

        // Mission end
        if (this._t >= 1.0) {
            this._complete = true;
            setTimeout(() => { if (this.active) this.stop(); }, 2500);
        }
    }
}
