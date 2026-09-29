import * as THREE from "three";

/** Escala o modelo pela envergadura (eixo X) e o centraliza na origem. */
export function fitSpan(root, span) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  root.scale.setScalar(span / Math.max(size.x, 0.001));
  box.setFromObject(root);
  const center = new THREE.Vector3();
  box.getCenter(center);
  root.position.sub(center);
}
