// Pure math — no imports

/**
 * Compute ellipse parameters from semi-major axis and eccentricity.
 * @param {number} distance - semi-major axis
 * @param {number} eccentricity
 * @returns {{ a: number, b: number, fc: number }}
 */
export function ellipseParams(distance, eccentricity) {
    const e = eccentricity || 0;
    const a = distance;
    const b = a * Math.sqrt(1 - e * e);
    const fc = a * e;
    return { a, b, fc };
}

/**
 * Compute the x/z position on an ellipse at a given angle.
 * Sun is at one focus (offset by fc along x).
 * @param {number} angle - current orbital angle in radians
 * @param {number} a - semi-major axis
 * @param {number} b - semi-minor axis
 * @param {number} fc - focal offset
 * @returns {{ x: number, z: number }}
 */
export function ellipsePosition(angle, a, b, fc) {
    return {
        x: fc + a * Math.cos(angle),
        z: b  * Math.sin(angle)
    };
}
