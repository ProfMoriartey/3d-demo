"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

declare global {
  interface Window {
    Ammo?: (config?: any) => Promise<any>;
  }
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

export default function ClothScene() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // three.js
    let renderer: THREE.WebGLRenderer | null = null;
    let scene: THREE.Scene;
    let camera: THREE.PerspectiveCamera;
    let controls: OrbitControls;
    const clock = new THREE.Clock();
    const textureLoader = new THREE.TextureLoader();

    // ammo / physics
    let AmmoLib: any;
    let physicsWorld: any;
    let transformAux1: any = null;

    // state
    const rigidBodies: THREE.Object3D[] = [];
    const gravityConstant = -9.8;
    const margin = 0.05;

    let hinge: any = null;
    let armMovement = 0;

    // cloth + cached attrs
    let cloth: THREE.Mesh<
      THREE.BufferGeometry,
      THREE.Material | THREE.Material[]
    > | null = null;
    let clothPosAttr: THREE.BufferAttribute | null = null;
    let clothNormAttr: THREE.BufferAttribute | null = null;

    const initGraphics = () => {
      const container = containerRef.current!;
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0xbfd1e5);

      camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.2,
        2000,
      );
      camera.position.set(-12, 7, 4);

      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.shadowMap.enabled = true;
      container.appendChild(renderer.domElement);

      controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 2, 0);
      controls.update();

      scene.add(new THREE.AmbientLight(0xbbbbbb));

      const dir = new THREE.DirectionalLight(0xffffff, 3);
      dir.position.set(-7, 10, 15);
      dir.castShadow = true;
      const d = 10;
      dir.shadow.camera.left = -d;
      dir.shadow.camera.right = d;
      dir.shadow.camera.top = d;
      dir.shadow.camera.bottom = -d;
      dir.shadow.camera.near = 2;
      dir.shadow.camera.far = 50;
      dir.shadow.mapSize.set(1024, 1024);
      dir.shadow.bias = -0.003;
      scene.add(dir);

      window.addEventListener("resize", onWindowResize);
    };

    const initPhysics = () => {
      const collisionConfiguration =
        new AmmoLib.btSoftBodyRigidBodyCollisionConfiguration();
      const dispatcher = new AmmoLib.btCollisionDispatcher(
        collisionConfiguration,
      );
      const broadphase = new AmmoLib.btDbvtBroadphase();
      const solver = new AmmoLib.btSequentialImpulseConstraintSolver();
      const softBodySolver = new AmmoLib.btDefaultSoftBodySolver();

      physicsWorld = new AmmoLib.btSoftRigidDynamicsWorld(
        dispatcher,
        broadphase,
        solver,
        collisionConfiguration,
        softBodySolver,
      );

      const g = new AmmoLib.btVector3(0, gravityConstant, 0);
      physicsWorld.setGravity(g);
      physicsWorld.getWorldInfo().set_m_gravity(g);

      transformAux1 = new AmmoLib.btTransform();
    };

    const createMaterial = () =>
      new THREE.MeshPhongMaterial({
        color: Math.floor(Math.random() * (1 << 24)),
      });

    const createRigidBody = (
      threeObject: THREE.Mesh,
      physicsShape: any,
      mass: number,
      pos: THREE.Vector3,
      quat: THREE.Quaternion,
    ) => {
      threeObject.position.copy(pos);
      threeObject.quaternion.copy(quat);

      const transform = new AmmoLib.btTransform();
      transform.setIdentity();
      transform.setOrigin(new AmmoLib.btVector3(pos.x, pos.y, pos.z));
      transform.setRotation(
        new AmmoLib.btQuaternion(quat.x, quat.y, quat.z, quat.w),
      );
      const motionState = new AmmoLib.btDefaultMotionState(transform);

      const localInertia = new AmmoLib.btVector3(0, 0, 0);
      physicsShape.calculateLocalInertia(mass, localInertia);

      const rbInfo = new AmmoLib.btRigidBodyConstructionInfo(
        mass,
        motionState,
        physicsShape,
        localInertia,
      );
      const body = new AmmoLib.btRigidBody(rbInfo);

      (threeObject as any).userData.physicsBody = body;
      scene.add(threeObject);

      if (mass > 0) {
        rigidBodies.push(threeObject);
        body.setActivationState(4); // disable deactivation
      }

      physicsWorld.addRigidBody(body);
    };

    const createParallelepiped = (
      sx: number,
      sy: number,
      sz: number,
      mass: number,
      pos: THREE.Vector3,
      quat: THREE.Quaternion,
      material: THREE.Material,
    ) => {
      const threeObject = new THREE.Mesh(
        new THREE.BoxGeometry(sx, sy, sz, 1, 1, 1),
        material,
      );
      const shape = new AmmoLib.btBoxShape(
        new AmmoLib.btVector3(sx * 0.5, sy * 0.5, sz * 0.5),
      );
      shape.setMargin(margin);
      createRigidBody(threeObject, shape, mass, pos, quat);
      return threeObject;
    };

    const createObjects = () => {
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion(0, 0, 0, 1);

      // ground
      pos.set(0, -0.5, 0);
      const ground = createParallelepiped(
        40,
        1,
        40,
        0,
        pos,
        quat,
        new THREE.MeshPhongMaterial({ color: 0xffffff }),
      );
      ground.castShadow = true;
      ground.receiveShadow = true;
      textureLoader.load("/textures/grid.png", (tx) => {
        tx.colorSpace = THREE.SRGBColorSpace;
        tx.wrapS = THREE.RepeatWrapping;
        tx.wrapT = THREE.RepeatWrapping;
        tx.repeat.set(40, 40);
        (ground.material as THREE.MeshPhongMaterial).map = tx;
        (ground.material as THREE.MeshPhongMaterial).needsUpdate = true;
      });

      // wall
      const brickMass = 0.5;
      const brickLength = 1.2;
      const brickDepth = 0.6;
      const brickHeight = brickLength * 0.5;
      const numBricksLength = 6;
      const numBricksHeight = 8;
      const z0 = -numBricksLength * brickLength * 0.5;

      pos.set(0, brickHeight * 0.5, z0);
      for (let j = 0; j < numBricksHeight; j++) {
        const oddRow = j % 2 === 1;
        pos.z = z0;
        if (oddRow) pos.z -= 0.25 * brickLength;

        const nRow = oddRow ? numBricksLength + 1 : numBricksLength;

        for (let i = 0; i < nRow; i++) {
          let len = brickLength;
          let mass = brickMass;

          if (oddRow && (i === 0 || i === nRow - 1)) {
            len *= 0.5;
            mass *= 0.5;
          }

          const brick = createParallelepiped(
            brickDepth,
            brickHeight,
            len,
            mass,
            pos,
            quat,
            createMaterial(),
          );
          brick.castShadow = true;
          brick.receiveShadow = true;

          if (oddRow && (i === 0 || i === nRow - 2))
            pos.z += 0.75 * brickLength;
          else pos.z += brickLength;
        }

        pos.y += brickHeight;
      }

      // cloth visuals
      const clothWidth = 4;
      const clothHeight = 3;
      const clothNumSegmentsZ = clothWidth * 5;
      const clothNumSegmentsY = clothHeight * 5;
      const clothPos = new THREE.Vector3(-3, 3, 2);

      const clothGeometry = new THREE.PlaneGeometry(
        clothWidth,
        clothHeight,
        clothNumSegmentsZ,
        clothNumSegmentsY,
      );
      clothGeometry.rotateY(Math.PI * 0.5);
      clothGeometry.translate(
        clothPos.x,
        clothPos.y + clothHeight * 0.5,
        clothPos.z - clothWidth * 0.5,
      );

      const clothMaterial = new THREE.MeshLambertMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
      });
      cloth = new THREE.Mesh(clothGeometry, clothMaterial);
      cloth.castShadow = true;
      cloth.receiveShadow = true;
      scene.add(cloth);

      textureLoader.load("/textures/grid.png", (tx) => {
        tx.colorSpace = THREE.SRGBColorSpace;
        tx.wrapS = THREE.RepeatWrapping;
        tx.wrapT = THREE.RepeatWrapping;
        tx.repeat.set(clothNumSegmentsZ, clothNumSegmentsY);
        (cloth!.material as THREE.MeshLambertMaterial).map = tx;
        (cloth!.material as THREE.MeshLambertMaterial).needsUpdate = true;
      });

      // cache attrs
      clothPosAttr = cloth.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      clothNormAttr = cloth.geometry.getAttribute(
        "normal",
      ) as THREE.BufferAttribute;
      cloth.geometry.computeVertexNormals();

      // cloth soft body
      const softBodyHelpers = new AmmoLib.btSoftBodyHelpers();
      const clothCorner00 = new AmmoLib.btVector3(
        clothPos.x,
        clothPos.y + clothHeight,
        clothPos.z,
      );
      const clothCorner01 = new AmmoLib.btVector3(
        clothPos.x,
        clothPos.y + clothHeight,
        clothPos.z - clothWidth,
      );
      const clothCorner10 = new AmmoLib.btVector3(
        clothPos.x,
        clothPos.y,
        clothPos.z,
      );
      const clothCorner11 = new AmmoLib.btVector3(
        clothPos.x,
        clothPos.y,
        clothPos.z - clothWidth,
      );

      const clothSoftBody = softBodyHelpers.CreatePatch(
        physicsWorld.getWorldInfo(),
        clothCorner00,
        clothCorner01,
        clothCorner10,
        clothCorner11,
        clothNumSegmentsZ + 1,
        clothNumSegmentsY + 1,
        0,
        true,
      );

      const sbConfig = clothSoftBody.get_m_cfg();
      sbConfig.set_viterations(10);
      sbConfig.set_piterations(10);

      clothSoftBody.setTotalMass(0.9, false);
      AmmoLib.castObject(clothSoftBody, AmmoLib.btCollisionObject)
        .getCollisionShape()
        .setMargin(margin * 3);
      physicsWorld.addSoftBody(clothSoftBody, 1, -1);
      (cloth as any).userData.physicsBody = clothSoftBody;
      clothSoftBody.setActivationState(4);

      // arm
      const armMass = 2;
      const armLength = 3 + clothWidth;
      const pylonHeight = clothPos.y + clothHeight;
      const baseMat = new THREE.MeshPhongMaterial({ color: 0x606060 });

      pos.set(clothPos.x, 0.1, clothPos.z - armLength);
      const base = createParallelepiped(1, 0.2, 1, 0, pos, quat, baseMat);
      base.castShadow = true;
      base.receiveShadow = true;

      pos.set(clothPos.x, 0.5 * pylonHeight, clothPos.z - armLength);
      const pylon = createParallelepiped(
        0.4,
        pylonHeight,
        0.4,
        0,
        pos,
        quat,
        baseMat,
      );
      pylon.castShadow = true;
      pylon.receiveShadow = true;

      pos.set(clothPos.x, pylonHeight + 0.2, clothPos.z - 0.5 * armLength);
      const arm = createParallelepiped(
        0.4,
        0.4,
        armLength + 0.4,
        armMass,
        pos,
        quat,
        baseMat,
      );
      arm.castShadow = true;
      arm.receiveShadow = true;

      // anchors
      const influence = 0.5;
      (cloth as any).userData.physicsBody.appendAnchor(
        0,
        (arm as any).userData.physicsBody,
        false,
        influence,
      );
      (cloth as any).userData.physicsBody.appendAnchor(
        clothNumSegmentsZ,
        (arm as any).userData.physicsBody,
        false,
        influence,
      );

      // hinge
      const pivotA = new AmmoLib.btVector3(0, pylonHeight * 0.5, 0);
      const pivotB = new AmmoLib.btVector3(0, -0.2, -armLength * 0.5);
      const axis = new AmmoLib.btVector3(0, 1, 0);
      hinge = new AmmoLib.btHingeConstraint(
        (pylon as any).userData.physicsBody,
        (arm as any).userData.physicsBody,
        pivotA,
        pivotB,
        axis,
        axis,
        true,
      );
      physicsWorld.addConstraint(hinge, true);
    };

    const keydown = (e: KeyboardEvent) => {
      if (e.code === "KeyQ") armMovement = 1;
      if (e.code === "KeyA") armMovement = -1;
    };
    const keyup = () => {
      armMovement = 0;
    };

    const initInput = () => {
      window.addEventListener("keydown", keydown);
      window.addEventListener("keyup", keyup);
    };

    const animate = () => {
      const deltaTime = clock.getDelta();

      if (hinge) hinge.enableAngularMotor(true, 0.8 * armMovement, 50);

      if (physicsWorld) {
        physicsWorld.stepSimulation(deltaTime, 10);

        if (cloth && clothPosAttr) {
          const softBody = (cloth as any).userData.physicsBody;
          const posArray = clothPosAttr.array as Float32Array;
          const numVerts = posArray.length / 3;
          const nodes = softBody.get_m_nodes();

          let i3 = 0;
          for (let i = 0; i < numVerts; i++) {
            const node = nodes.at(i);
            const npos = node.get_m_x();
            posArray[i3++] = npos.x();
            posArray[i3++] = npos.y();
            posArray[i3++] = npos.z();
          }

          cloth.geometry.computeVertexNormals();
          clothPosAttr.needsUpdate = true;
          if (clothNormAttr) clothNormAttr.needsUpdate = true;
        }

        for (let i = 0; i < rigidBodies.length; i++) {
          const objThree = rigidBodies[i]!;
          const objPhys = (objThree as any).userData.physicsBody;
          const ms = objPhys.getMotionState();
          if (ms) {
            ms.getWorldTransform(transformAux1);
            const p = transformAux1.getOrigin();
            const q = transformAux1.getRotation();
            objThree.position.set(p.x(), p.y(), p.z());
            (objThree as THREE.Mesh).quaternion.set(q.x(), q.y(), q.z(), q.w());
          }
        }
      }

      renderer!.render(scene, camera);
      requestAnimationFrame(animate);
    };

    const onWindowResize = () => {
      if (!renderer) return;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    (async () => {
      // load Ammo glue from /public and init
      await loadScript("/ammo/ammo.wasm.js");
      if (!window.Ammo) throw new Error("Ammo loader not found on window");
      AmmoLib = await window.Ammo({
        locateFile: (file: string) => `/ammo/${file}`,
      });

      initGraphics();
      initPhysics();
      createObjects();
      initInput();
      animate();
    })();

    return () => {
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      if (renderer) {
        renderer.dispose();
        renderer = null;
      }
    };
  }, []);

  return <div ref={containerRef} className="h-screen w-screen" />;
}
