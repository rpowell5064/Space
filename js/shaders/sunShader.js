import * as THREE from 'https://esm.sh/three@0.160.0';

export const SUN_VERT = `
    varying vec3 vWorldNormal;
    varying vec3 vViewNormal;
    varying vec3 vViewDir;
    void main() {
        vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vViewNormal  = normalize(normalMatrix * normal);
        vec4 vp      = modelViewMatrix * vec4(position, 1.0);
        vViewDir     = normalize(-vp.xyz);
        gl_Position  = projectionMatrix * vp;
    }
`;

export const SUN_FRAG = `
    uniform float time;
    uniform float pulse;
    varying vec3  vWorldNormal;
    varying vec3  vViewNormal;
    varying vec3  vViewDir;

    // ── Hash / value noise ────────────────────────────────────────────────
    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float hash3(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
    }
    float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i),               hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
        for (int i = 0; i < 6; i++) { v += a * vnoise(p); p = rot * p * 2.1; a *= 0.48; }
        return v;
    }

    // ── Cell (Voronoi-style) noise for granulation ────────────────────────
    // Returns distance to nearest cell centre → 0 at centre, 1 at edges
    float cellNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float minD = 8.0;
        for (int dy = -1; dy <= 1; dy++) {
            for (int dx = -1; dx <= 1; dx++) {
                vec2 n  = vec2(float(dx), float(dy));
                vec2 jt = vec2(hash(i + n), hash(i + n + vec2(31.7, 57.3)));
                float d = length(f - n - jt);
                minD = min(minD, d);
            }
        }
        return clamp(minD, 0.0, 1.0);
    }

    // ── Axis-rotation helpers ─────────────────────────────────────────────
    vec3 rotY(vec3 v, float a) {
        float s = sin(a), c = cos(a);
        return vec3(c*v.x + s*v.z, v.y, -s*v.x + c*v.z);
    }
    vec3 rotX(vec3 v, float a) {
        float s = sin(a), c = cos(a);
        return vec3(v.x, c*v.y - s*v.z, s*v.y + c*v.z);
    }

    // ── Sunspot: returns cooling factor 0–1 at each surface point ─────────
    float sunspotCool(vec3 n) {
        float cool = 0.0;
        // 6 slowly-drifting sunspot groups spread over the disk
        for (int i = 0; i < 6; i++) {
            float fi   = float(i);
            // Constrain spots to ±30° latitude (sin roughly ±0.5)
            float lat  = sin(fi * 2.39 + 0.4) * 0.45;
            float lon  = fi * 1.0472 + time * (0.004 + fi * 0.0007);
            vec3 spot  = vec3(cos(lat)*cos(lon), sin(lat), cos(lat)*sin(lon));
            float d    = distance(n, spot);
            // Umbra (very dark) + penumbra (medium dark)
            float umbra    = 1.0 - smoothstep(0.0,  0.06, d);
            float penumbra = 1.0 - smoothstep(0.06, 0.12, d);
            cool = max(cool, umbra * 0.70 + penumbra * 0.25);
        }
        return cool;
    }

    // ── Photosphere color ramp ─────────────────────────────────────────────
    // From cool plasma (deep red) through vivid red to yellow-white hot cells
    vec3 sunColor(float b) {
        b = clamp(b, 0.0, 1.0);
        vec3 cool   = vec3(0.42, 0.02, 0.00);  // deep crimson — sunspot interior
        vec3 low    = vec3(0.55, 0.04, 0.00);  // dark red — intergranular lanes
        vec3 mid    = vec3(0.88, 0.18, 0.01);  // vivid orange-red — mid photosphere
        vec3 hot    = vec3(1.00, 0.78, 0.15);  // yellow-white — hot cell centre
        vec3 bright = vec3(1.00, 0.95, 0.60);  // near-white — plasma peak

        vec3 c = mix(cool, low,    smoothstep(0.00, 0.30, b));
             c = mix(c,    mid,    smoothstep(0.25, 0.60, b));
             c = mix(c,    hot,    smoothstep(0.55, 0.82, b));
             c = mix(c,    bright, smoothstep(0.80, 1.00, b));
        return c;
    }

    void main() {
        float t = time * 0.04;

        // ── Base plasma via 3 offset FBM layers (large-scale convection) ──
        vec3 d1 = rotY(vWorldNormal, t * 0.60);
        vec3 d2 = rotY(rotX(vWorldNormal, t * 0.40 + 1.0), t * 0.50 + 2.094);
        vec3 d3 = rotX(rotY(vWorldNormal, t * 0.35 - 2.0), t * 0.38 + 4.188);

        float s  = 4.2;
        float b1 = fbm(d1.xy * s + fbm(d1.xy * s * 0.5) * 0.06);
        float b2 = fbm(d2.yz * s + fbm(d2.yz * s * 0.5) * 0.06);
        float b3 = fbm(d3.xz * s + fbm(d3.xz * s * 0.5) * 0.06);
        float heat = clamp((b1 + b2 + b3) / 3.0 * 1.20 + 0.30, 0.0, 1.0);

        // ── Granulation cells (convection tops = bright, edges = dark) ────
        // Two scales: supergranulation + granules
        vec3 dg1 = rotY(vWorldNormal, t * 1.80);
        vec3 dg2 = rotX(vWorldNormal, t * 1.40 + 1.0);
        // Supergranules (large, slow)
        float sg  = cellNoise(dg1.xy * 6.0);          // 0 = cell centre (hot)
        float gran1 = (1.0 - sg) * 0.18;               // bright at centre
        // Granules (small, fast)
        float g   = cellNoise(dg2.xz * 18.0 + fbm(dg2.xy * 8.0) * 0.3);
        float gran2 = (1.0 - g) * 0.10;
        heat = clamp(heat + gran1 + gran2, 0.0, 1.0);

        // ── Sunspots — cool dark regions ───────────────────────────────────
        float spot = sunspotCool(vWorldNormal);
        // Faculae: bright rims around spots (hotter plasma welling up beside umbra)
        float spotEdge = smoothstep(0.10, 0.16, spot) * (1.0 - smoothstep(0.16, 0.24, spot));
        heat = clamp(heat - spot * 0.65 + spotEdge * 0.15, 0.0, 1.0);

        // ── Colour + limb darkening ────────────────────────────────────────
        vec3 col = sunColor(heat);
        float mu   = max(0.0, dot(vViewNormal, vViewDir));
        // Standard Eddington limb-darkening: I = I0(0.40 + 0.60 mu)
        float limb = 0.40 + 0.60 * pow(mu, 0.38);
        col *= limb;

        // ── Chromosphere — thin reddish/pinkish glow at the very limb ─────
        float limbEdge = pow(1.0 - mu, 5.0);
        col += vec3(0.80, 0.15, 0.08) * limbEdge * 0.45;

        // ── Active-region hot spots (faint brightening in facular areas) ───
        vec3 da  = rotY(vWorldNormal, t * 0.9);
        float ar = fbm(da.yz * 3.0);
        col += vec3(0.4, 0.2, 0.0) * smoothstep(0.72, 0.88, ar) * 0.10;

        col *= 2.2 * pulse;
        gl_FragColor = vec4(col, 1.0);
    }
`;

export function createSunMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, pulse: { value: 1.0 } },
        vertexShader:   SUN_VERT,
        fragmentShader: SUN_FRAG,
    });
}

export function createAtmosphereMaterial(color) {
    return new THREE.ShaderMaterial({
        uniforms: { glowColor: { value: new THREE.Color(color) } },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vViewDir;
            void main() {
                vNormal  = normalize(normalMatrix * normal);
                vec4 vp  = modelViewMatrix * vec4(position, 1.0);
                vViewDir = normalize(-vp.xyz);
                gl_Position = projectionMatrix * vp;
            }
        `,
        fragmentShader: `
            uniform vec3 glowColor;
            varying vec3 vNormal;
            varying vec3 vViewDir;
            void main() {
                float i = pow(max(0.0, 1.0 - dot(vNormal, vViewDir)), 3.0);
                gl_FragColor = vec4(glowColor, i * 0.8);
            }
        `,
        transparent: true,
        blending:    THREE.AdditiveBlending,
        depthWrite:  false,
        side:        THREE.FrontSide,
    });
}
