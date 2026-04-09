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

export function createAtmosphereMaterial(color, power = 3.0, maxOpacity = 0.8) {
    return new THREE.ShaderMaterial({
        uniforms: {
            glowColor:  { value: new THREE.Color(color) },
            atmPower:   { value: power },
            atmOpacity: { value: maxOpacity },
        },
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
            uniform vec3  glowColor;
            uniform float atmPower;
            uniform float atmOpacity;
            varying vec3 vNormal;
            varying vec3 vViewDir;
            void main() {
                float i = pow(max(0.0, 1.0 - dot(vNormal, vViewDir)), atmPower);
                gl_FragColor = vec4(glowColor, i * atmOpacity);
            }
        `,
        transparent: true,
        blending:    THREE.AdditiveBlending,
        depthWrite:  false,
        side:        THREE.FrontSide,
    });
}

// ── Earth cloud shader ────────────────────────────────────────────────────────
// Domain-warped FBM generates fractal cloud shapes with realistic wispy edges.
// Sun direction is computed per-fragment from world position (sun at origin).
const CLOUD_VERT = `
    varying vec2 vUv;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPos;
    void main() {
        vUv         = uv;
        vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vWorldPos    = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const CLOUD_FRAG = `
    uniform float time;
    varying vec2  vUv;
    varying vec3  vWorldNormal;
    varying vec3  vWorldPos;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);
    }
    float fbm5(vec2 p) {
        float v=0.0, a=0.5;
        mat2 rot=mat2(0.80,0.60,-0.60,0.80);
        for(int i=0;i<5;i++){v+=a*vnoise(p);p=rot*p*2.1;a*=0.48;}
        return v;
    }
    float fbm7(vec2 p) {
        float v=0.0, a=0.5;
        mat2 rot=mat2(0.80,0.60,-0.60,0.80);
        for(int i=0;i<7;i++){v+=a*vnoise(p);p=rot*p*2.1;a*=0.48;}
        return v;
    }

    void main() {
        vec2  uv  = vUv;
        float t   = time * 0.007;
        float lat = abs(uv.y * 2.0 - 1.0); // 0=equator, 1=pole

        // ── Domain warp — two passes, each CENTERED around 0 ─────────────
        // FBM output is ~[0, 0.95] with mean ~0.47.  Subtracting 0.47 gives
        // a warp field that displaces ± equally rather than only positively.
        vec2 q = vec2(
            fbm5(uv * 2.5 + vec2(t * 0.55, 0.0))        - 0.47,
            fbm5(uv * 2.5 + vec2(1.7, 9.2+t * 0.40))    - 0.47
        );
        vec2 r = vec2(
            fbm5((uv + q * 0.50) * 3.8 + vec2(t*0.32, 3.2)) - 0.47,
            fbm5((uv + q * 0.50) * 3.8 + vec2(8.3, t*0.25)) - 0.47
        );
        vec2 wuv = uv + q * 0.45 + r * 0.22;

        // ── Cloud density ─────────────────────────────────────────────────
        float d1 = fbm7(wuv * 3.2 + vec2(t * 0.12, 0.0));
        float d2 = fbm5(wuv * 6.0 + vec2(t * 0.20, t * 0.07) + vec2(3.1, 5.4));
        // FBM mean ≈ 0.47; this density also has mean ≈ 0.47
        float density = d1 * 0.70 + d2 * 0.30;

        // ── Latitude shaping ─────────────────────────────────────────────
        // Subtropics (20–40°) are Earth's dry zones — thin cloud cover
        float dryBelt = smoothstep(0.18,0.35,lat) * (1.0-smoothstep(0.35,0.58,lat)) * 0.06;
        density -= dryBelt;

        // ── Threshold — mean ≈ 0.47, start below it for ~60% coverage ────
        float cloud = smoothstep(0.40, 0.55, density);

        // Polar cloud decks poleward of ~65° (Southern Ocean, Arctic)
        float poleBlend = smoothstep(0.62, 0.92, lat);
        float poleFbm   = fbm5(uv * 4.5 + vec2(t * 0.04, 0.0));
        cloud = max(cloud, poleBlend * smoothstep(0.34, 0.50, poleFbm) * 0.88);

        // ITCZ: extra convective towers in deep tropics (±12°)
        float itczBoost = smoothstep(0.28, 0.0, lat) * 0.10;
        cloud = clamp(cloud + itczBoost, 0.0, 1.0);

        // Discard fully transparent fragments AFTER all cloud sources are added
        if(cloud < 0.004) discard;

        // ── Sun lighting ─────────────────────────────────────────────────
        // Sun is at world origin; vWorldPos is fragment's world position
        vec3  sunDir  = normalize(-vWorldPos);
        float ndotl   = dot(vWorldNormal, sunDir);
        // Soft terminator: 25° transition zone (~300 km deep in reality)
        float sunLight = smoothstep(-0.10, 0.25, ndotl);

        vec3 dayColor   = vec3(0.96, 0.97, 1.00);
        vec3 nightColor = vec3(0.03, 0.04, 0.06);
        vec3 cloudColor = mix(nightColor, dayColor, sunLight);
        // Thicker clouds slightly darker underneath (self-shadowing)
        cloudColor *= 0.86 + cloud * 0.16;

        // ── Alpha ─────────────────────────────────────────────────────────
        float alpha = cloud * 0.92;

        gl_FragColor = vec4(cloudColor, alpha);
    }
`;

export function createEarthCloudMaterial() {
    return new THREE.ShaderMaterial({
        uniforms:       { time: { value: 0.0 } },
        vertexShader:   CLOUD_VERT,
        fragmentShader: CLOUD_FRAG,
        transparent:    true,
        depthWrite:     false,
        side:           THREE.FrontSide,
    });
}

// ── Jupiter animated overlay ──────────────────────────────────────────────────
// Three-layer differential rotation + animated Great Red Spot vortex
const JUPITER_OVERLAY_VERT = `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    void main() {
        vUv = uv;
        vNormal  = normalize(normalMatrix * normal);
        vec4 vp  = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-vp.xyz);
        gl_Position = projectionMatrix * vp;
    }
`;

const JUPITER_OVERLAY_FRAG = `
    uniform float time;
    varying vec2  vUv;
    varying vec3  vNormal;
    varying vec3  vViewDir;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);
    }
    float fbm(vec2 p) {
        float v=0.0, a=0.5;
        for(int i=0;i<4;i++){v+=a*vnoise(p);p=p*2.1+vec2(1.7,9.2);a*=0.5;}
        return v;
    }

    void main() {
        float u   = vUv.x;
        float v   = vUv.y;
        float lat = v * 2.0 - 1.0; // -1(S)…+1(N)

        // ── Layer 1: equatorial jet — fastest eastward drift ──────────────
        float eq    = smoothstep(0.28, 0.0, abs(lat));
        float drift1 = time * 0.011 * eq;

        // ── Layer 2: tropical belts — moderate, direction flips N↔S ──────
        float trop   = smoothstep(0.55, 0.22, abs(lat)) * smoothstep(0.08, 0.28, abs(lat));
        float drift2 = time * 0.006 * sign(lat) * trop;

        // ── Layer 3: temperate/polar — subtle counter-drift ───────────────
        float polar  = smoothstep(0.45, 0.68, abs(lat));
        float drift3 = -time * 0.004 * polar;

        float uDrift = drift1 + drift2 + drift3;

        // Band-boundary turbulence (spikes between belts and zones)
        float bandBnd = pow(abs(sin(lat * 3.14159 * 6.0)), 4.0);

        vec2 uv1 = vec2(fract(u + uDrift),          v);
        vec2 uv2 = vec2(fract(u + uDrift*0.6 + 0.3), v);
        vec2 uv3 = vec2(fract(u + uDrift*1.4 + 0.7), v);

        float t1 = fbm(uv1 * vec2(6.0, 24.0));
        float t2 = fbm(uv2 * vec2(8.0, 20.0) + vec2(3.5, 1.8));
        float t3 = fbm(uv3 * vec2(10.0, 30.0) + vec2(7.1, 4.3));

        float turb = (t1*0.5 + t2*0.3 + t3*0.2) * bandBnd;
        vec3  turbColor = mix(vec3(0.88,0.72,0.48), vec3(0.98,0.90,0.70), t1);
        float turbAlpha = turb * 0.22;

        // ── Great Red Spot — 25°S, slow westward drift ────────────────────
        float grsU = fract(0.62 - time * 0.0006);
        float grsV = 0.375;
        float du   = u - grsU;
        if(du > 0.5) du -= 1.0; if(du < -0.5) du += 1.0;
        float dv   = v - grsV;
        // Elliptical shape (wider longitude-wise)
        float grsR = sqrt((du/0.082)*(du/0.082) + (dv/0.042)*(dv/0.042));

        vec3  grsColor = vec3(0.0);
        float grsAlpha = 0.0;

        if(grsR < 2.2) {
            // Anti-clockwise rotation (southern anticyclone)
            float angle = atan(dv/0.042, du/0.082) + time * 0.22;
            float swirl = fbm(vec2(cos(angle), sin(angle)) * 2.0 + grsR * 0.5);
            float rings = sin(grsR * 10.0 - time * 0.3) * 0.5 + 0.5;

            vec3 grsCore  = vec3(0.72, 0.18, 0.08);
            vec3 grsMid   = vec3(0.88, 0.40, 0.18);
            vec3 grsEdge  = vec3(0.92, 0.66, 0.38);

            grsColor  = mix(grsCore, grsMid,  smoothstep(0.0, 0.6, grsR));
            grsColor  = mix(grsColor, grsEdge, smoothstep(0.6, 1.4, grsR));
            grsColor += swirl * 0.08 * vec3(0.30, 0.10, 0.00);
            grsColor += rings  * 0.04 * vec3(1.00, 0.60, 0.30);
            grsColor  = clamp(grsColor, 0.0, 1.0);
            grsAlpha  = smoothstep(2.2, 0.25, grsR) * 0.94;
        }

        // ── Oval BA — smaller red spot ~33°S, 180° from GRS ──────────────
        float obaU = fract(grsU + 0.50);
        float obaV = 0.335;
        float dou  = u - obaU; if(dou>0.5) dou-=1.0; if(dou<-0.5) dou+=1.0;
        float dov  = v - obaV;
        float obaR = sqrt((dou/0.038)*(dou/0.038) + (dov/0.020)*(dov/0.020));
        float obaAlpha = smoothstep(1.5, 0.2, obaR) * 0.52;
        float obaAngle = atan(dov/0.020, dou/0.038) + time * 0.28;
        float obaSwirl = fbm(vec2(cos(obaAngle), sin(obaAngle)) * 1.5 + obaR * 0.5);
        vec3  obaColor = mix(vec3(0.85,0.50,0.28), vec3(0.78,0.28,0.12), obaR / 1.5);
        obaColor += obaSwirl * 0.08 * vec3(0.2, 0.05, 0.0);

        // ── Compose ───────────────────────────────────────────────────────
        vec3  col   = turbColor;
        float alpha = turbAlpha;

        col   = mix(col, obaColor, obaAlpha);
        alpha = max(alpha, obaAlpha);
        col   = mix(col, grsColor, grsAlpha);
        alpha = max(alpha, grsAlpha);

        gl_FragColor = vec4(col, alpha);
    }
`;

export function createJupiterOverlayMaterial() {
    return new THREE.ShaderMaterial({
        uniforms:       { time: { value: 0.0 } },
        vertexShader:   JUPITER_OVERLAY_VERT,
        fragmentShader: JUPITER_OVERLAY_FRAG,
        transparent:    true,
        depthWrite:     false,
        side:           THREE.FrontSide,
    });
}
