// js/missions/figureEightCurve.js
// ─────────────────────────────────────────────────────────────────────────────
//  FigureEightFreeReturnCurve — parametric figure-eight free-return trajectory
//
//  Coordinate system: Earth-centred, ecliptic-plane (xz).
//  All scene units follow the project convention (1 AU = 100 units).
//
//  Curve structure (95 control points → CatmullRom centripetal):
//
//    t=0           Anti-Moon HEO apoapsis (start)
//    t≈0.128       HEO end / TLI departure  (tHeoEnd)
//    t≈0.362       End of outbound transit   (tOutboundEnd)
//    t≈0.500       Lunar periapsis — Earth-facing side of Moon  (tPeriapsis)
//    t=1.0         Earth arrival / re-entry
//
//  Point distribution:
//    Outbound half  pts[0..47]  (48 pts) — HEO + transit + 270° flyby
//    Return   half  pts[47..94] (48 pts, sharing periapsis) — free-return arc
//
//  The figure-eight crossing:
//    The return arc uses az = −sin(s·π)·returnWidth which passes through the
//    HEO ellipse boundary at ax ≈ retStart/2.  The outbound arc uses
//    az = +sin(s·π)·5.5 on the opposite side, so the two arcs cross once
//    between Earth and Moon, forming the lower lobe of the figure-eight.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'https://esm.sh/three@0.160.0';

// ── Curve class ───────────────────────────────────────────────────────────────
export class FigureEightFreeReturnCurve extends THREE.Curve {
    /**
     * @param {THREE.Vector3} earthPos  World position of Earth centre
     * @param {THREE.Vector3} moonPos   World position of Moon centre
     * @param {object}  [opts]
     * @param {number}  [opts.heoSemiMajor=9]          HEO semi-major radius (Moon-facing direction)
     * @param {number}  [opts.heoSemiMinor=5.5]        HEO semi-minor radius (perpendicular)
     * @param {number}  [opts.flybyRadius=5.5]         Closest-approach distance from Moon centre
     * @param {number}  [opts.returnWidth=5.5]         Peak lateral offset of return arc
     * @param {number}  [opts.earthArrivalRadius=4]    Radial distance at Earth arrival (≈ Earth mesh radius)
     * @param {number}  [opts.flybyElevation=3.0]      Peak Y-axis lift above the ecliptic during flyby.
     *                                                  Peaks at the far (anti-Earth) side — the "Earth shot"
     *                                                  position where Earth is visible over the Moon's limb.
     */
    constructor(earthPos, moonPos, opts = {}) {
        super();

        const heoA   = opts.heoSemiMajor      ?? 9;
        const heoB   = opts.heoSemiMinor       ?? 5.5;
        const FR     = opts.flybyRadius        ?? 5.5;
        const retW   = opts.returnWidth        ?? 5.5;
        const retEnd = opts.earthArrivalRadius ?? 4;
        const flybyElev = opts.flybyElevation  ?? 3.0;

        // ── Basis vectors centred on Earth (XZ plane only) ───────────────
        const EMvec  = moonPos.clone().sub(earthPos);
        // Use the XZ-projected distance for all axial extents.
        // The Moon can have a significant Y offset from Earth's orbital plane
        // (Earth's axialTilt tilts the moonGroup, putting the Moon ±5+ units off
        // the ecliptic). Using the full 3D distance would overshoot in XZ.
        const distXZ = Math.sqrt(EMvec.x * EMvec.x + EMvec.z * EMvec.z);
        const dist   = distXZ; // kept as alias for readability below
        const ax     = new THREE.Vector3(EMvec.x, 0, EMvec.z).normalize(); // Earth→Moon (XZ)
        const az     = new THREE.Vector3(ax.z, 0, -ax.x);                  // perpendicular (XZ)

        // Point helpers.
        //   ep: starts at earthPos — Y = earthPos.y naturally (ax/az have no Y)
        //   mp: starts at moonPos  — Y = moonPos.y naturally (ax/az have no Y)
        //   No .setY() override: each helper inherits the correct body's Y.
        const ep   = (a, z) => earthPos.clone().addScaledVector(ax, a).addScaledVector(az, z);
        const mp   = (a, z) => moonPos .clone().addScaledVector(ax, a).addScaledVector(az, z);
        const heoP = (θ)    => ep(heoA * Math.cos(θ), heoB * Math.sin(θ));

        const pts = [];

        // ── OUTBOUND HALF ─────────────────────────────────────────────────
        // Phase 1 · HEO — 1.5 elliptical loops (anti-Moon → Moon-facing)
        //   13 unique points, indices 0–12  (all at earthPos.y via ep/heoP)
        for (let i = 0; i < 13; i++) {
            pts.push(heoP(Math.PI + (i / 12) * Math.PI * 3));
        }
        // pts[12] = ep(heoA, 0) — TLI departure point ✓

        // Phase 2 · Outbound transit on +az side
        //   Y smoothly interpolates from earthPos.y → moonPos.y so the path
        //   arrives at the Moon's actual elevation regardless of orbital tilt.
        //   The final 30% also adds the flyby-elevation lead-in on top of that.
        //   22 new points, indices 13–34
        for (let i = 1; i <= 22; i++) {
            const s  = i / 22;
            const a_ = heoA + s * (distXZ - heoA);            // radial: heoA → distXZ
            const z_ = Math.sin(s * Math.PI) * 5.5 + s * FR;  // lateral: 0 → peak → FR
            // Base Y tracks from Earth's level to Moon's level
            const yBase = earthPos.y + s * (moonPos.y - earthPos.y);
            // Cinematic elevation lead-in over the final 30%
            const yLead = s > 0.7
                ? flybyElev * 0.5 * Math.sin(((s - 0.7) / 0.3) * Math.PI * 0.5)
                : 0;
            const pt = ep(a_, z_);
            pt.y = yBase + yLead;
            pts.push(pt);
        }
        // pts[34] ≈ ep(distXZ, FR) at moonPos.y + yLead — Moon +az approach ✓

        // Phase 3 · 270° CW flyby arc around the Moon — with Y elevation
        //   All points are Moon-relative (mp), so Y is anchored to moonPos.y.
        //   The artistic elevation is added on top of moonPos.y, not baseY.
        //
        //   Y profile: Math.max(0, sin(progress · 1.5π))
        //     progress=0   → 0         (approach from +az, at moonPos.y)
        //     progress=1/3 → peak      (far side — "Earth over the limb" shot)
        //     progress=2/3 → 0         (back to moonPos.y)
        //     progress=1   → 0         (periapsis, moonPos.y)
        //   13 new points, indices 35–47
        for (let i = 1; i <= 13; i++) {
            const a        = Math.PI / 2 - (i / 13) * (Math.PI * 1.5);
            const progress = i / 13;
            const yElev    = flybyElev * Math.max(0, Math.sin(progress * Math.PI * 1.5));
            const pt       = mp(Math.cos(a) * FR, Math.sin(a) * FR);
            pt.y = moonPos.y + yElev;   // anchored to Moon's actual Y, not Earth's
            pts.push(pt);
        }
        // pts[47] = mp(−FR, 0) at moonPos.y — periapsis ✓
        // Outbound half: 13 + 22 + 13 = 48 unique points  (pts[0..47])

        // ── RETURN HALF ───────────────────────────────────────────────────
        // Phase 4 · Free-return arc on −az side
        //   Y smoothly interpolates from moonPos.y → earthPos.y so the arc
        //   arrives at Earth's elevation for re-entry regardless of Moon tilt.
        //   47 new points, indices 48–94
        const retStart = distXZ - FR;
        for (let i = 1; i <= 47; i++) {
            const s  = i / 47;
            const a_ = retStart + s * (retEnd - retStart);    // radial: distXZ−FR → retEnd
            const z_ = -Math.sin(s * Math.PI) * retW;         // lateral: 0 → −retW → 0
            // Base Y descends from Moon's level back to Earth's level
            const yBase = moonPos.y + s * (earthPos.y - moonPos.y);
            // Small residual elevation from flyby decays in first 20%
            const yDrop = s < 0.2
                ? flybyElev * 0.15 * Math.cos((s / 0.2) * Math.PI * 0.5)
                : 0;
            const pt = ep(a_, z_);
            pt.y = yBase + yDrop;
            pts.push(pt);
        }
        // pts[94] = ep(retEnd, 0) at earthPos.y — Earth arrival ✓
        // Total: 48 + 47 = 95 unique points  (pts[0..94])

        // ── Internal curve — centripetal CatmullRom ───────────────────────
        // Alpha=0.5 (centripetal) prevents cusps at unevenly-spaced knots.
        // closed=false, no loop.
        this._inner = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);

        // ── Exposed t-landmarks (index / 94) ─────────────────────────────
        /** t at end of HEO phase / start of outbound transit */
        this.tHeoEnd      = 12 / 94;   // ≈ 0.128
        /** t at end of outbound transit / start of flyby arc */
        this.tOutboundEnd = 34 / 94;   // ≈ 0.362
        /** t at lunar periapsis (midpoint, Earth-facing side of Moon) */
        this.tPeriapsis   = 47 / 94;   // ≈ 0.500
        /** Scene-unit Earth–Moon XZ distance used when building this curve */
        this.moonDistance = distXZ;
    }

    // THREE.Curve interface
    getPoint(t, optionalTarget = new THREE.Vector3()) {
        return this._inner.getPoint(t, optionalTarget);
    }

    // Delegate tangent to inner curve for better precision than base-class finite diff
    getTangent(t, optionalTarget = new THREE.Vector3()) {
        return this._inner.getTangent(t, optionalTarget);
    }

    // Override for better arc-length approximation (THREE default is 200 samples)
    getLength() {
        return this._inner.getLength();
    }
}

// ── createTrajectoryTube ──────────────────────────────────────────────────────
/**
 * Build a coloured TubeGeometry mesh for the trajectory.
 * Three colour bands: olive (HEO+transit), blue (flyby), magenta (return).
 *
 * @param {FigureEightFreeReturnCurve} curve
 * @param {object}  [opts]
 * @param {number}  [opts.tubeRadius=0.12]         Cross-section radius
 * @param {number}  [opts.tubularSegments=700]     Longitudinal segments
 * @param {number}  [opts.radialSegments=6]        Cross-section sides
 * @param {number}  [opts.colorOutbound=0x8B9C3A]  Olive green (HEO + transit)
 * @param {number}  [opts.colorFlyby=0x2255CC]     Blue (lunar flyby arc)
 * @param {number}  [opts.colorReturn=0xCC2288]    Magenta (free-return)
 * @param {number}  [opts.opacity=0.38]
 * @returns {THREE.Group}  Group containing the three tube meshes
 */
export function createTrajectoryTube(curve, opts = {}) {
    const tubeR   = opts.tubeRadius      ?? 0.12;
    const tubeSeg = opts.tubularSegments ?? 700;
    const radSeg  = opts.radialSegments  ?? 6;
    const cOut    = opts.colorOutbound   ?? 0x8B9C3A;
    const cFly    = opts.colorFlyby      ?? 0x2255CC;
    const cRet    = opts.colorReturn     ?? 0xCC2288;
    const opacity = opts.opacity         ?? 0.38;

    const SAMPLES = tubeSeg;
    const allPts  = curve.getPoints(SAMPLES);
    const group   = new THREE.Group();

    /**
     * Slice a t-range from the evaluated point array, fit a new CatmullRom
     * sub-curve, and extrude a TubeGeometry in the requested colour.
     */
    const makeTube = (tStart, tEnd, color) => {
        const i0   = Math.round(tStart * SAMPLES);
        const i1   = Math.min(Math.round(tEnd * SAMPLES) + 2, allPts.length - 1);
        const slice = allPts.slice(i0, i1 + 1);
        if (slice.length < 2) return;
        const sub  = new THREE.CatmullRomCurve3(slice, false, 'centripetal', 0.5);
        const segs = Math.max((i1 - i0) * 2, 40);
        const geo  = new THREE.TubeGeometry(sub, segs, tubeR, radSeg, false);
        const mat  = new THREE.MeshBasicMaterial({
            color, transparent: true, opacity, side: THREE.DoubleSide
        });
        group.add(new THREE.Mesh(geo, mat));
    };

    // Olive: HEO loops + outbound transit (t=0 → tOutboundEnd)
    makeTube(0,                    curve.tOutboundEnd, cOut);
    // Blue:   270° flyby arc        (tOutboundEnd → tPeriapsis)
    makeTube(curve.tOutboundEnd,   curve.tPeriapsis,   cFly);
    // Magenta: free-return arc      (tPeriapsis → 1)
    makeTube(curve.tPeriapsis,     1.0,                cRet);

    return group;
}

// ── animateSpacecraft ─────────────────────────────────────────────────────────
/**
 * Move and orient a mesh along the trajectory based on elapsed mission time.
 * Call this every frame inside your animation loop.
 *
 * Orientation: mesh −Z axis is aligned to direction of travel.
 * Works with any THREE.Object3D (Mesh, Group, etc.).
 *
 * @param {THREE.Object3D} mesh              Spacecraft mesh or group
 * @param {FigureEightFreeReturnCurve} curve Trajectory curve
 * @param {number} elapsedTime               Seconds since mission start
 * @param {number} [duration=90]             Total mission duration in seconds
 * @param {number} [lookAheadDelta=0.004]    t-step used to compute forward direction
 * @returns {number}  Normalised progress t ∈ [0, 1]
 */
export function animateSpacecraft(mesh, curve, elapsedTime, duration = 90, lookAheadDelta = 0.004) {
    const t     = Math.min(elapsedTime / duration, 1.0);
    const tNext = Math.min(t + lookAheadDelta, 1.0);

    const pos  = curve.getPoint(t);
    const next = curve.getPoint(tNext);

    mesh.position.copy(pos);

    const dir = next.clone().sub(pos);
    if (dir.lengthSq() > 1e-10) {
        mesh.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 0, -1),
            dir.normalize()
        );
    }

    return t;
}

// ── validateMoonAlignment ─────────────────────────────────────────────────────
/**
 * Sample the trajectory at high resolution and verify the Moon falls within
 * the expected flyby corridor.  Call this after constructing the curve to
 * catch any geometry issues early.
 *
 * Returns an object describing the result.  If `ok` is false the curve
 * parameters (flybyRadius, heoSemiMajor, returnWidth) should be adjusted
 * and the curve regenerated.
 *
 * @param {FigureEightFreeReturnCurve} curve
 * @param {THREE.Vector3} moonPosition   Live world position of the Moon mesh
 * @param {object}  [opts]
 * @param {number}  [opts.samples=2000]              Resolution of the sweep
 * @param {number}  [opts.maxApproachDistance=8]     Max acceptable scene-unit distance
 * @param {number}  [opts.tWindowStart=0.30]         Only search this t-range …
 * @param {number}  [opts.tWindowEnd=0.65]           … to skip HEO and return legs
 * @returns {{ ok: boolean, t: number, distance: number, message: string }}
 */
export function validateMoonAlignment(curve, moonPosition, opts = {}) {
    const N        = opts.samples            ?? 2000;
    const maxDist  = opts.maxApproachDistance ?? 8;
    const t0       = opts.tWindowStart        ?? 0.30;
    const t1       = opts.tWindowEnd          ?? 0.65;

    let minDist = Infinity;
    let bestT   = t0;
    const tmp   = new THREE.Vector3();

    for (let i = 0; i <= N; i++) {
        const t = t0 + (i / N) * (t1 - t0);
        curve.getPoint(t, tmp);
        const d = tmp.distanceTo(moonPosition);
        if (d < minDist) { minDist = d; bestT = t; }
    }

    const ok = minDist <= maxDist;
    return {
        ok,
        t       : bestT,
        distance: minDist,
        message : ok
            ? `Moon aligned ✓  closest-approach ${minDist.toFixed(2)} units at t=${bestT.toFixed(3)}`
            : `Moon NOT in corridor ✗  closest-approach ${minDist.toFixed(2)} units at t=${bestT.toFixed(3)} (limit ${maxDist})`
    };
}
