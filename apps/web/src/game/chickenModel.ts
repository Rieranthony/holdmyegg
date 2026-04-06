import * as THREE from "three";
import {
  chickenFeatherGeometry,
  chickenWingRigGeometry,
  getChickenLowDetailTraceOffsetX,
  getChickenLowDetailWingMeshOffsetX,
  getChickenWingMeshOffsetX,
  getChickenWingTraceOffsetX,
  headFeatherOffsets,
  tailFeatherOffsets,
  wingFeatherletOffsets,
  type ChickenFeatherOffset
} from "./playerVisuals";
import {
  chickenDetailMaterials,
  chickenModelRig,
  chickenPartGeometries,
  type ChickenMaterialBundle
} from "./sceneAssets";

export interface ChickenAvatarRig {
  root: THREE.Group;
  shell: THREE.Group;
  avatar: THREE.Group;
  body: THREE.Group;
  highDetail: THREE.Group;
  lowDetail: THREE.Group;
  headPivot: THREE.Group;
  lowDetailHead: THREE.Group;
  leftWing: THREE.Group;
  rightWing: THREE.Group;
  lowDetailLeftWing: THREE.Group;
  lowDetailRightWing: THREE.Group;
  leftWingMesh: THREE.Group;
  rightWingMesh: THREE.Group;
  lowDetailLeftWingMesh: THREE.Group;
  lowDetailRightWingMesh: THREE.Group;
  leftWingTrace: THREE.Mesh;
  rightWingTrace: THREE.Mesh;
  lowDetailLeftTrace: THREE.Mesh;
  lowDetailRightTrace: THREE.Mesh;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  headFeathers: THREE.Group[];
  lowDetailHeadFeathers: THREE.Group[];
  leftWingFeatherlets: THREE.Group[];
  rightWingFeatherlets: THREE.Group[];
  tail: THREE.Group;
  tailFeathers: THREE.Group[];
  lowDetailTail: THREE.Group;
}

const addGroup = (
  parent: THREE.Object3D,
  {
    position,
    rotation
  }: {
    position?: readonly [number, number, number];
    rotation?: readonly [number, number, number];
  } = {}
) => {
  const group = new THREE.Group();
  if (position) {
    group.position.set(...position);
  }
  if (rotation) {
    group.rotation.set(...rotation);
  }
  parent.add(group);
  return group;
};

const addMesh = (
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  {
    position,
    rotation
  }: {
    position?: readonly [number, number, number];
    rotation?: readonly [number, number, number];
  } = {}
) => {
  const mesh = new THREE.Mesh(geometry, material);
  if (position) {
    mesh.position.set(...position);
  }
  if (rotation) {
    mesh.rotation.set(...rotation);
  }
  parent.add(mesh);
  return mesh;
};

const createFeatherGroup = (
  parent: THREE.Object3D,
  feather: ChickenFeatherOffset,
  materialBundle: ChickenMaterialBundle,
  side: 1 | -1 = 1
) => {
  const featherGroup = addGroup(parent, {
    position: [feather.x * side, feather.y, feather.z],
    rotation: [feather.rotationX, feather.rotationY * side, feather.rotationZ * side]
  });
  featherGroup.scale.set(...feather.scale);
  addMesh(featherGroup, chickenPartGeometries.featherPlume, materialBundle.body, {
    position: [0, chickenFeatherGeometry.plumePositionY, 0]
  });
  addMesh(featherGroup, chickenPartGeometries.featherQuill, chickenDetailMaterials.beak, {
    position: [0, chickenFeatherGeometry.quillPositionY, 0]
  });
  return featherGroup;
};

const createLowDetailHeadFeather = (
  parent: THREE.Object3D,
  feather: ChickenFeatherOffset,
  materialBundle: ChickenMaterialBundle
) => {
  const featherGroup = addGroup(parent, {
    position: [feather.x * 0.76, feather.y * 0.72, feather.z * 0.62],
    rotation: [feather.rotationX * 0.9, feather.rotationY, feather.rotationZ * 0.86]
  });
  featherGroup.scale.set(feather.scale[0] * 0.9, feather.scale[1] * 0.72, feather.scale[2] * 0.9);
  addMesh(featherGroup, chickenPartGeometries.lowCrest, materialBundle.body);
  return featherGroup;
};

const createTail = (parent: THREE.Object3D, materialBundle: ChickenMaterialBundle) => {
  const tail = addGroup(parent, {
    position: [0, chickenModelRig.tailAnchorY, chickenModelRig.tailAnchorZ]
  });
  const tailFeathers = tailFeatherOffsets.map((feather) => createFeatherGroup(tail, feather, materialBundle));
  return {
    tail,
    tailFeathers
  };
};

const createLowDetailTail = (parent: THREE.Object3D, materialBundle: ChickenMaterialBundle) => {
  const lowDetailTail = addGroup(parent, {
    position: [0, chickenModelRig.lowTailAnchorY, chickenModelRig.lowTailAnchorZ]
  });

  tailFeatherOffsets.forEach((feather, index) => {
    const mesh = addMesh(lowDetailTail, chickenPartGeometries.lowTail, materialBundle.body, {
      position: [feather.x * 0.7, feather.y * 0.34, feather.z * 0.28],
      rotation: [feather.rotationX * 0.78, feather.rotationY, feather.rotationZ * 0.58]
    });
    const scale = index === 1 ? 1.08 : 0.92;
    mesh.scale.set(scale, scale, 1);
  });

  return lowDetailTail;
};

const createWing = (
  parent: THREE.Object3D,
  side: 1 | -1,
  materialBundle: ChickenMaterialBundle
) => {
  const wing = addGroup(parent, {
    position: [
      chickenModelRig.wingAnchorX * side,
      chickenModelRig.wingAnchorY,
      chickenModelRig.wingAnchorZ
    ]
  });
  const wingMesh = addGroup(wing, {
    position: [getChickenWingMeshOffsetX(1) * side, 0, 0]
  });

  addMesh(wingMesh, chickenPartGeometries.wingRoot, materialBundle.shade);
  addMesh(wingMesh, chickenPartGeometries.wingMid, materialBundle.body, {
    position: [0.14 * side, 0.06, 0.02],
    rotation: [0, 0, 0.12 * side]
  });
  addMesh(wingMesh, chickenPartGeometries.wingTip, materialBundle.body, {
    position: [0.28 * side, 0.1, 0.04],
    rotation: [0, 0, 0.28 * side]
  });

  const wingTrace = addMesh(wing, chickenPartGeometries.wingletTrace, materialBundle.wingletTrace, {
    position: [getChickenWingTraceOffsetX(1) * side, chickenWingRigGeometry.traceHighDetailY, 0]
  });
  wingTrace.visible = false;

  const wingFeatherlets = wingFeatherletOffsets.map((feather) =>
    createFeatherGroup(wingMesh, feather, materialBundle, side)
  );

  return {
    wing,
    wingMesh,
    wingTrace,
    wingFeatherlets
  };
};

const createLowDetailWing = (
  parent: THREE.Object3D,
  side: 1 | -1,
  materialBundle: ChickenMaterialBundle
) => {
  const lowDetailWing = addGroup(parent, {
    position: [
      chickenModelRig.lowWingAnchorX * side,
      chickenModelRig.lowWingAnchorY,
      chickenModelRig.lowWingAnchorZ
    ]
  });
  const lowDetailWingMesh = addGroup(lowDetailWing, {
    position: [getChickenLowDetailWingMeshOffsetX(1) * side, 0, 0]
  });

  addMesh(lowDetailWingMesh, chickenPartGeometries.lowWing, materialBundle.shade);

  return {
    lowDetailWing,
    lowDetailWingMesh
  };
};

export const createChickenAvatarRig = (materialBundle: ChickenMaterialBundle): ChickenAvatarRig => {
  const root = new THREE.Group();
  const shell = addGroup(root);
  const avatar = addGroup(shell);
  const body = addGroup(avatar);
  const highDetail = addGroup(body);
  const lowDetail = addGroup(body);
  lowDetail.visible = false;

  const {
    wing: leftWing,
    wingMesh: leftWingMesh,
    wingTrace: leftWingTrace,
    wingFeatherlets: leftWingFeatherlets
  } = createWing(highDetail, 1, materialBundle);
  const {
    wing: rightWing,
    wingMesh: rightWingMesh,
    wingTrace: rightWingTrace,
    wingFeatherlets: rightWingFeatherlets
  } = createWing(highDetail, -1, materialBundle);

  addMesh(highDetail, chickenPartGeometries.body, materialBundle.body);

  const { tail, tailFeathers } = createTail(highDetail, materialBundle);

  const leftLeg = addGroup(highDetail, {
    position: [chickenModelRig.legAnchorX, chickenModelRig.legAnchorY, chickenModelRig.legAnchorZ]
  });
  addMesh(leftLeg, chickenPartGeometries.leg, chickenDetailMaterials.legs, {
    position: [0, chickenModelRig.legMeshOffsetY, 0]
  });

  const rightLeg = addGroup(highDetail, {
    position: [-chickenModelRig.legAnchorX, chickenModelRig.legAnchorY, chickenModelRig.legAnchorZ]
  });
  addMesh(rightLeg, chickenPartGeometries.leg, chickenDetailMaterials.legs, {
    position: [0, chickenModelRig.legMeshOffsetY, 0]
  });

  const headPivot = addGroup(highDetail, {
    position: [0, chickenModelRig.headPivotY, chickenModelRig.headPivotZ]
  });
  const headGroup = addGroup(headPivot, {
    position: [0, -chickenModelRig.headPivotY, -chickenModelRig.headPivotZ]
  });

  addMesh(headGroup, chickenPartGeometries.head, materialBundle.body, {
    position: [0, 0.14, 0.24]
  });
  const headFeathers = headFeatherOffsets.map((feather) => createFeatherGroup(headGroup, feather, materialBundle));
  addMesh(headGroup, chickenPartGeometries.beakBase, chickenDetailMaterials.beak, {
    position: [0, 0.03, 0.6]
  });
  addMesh(headGroup, chickenPartGeometries.beakMid, chickenDetailMaterials.beak, {
    position: [0, 0.02, 0.74]
  });
  addMesh(headGroup, chickenPartGeometries.beakTip, chickenDetailMaterials.beak, {
    position: [0, 0.01, 0.87]
  });
  addMesh(headGroup, chickenPartGeometries.beakCap, chickenDetailMaterials.beak, {
    position: [0, 0, 0.97]
  });
  addMesh(headGroup, chickenPartGeometries.eye, chickenDetailMaterials.eye, {
    position: [0.18, 0.16, 0.44]
  });
  addMesh(headGroup, chickenPartGeometries.eye, chickenDetailMaterials.eye, {
    position: [-0.18, 0.16, 0.44]
  });
  addMesh(headGroup, chickenPartGeometries.pupil, chickenDetailMaterials.pupil, {
    position: [0.18, 0.14, 0.5]
  });
  addMesh(headGroup, chickenPartGeometries.pupil, chickenDetailMaterials.pupil, {
    position: [-0.18, 0.14, 0.5]
  });
  addMesh(headGroup, chickenPartGeometries.wattle, chickenDetailMaterials.beak, {
    position: [0, -0.06, 0.56]
  });

  const { lowDetailWing: lowDetailLeftWing, lowDetailWingMesh: lowDetailLeftWingMesh } = createLowDetailWing(
    lowDetail,
    1,
    materialBundle
  );
  const { lowDetailWing: lowDetailRightWing, lowDetailWingMesh: lowDetailRightWingMesh } = createLowDetailWing(
    lowDetail,
    -1,
    materialBundle
  );

  addMesh(lowDetail, chickenPartGeometries.lowBody, materialBundle.body);
  const lowDetailTail = createLowDetailTail(lowDetail, materialBundle);

  const lowDetailHead = addGroup(lowDetail, {
    position: [0, chickenModelRig.lowHeadPivotY, chickenModelRig.lowHeadPivotZ]
  });
  const lowDetailHeadGroup = addGroup(lowDetailHead, {
    position: [0, -chickenModelRig.lowHeadPivotY, -chickenModelRig.lowHeadPivotZ]
  });

  addMesh(lowDetailHeadGroup, chickenPartGeometries.lowHead, materialBundle.body, {
    position: [0, 0.12, 0.2]
  });
  const lowDetailHeadFeathers = headFeatherOffsets.map((feather) =>
    createLowDetailHeadFeather(lowDetailHeadGroup, feather, materialBundle)
  );
  addMesh(lowDetailHeadGroup, chickenPartGeometries.lowBeakBase, chickenDetailMaterials.beak, {
    position: [0, 0.01, 0.5]
  });
  addMesh(lowDetailHeadGroup, chickenPartGeometries.lowBeakFront, chickenDetailMaterials.beak, {
    position: [0, 0, 0.61]
  });
  addMesh(lowDetailHeadGroup, chickenPartGeometries.lowBeakTip, chickenDetailMaterials.beak, {
    position: [0, -0.01, 0.7]
  });

  const lowDetailLeftTrace = addMesh(lowDetail, chickenPartGeometries.wingletTrace, materialBundle.wingletTrace, {
    position: [getChickenLowDetailTraceOffsetX(1), chickenWingRigGeometry.traceLowDetailY, 0],
    rotation: [0, 0, 0.12]
  });
  lowDetailLeftTrace.visible = false;

  const lowDetailRightTrace = addMesh(lowDetail, chickenPartGeometries.wingletTrace, materialBundle.wingletTrace, {
    position: [-getChickenLowDetailTraceOffsetX(1), chickenWingRigGeometry.traceLowDetailY, 0],
    rotation: [0, 0, -0.12]
  });
  lowDetailRightTrace.visible = false;

  return {
    root,
    shell,
    avatar,
    body,
    highDetail,
    lowDetail,
    headPivot,
    lowDetailHead,
    leftWing,
    rightWing,
    lowDetailLeftWing,
    lowDetailRightWing,
    leftWingMesh,
    rightWingMesh,
    lowDetailLeftWingMesh,
    lowDetailRightWingMesh,
    leftWingTrace,
    rightWingTrace,
    lowDetailLeftTrace,
    lowDetailRightTrace,
    leftLeg,
    rightLeg,
    headFeathers,
    lowDetailHeadFeathers,
    leftWingFeatherlets,
    rightWingFeatherlets,
    tail,
    tailFeathers,
    lowDetailTail
  };
};
