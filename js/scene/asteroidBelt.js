import * as THREE from 'https://esm.sh/three@0.160.0';

// Module-level state
let asteroidMesh = null;
let asteroidOrbitData = null;
let asteroidSpriteGroup = null;
let _scene = null;

export async function createAsteroidBelt(scene) {
    _scene = scene;

    const loader = new THREE.TextureLoader();

    // Load textures internally
    const rockNormalTexture = await new Promise((resolve, reject) => {
        loader.load(
            './textures/asteroid_normal.png',
            (tex) => {
                tex.colorSpace = THREE.NoColorSpace;
                resolve(tex);
            },
            undefined,
            (err) => {
                console.error("NORMAL MAP FAILED", err);
                resolve(null);
            }
        );
    });

    const asteroidSpriteTexture = await new Promise((resolve, reject) => {
        loader.load(
            './textures/asteroid_sprite.png',
            (tex) => {
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.needsUpdate = true;
                resolve(tex);
            },
            undefined,
            (err) => {
                console.error("SPRITE FAILED", err);
                resolve(null);
            }
        );
    });

    _buildBelt(scene, rockNormalTexture, asteroidSpriteTexture);
}

function _buildBelt(scene, rockNormalTexture, asteroidSpriteTexture) {
    // Geometry with procedural displacement
    const rockGeo = new THREE.IcosahedronGeometry(1, 1);
    const pos = rockGeo.attributes.position;
    const v = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);

        const n =
            Math.sin(v.x * 3.1) *
            Math.sin(v.y * 2.7) *
            Math.sin(v.z * 3.7);

        const displacement = 0.18 * n;
        v.addScaledVector(v.clone().normalize(), displacement);

        pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    rockGeo.computeVertexNormals();

    // Material with normal map — high normalScale for dramatic surface detail
    const matOptions = {
        roughness: 0.82,
        metalness: 0.04,
        flatShading: false,
    };
    if (rockNormalTexture) {
        matOptions.normalMap = rockNormalTexture;
        matOptions.normalScale = new THREE.Vector2(4.5, 4.5);
    }
    const rockMat = new THREE.MeshStandardMaterial(matOptions);

    const count = 3500;
    const mesh = new THREE.InstancedMesh(rockGeo, rockMat, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; // instances span 220–340 units; don't cull by unit-sphere at origin

    mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(count * 3),
        3
    );
    mesh.instanceColor.needsUpdate = true;

    scene.add(mesh);
    asteroidMesh = mesh;

    // Small fill light so asteroids aren't pitch black on their dark sides
    if (!scene.__asteroidAmbient) {
        const amb = new THREE.AmbientLight(0xffffff, 0.10);
        scene.add(amb);
        scene.__asteroidAmbient = amb;
    }

    // Sprite LOD group
    asteroidSpriteGroup = new THREE.Group();
    scene.add(asteroidSpriteGroup);

    // Procedural soft-circle sprite — avoids white-square artifact from opaque PNG
    const sprC = document.createElement('canvas');
    sprC.width = 64; sprC.height = 64;
    const sprCtx = sprC.getContext('2d');
    const sprGrad = sprCtx.createRadialGradient(32, 32, 0, 32, 32, 28);
    sprGrad.addColorStop(0.0,  'rgba(195, 178, 155, 1.0)');
    sprGrad.addColorStop(0.45, 'rgba(155, 138, 115, 0.75)');
    sprGrad.addColorStop(0.80, 'rgba(110, 98,  82,  0.35)');
    sprGrad.addColorStop(1.0,  'rgba(70,  62,  52,  0.0)');
    sprCtx.fillStyle = sprGrad;
    sprCtx.fillRect(0, 0, 64, 64);
    const sprTex = new THREE.CanvasTexture(sprC);

    const spriteMat = new THREE.SpriteMaterial({
        map: sprTex,
        transparent: true,
        depthWrite: false,
    });

    // Kirkwood gaps at real AU resonance positions (×100 scale)
    // 4:1 @ 2.50 AU, 3:1 @ 2.82 AU, 5:2 @ 2.95 AU, 2:1 @ 3.27 AU
    const gaps = [
        [248, 254],
        [279, 285],
        [292, 298],
        [324, 330],
    ];

    function inGap(r) {
        return gaps.some(([lo, hi]) => r >= lo && r <= hi);
    }

    function triRand() { return Math.random() + Math.random(); }

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    asteroidOrbitData = [];

    let i = 0;
    let attempts = 0;

    while (i < count && attempts < count * 12) {
        attempts++;

        // 2.2–3.4 AU range with triangular distribution peaked at 2.8 AU
        const r = 220 + triRand() * 60;
        if (inGap(r) && Math.random() < 0.92) continue;

        const ecc = (Math.random() - 0.5) * 5;
        const incl = (triRand() - 1) * 10;
        const angle = Math.random() * Math.PI * 2;

        const x = (r + ecc) * Math.cos(angle);
        const y = incl;
        const z = (r + ecc) * Math.sin(angle);

        dummy.position.set(x, y, z);

        const rx = Math.random() * Math.PI;
        const ry = Math.random() * Math.PI;
        const rz = Math.random() * Math.PI;
        dummy.rotation.set(rx, ry, rz);

        const s = 0.05 + Math.random() * 0.20;
        dummy.scale.set(s, s, s);

        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);

        // Color variation
        const t = Math.random();
        if (t < 0.75) {
            color.setRGB(0.32 + Math.random() * 0.10, 0.30 + Math.random() * 0.08, 0.28 + Math.random() * 0.06);
        } else if (t < 0.92) {
            color.setRGB(0.45 + Math.random() * 0.15, 0.40 + Math.random() * 0.12, 0.36 + Math.random() * 0.10);
        } else {
            color.setRGB(0.65 + Math.random() * 0.15, 0.62 + Math.random() * 0.12, 0.60 + Math.random() * 0.10);
        }
        mesh.instanceColor.setXYZ(i, color.r, color.g, color.b);

        // Tumbling
        const tumbleAxis = new THREE.Vector3(
            Math.random() * 2 - 1,
            Math.random() * 2 - 1,
            Math.random() * 2 - 1
        ).normalize();

        // tumbleSpeed in rad/frame (no delta) — visibly spinning
        const tumbleSpeed = 0.004 + Math.random() * 0.010;
        const tumbleAngle = Math.random() * Math.PI * 2;

        asteroidOrbitData.push({
            radius: r + ecc,
            angle,
            // orbital speed in rad/frame — between Mars (0.0000532) and Jupiter (0.00000843)
            speed: 0.000010 + Math.random() * 0.000012,
            incl,
            s,
            tumbleAxis,
            tumbleSpeed,
            tumbleAngle,
            sprite: null,
            spriteMat
        });

        i++;
    }

    mesh.instanceColor.needsUpdate = true;
    mesh.instanceMatrix.needsUpdate = true;
}

export function updateAsteroids(cameraPosition) {
    if (!asteroidMesh || !asteroidOrbitData) return;

    const mesh = asteroidMesh;
    const orbitData = asteroidOrbitData;
    const dummy = new THREE.Object3D();
    const camPos = cameraPosition;

    // LOD thresholds — 3D rocks within 400 units, sprites beyond 700
    const nearCut = 400 * 400;
    const farCut  = 700 * 700;

    for (let i = 0; i < orbitData.length; i++) {
        const o = orbitData[i];

        o.angle += o.speed;  // rad/frame, consistent with planet orbit system

        const x = o.radius * Math.cos(o.angle);
        const z = o.radius * Math.sin(o.angle);
        const y = o.incl;

        const dist2 = camPos.distanceToSquared(new THREE.Vector3(x, y, z));

        // FAR -> SPRITE
        if (dist2 > farCut) {
            if (!o.sprite) {
                o.sprite = new THREE.Sprite(o.spriteMat);
                asteroidSpriteGroup.add(o.sprite);
            }

            o.sprite.visible = true;
            o.sprite.position.set(x, y, z);

            // Guaranteed visibility
            o.sprite.scale.set(o.s * 20, o.s * 20, 1);

            // Hide instanced mesh
            dummy.position.set(0, -99999, 0);
            dummy.scale.set(0, 0, 0);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
            continue;
        }

        // NEAR -> 3D ROCK
        if (o.sprite) o.sprite.visible = false;

        dummy.position.set(x, y, z);

        o.tumbleAngle += o.tumbleSpeed;  // rad/frame, no delta
        dummy.quaternion.setFromAxisAngle(o.tumbleAxis, o.tumbleAngle);

        dummy.scale.set(o.s, o.s, o.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
}
