import * as THREE from 'https://esm.sh/three@0.160.0';
import { EffectComposer } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }     from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass }     from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js';

// Sun is always at world origin
const _sunWorld = new THREE.Vector3(0, 0, 0);

// ── Heat distortion ───────────────────────────────────────────────────────────
// Radially warps UV around the projected sun position. Falloff is cubic so
// distortion is concentrated near the disc and fades to zero outside `radius`.
const HeatShader = {
    uniforms: {
        tDiffuse:  { value: null },
        time:      { value: 0.0 },
        sunScreen: { value: new THREE.Vector2(0.5, 0.5) },
        aspect:    { value: 1.0 },
        strength:  { value: 0.004 },
        radius:    { value: 0.20 },
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float     time;
        uniform vec2      sunScreen;
        uniform float     aspect;
        uniform float     strength;
        uniform float     radius;
        varying vec2      vUv;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(
                mix(hash(i),               hash(i + vec2(1.0, 0.0)), f.x),
                mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), f.x), f.y
            );
        }

        void main() {
            vec2 uv   = vUv;
            vec2 d    = (uv - sunScreen) * vec2(aspect, 1.0);
            float dist = length(d);
            float fall = clamp(1.0 - dist / radius, 0.0, 1.0);
            fall = fall * fall * fall;

            if (fall > 0.001) {
                float n1 = vnoise(uv * 6.0  + vec2( time * 0.55,  time * 0.30));
                float n2 = vnoise(uv * 13.0 - vec2( time * 0.38,  time * 0.65));
                float n3 = vnoise(uv * 6.0  + vec2(-time * 0.42,  time * 0.50));
                float n4 = vnoise(uv * 13.0 + vec2( time * 0.60, -time * 0.35));
                vec2 offset = vec2(n1 * 0.6 + n2 * 0.4, n3 * 0.6 + n4 * 0.4) - 0.5;
                uv += offset * strength * fall;
            }

            gl_FragColor = texture2D(tDiffuse, clamp(uv, 0.001, 0.999));
        }
    `
};

// ── Film grain ────────────────────────────────────────────────────────────────
// Adds per-frame noise to break the "too clean CG" look. The noise is temporally
// uncorrelated (seeded by time) so it reads as film grain rather than pattern noise.
// Amount 0.018 is deliberately subtle — below conscious threshold but adds texture
// that the viewer would miss if removed.
const FilmGrainShader = {
    uniforms: {
        tDiffuse: { value: null },
        time:     { value: 0.0 },
        amount:   { value: 0.018 },
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float time;
        uniform float amount;
        varying vec2 vUv;
        float rand(vec2 co) {
            return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453 + time * 0.001);
        }
        void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            float grain = (rand(vUv * 1000.0) - 0.5) * amount;
            gl_FragColor = vec4(clamp(texel.rgb + grain, 0.0, 1.0), texel.a);
        }
    `
};

// ── Vignette ──────────────────────────────────────────────────────────────────
// Classic photographic vignette: darkens corners to draw the eye inward.
// darkness > 1 deepens the corners; offset < 1 expands the dark region toward centre.
const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        darkness: { value: 1.05 },
        offset:   { value: 0.92 },
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float darkness;
        uniform float offset;
        varying vec2 vUv;
        void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            vec2 uv    = (vUv - 0.5) * 2.0;
            // Smooth quartic falloff — softer than the quadratic default
            float d    = dot(uv * 0.5, uv * 0.5);
            float v    = clamp(offset - d * d * darkness, 0.0, 1.0);
            gl_FragColor = vec4(texel.rgb * v, texel.a);
        }
    `
};

// ── Chromatic aberration ──────────────────────────────────────────────────────
// Splits RGB channels radially outward from the image centre, simulating a
// real lens's inability to focus all wavelengths at the same point.
// Kept very subtle (amount ≈ 0.001) so it reads as film quality, not a glitch.
const ChromaticAberrationShader = {
    uniforms: {
        tDiffuse: { value: null },
        amount:   { value: 0.0010 },
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float amount;
        varying vec2 vUv;
        void main() {
            vec2 dir    = vUv - 0.5;
            float dist  = length(dir);
            // Quadratic: strongest at the very corners, zero at centre
            vec2 offset = normalize(dir + vec2(0.0001)) * amount * dist * dist;
            float r = texture2D(tDiffuse, clamp(vUv + offset,       0.001, 0.999)).r;
            float g = texture2D(tDiffuse, clamp(vUv,               0.001, 0.999)).g;
            float b = texture2D(tDiffuse, clamp(vUv - offset,       0.001, 0.999)).b;
            gl_FragColor = vec4(r, g, b, 1.0);
        }
    `
};

// ── Public factory ────────────────────────────────────────────────────────────
export function createPostProcessing(renderer, scene, camera) {
    // HDR render target so bloom operates on genuine overbright values
    // (sun shader outputs up to ~2.4× luminance, which clears the threshold cleanly)
    const w = renderer.domElement.width;
    const h = renderer.domElement.height;

    const hdrTarget = new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format:    THREE.RGBAFormat,
        type:      THREE.HalfFloatType,
    });

    const composer = new EffectComposer(renderer, hdrTarget);
    composer.setPixelRatio(renderer.getPixelRatio());

    // 1 — Render the scene into the HDR buffer
    composer.addPass(new RenderPass(scene, camera));

    // 2 — Bloom
    //   threshold 1.0  → only genuinely HDR pixels (sun surface, additive sprites)
    //   strength  0.5  → subtle accent; sun corona comes from custom sprites, not bloom
    //   radius    0.15 → tight spread avoids the blocky mip-pyramid artifact of high radii
    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(w, h),
        0.5,   // strength
        0.15,  // radius
        1.0    // luminance threshold
    );
    composer.addPass(bloomPass);

    // 3 — Heat distortion (sub-pixel shimmer around the sun disc)
    const heatPass = new ShaderPass(HeatShader);
    composer.addPass(heatPass);

    // 4 — Chromatic aberration (lens realism, very subtle)
    const chromaPass = new ShaderPass(ChromaticAberrationShader);
    composer.addPass(chromaPass);

    // 5 — Film grain (sub-conscious texture; breaks the "too clean" CG look)
    const grainPass = new ShaderPass(FilmGrainShader);
    composer.addPass(grainPass);

    // 6 — Vignette — renders to screen
    const vignettePass = new ShaderPass(VignetteShader);
    vignettePass.renderToScreen = true;
    composer.addPass(vignettePass);

    // ── Public API ────────────────────────────────────────────────────────────
    const effect = {
        composer,
        bloomPass,
        heatPass,

        setSize(w, h) {
            composer.setSize(w, h);
            hdrTarget.setSize(w, h);
            heatPass.uniforms.aspect.value = w / h;
            bloomPass.resolution.set(w, h);
        },

        // Auto-exposure: camera adapts to sun distance like a real eye/sensor.
        // Near the sun (or zoomed on a bright planet) exposure is lower = brighter.
        // Pulling back toward Neptune raises exposure = scene stays legible in dim light.
        // SUN_RADIUS ≈ 25; Neptune at 3007; lerp produces 1.0 → 2.2 over that range.
        updateExposure(renderer, camDistFromSun, delta) {
            const t = THREE.MathUtils.clamp((camDistFromSun - 30) / 2980, 0.0, 1.0);
            const targetExposure = 1.6 + t * t * 0.6; // 1.6 near sun, ~2.2 near Neptune
            renderer.toneMappingExposure = THREE.MathUtils.lerp(
                renderer.toneMappingExposure,
                targetExposure,
                Math.min(1.0, delta * 0.4) // smooth easing, ~2.5 s time constant
            );
        },

        // Drop-in replacement for old heatDistortion.render(elapsed)
        render(elapsed) {
            const sc = _sunWorld.clone().project(camera);
            heatPass.uniforms.sunScreen.value.set(
                (sc.x + 1.0) * 0.5,
                (sc.y + 1.0) * 0.5
            );
            heatPass.uniforms.time.value  = elapsed;
            grainPass.uniforms.time.value = elapsed;
            composer.render();
        }
    };

    effect.setSize(w, h);
    return effect;
}
