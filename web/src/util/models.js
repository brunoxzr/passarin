import * as THREE from "three";

/** Escala o modelo para que a maior dimensão tenha `height` e o centraliza na origem. */
export function fitHeight(root, height) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const s = height / Math.max(size.y, size.x, size.z, 0.001);
  root.scale.setScalar(s);
  box.setFromObject(root);
  const center = new THREE.Vector3();
  box.getCenter(center);
  root.position.sub(center);
}
