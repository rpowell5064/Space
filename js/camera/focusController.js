import * as THREE from 'https://esm.sh/three@0.160.0';
import { showFocusPanel, hideFocusPanel } from '../ui/infoPanel.js';

export class FocusController {
    constructor(camera, controls) {
        this.camera = camera;
        this.controls = controls;

        this._focusedObject = null;
        this._focusTransitionActive = false;
        this._isFocused = false;
        this._targetLookAt = new THREE.Vector3();
        this._origin = new THREE.Vector3();
    }

    get isFocused() {
        return this._isFocused;
    }

    focusOn(object3D, data) {
        this._focusedObject = object3D;
        this._focusTransitionActive = true;
        this._isFocused = true;

        const targetPos = new THREE.Vector3();
        object3D.getWorldPosition(targetPos);
        this._targetLookAt.copy(targetPos);

        if (data) showFocusPanel(data);
    }

    clear() {
        this._isFocused = false;
        this._focusedObject = null;
        hideFocusPanel();
    }

    update() {
        if (!this._isFocused || !this._focusedObject) {
            this.controls.target.lerp(this._origin, 0.05);
            return;
        }

        const targetPos = new THREE.Vector3();
        this._focusedObject.getWorldPosition(targetPos);

        // Continuously keep the orbit-controls pivot on the focused body
        this.controls.target.lerp(targetPos, 0.12);

        // During the initial zoom-in, also glide the camera to a comfortable distance
        if (this._focusTransitionActive) {
            // Pick view distance based on the object's radius
            let radius = 10;
            if (this._focusedObject.isGroup && this._focusedObject.children[0]?.geometry?.parameters) {
                radius = this._focusedObject.children[0].geometry.parameters.radius;
            } else if (this._focusedObject.geometry?.parameters) {
                radius = this._focusedObject.geometry.parameters.radius;
            }
            const viewDist = radius * 4 + 20;

            const currentDist = this.camera.position.distanceTo(targetPos);
            const newDist = THREE.MathUtils.lerp(currentDist, viewDist, 0.05);
            const dir = new THREE.Vector3().subVectors(this.camera.position, targetPos).normalize();
            this.camera.position.copy(targetPos).add(dir.multiplyScalar(newDist));

            if (Math.abs(currentDist - viewDist) < 2) this._focusTransitionActive = false;
        }
    }
}
