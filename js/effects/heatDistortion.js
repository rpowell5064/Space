import * as THREE from 'https://esm.sh/three@0.160.0';
import { EffectComposer } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }     from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass }     from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/ShaderPass.js';

const _sunWorld = new THREE.Vector3(0, 0, 0);

const HeatShader = {
    uniforms: {
        tDiffuse:  { value: null },
        time:      { value: 0.0 },
        sunScreen: { value: new THREE.Vector2(0.5, 0.5) },
        aspect:    { value: 1.0 },
        // strength: max UV offset per-pixel at the sun centre
        strength:  { value: 0.004 },
        // radius: screen-height fraction over which heat falls off
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

        // Value noise helpers
        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float vnoise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(
                mix(hash(i),              hash(i + vec2(1.0, 0.0)), f.x),
                mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
                f.y
            );
        }

        void main() {
            vec2 uv = vUv;

            // Aspect-corrected distance from sun centre
            vec2  d    = (uv - sunScreen) * vec2(aspect, 1.0);
            float dist = length(d);

            // Cubic falloff: full distortion at sun centre, zero at radius
            float fall = clamp(1.0 - dist / radius, 0.0, 1.0);
            fall = fall * fall * fall;

            if (fall > 0.001) {
                // Two octaves of animated noise for the shimmer
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

export function createHeatDistortion(renderer, scene, camera) {
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.addPass(new RenderPass(scene, camera));

    const heatPass = new ShaderPass(HeatShader);
    composer.addPass(heatPass);

    const effect = {
        composer,

        setSize(w, h) {
            composer.setSize(w, h);
            heatPass.uniforms.aspect.value = w / h;
        },

        render(elapsed) {
            // Project sun world origin → UV space each frame (camera can orbit)
            const sc = _sunWorld.clone().project(camera);
            heatPass.uniforms.sunScreen.value.set(
                (sc.x + 1.0) * 0.5,
                (sc.y + 1.0) * 0.5
            );
            heatPass.uniforms.time.value = elapsed;
            composer.render();
        }
    };

    // Initialise aspect to current viewport
    effect.setSize(renderer.domElement.width, renderer.domElement.height);
    return effect;
}
