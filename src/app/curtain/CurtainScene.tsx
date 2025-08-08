"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

declare global {
  interface Window {
    Ammo?: (config?: any) => Promise<any>;
  }
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

export default function CurtainScene() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // three
    let renderer: THREE.WebGLRenderer | null = null;
    let scene: THREE.Scene | null = null;
    let camera: THREE.PerspectiveCamera | null = null;
    const clock = new THREE.Clock();

    // ammo
    let AmmoLib: any = null;
    let physicsWorld: any = null;

    // curtains
    const segX = 40;
    const segY = 50;
    let leftCloth: THREE.Mesh | null = null;
    let rightCloth: THREE.Mesh | null = null;
    let leftPosAttr: THREE.BufferAttribute | null = null;
    let rightPosAttr: THREE.BufferAttribute | null = null;

    // rods (we move these with scroll)
    let leftRodMesh: THREE.Mesh | null = null;
    let rightRodMesh: THREE.Mesh | null = null;
    let leftRodStartX = 0;
    let rightRodStartX = 0;
    let slideDistance = 0; // outward travel distance

    // settings
    const gravity = -9.8;
    const margin = 0.05;

    // scroll control
    let scrollProgress = 0; // 0..1
    const maxScrollPx = 600; // scroll needed to fully open
    const tinyAssistForce = 3; // small force to help bottom follow (set 0 to disable)

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const assertReady = () => {
      if (!scene || !camera || !renderer) throw new Error("Graphics not ready");
    };

    const onResize = () => {
      if (!renderer || !camera) return;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    const onScroll = () => {
      const y = window.scrollY ?? 0;
      scrollProgress = Math.max(0, Math.min(1, y / maxScrollPx));
    };

    const initGraphics = () => {
      const container = containerRef.current;
      if (!container) return;

      scene = new THREE.Scene();

      camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.1,
        2000,
      );
      camera.position.set(0, 0, 8);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.domElement.style.position = "fixed";
      renderer.domElement.style.inset = "0";
      renderer.domElement.style.zIndex = "9999";
      renderer.domElement.style.pointerEvents = "none";
      container.appendChild(renderer.domElement);

      // lights
      scene.add(new THREE.AmbientLight(0xffffff, 1));
      const dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(3, 6, 5);
      scene.add(dir);

      window.addEventListener("resize", onResize);
      window.addEventListener("scroll", onScroll, { passive: true });

      // console.log("[Curtain] Graphics ready");
    };

    const initPhysics = () => {
      const cfg = new AmmoLib.btSoftBodyRigidBodyCollisionConfiguration();
      const dispatcher = new AmmoLib.btCollisionDispatcher(cfg);
      const broadphase = new AmmoLib.btDbvtBroadphase();
      const solver = new AmmoLib.btSequentialImpulseConstraintSolver();
      const softSolver = new AmmoLib.btDefaultSoftBodySolver();
      physicsWorld = new AmmoLib.btSoftRigidDynamicsWorld(
        dispatcher,
        broadphase,
        solver,
        cfg,
        softSolver,
      );
      const g = new AmmoLib.btVector3(0, gravity, 0);
      physicsWorld.setGravity(g);
      physicsWorld.getWorldInfo().set_m_gravity(g);
      // console.log("[Curtain] Physics ready");
    };

    const computeViewSize = () => {
      assertReady();
      const dist = camera!.position.z; // plane at z=0
      const vFov = (camera!.fov * Math.PI) / 180;
      const viewH = 2 * Math.tan(vFov / 2) * dist;
      const viewW = viewH * camera!.aspect;
      return { viewW, viewH };
    };

    const createRod = (xCenter: number, y: number, length: number) => {
      assertReady();
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(length, 0.1, 0.1),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      bar.position.set(xCenter, y, 0);
      scene!.add(bar);

      if (!AmmoLib) return bar;
      const shape = new AmmoLib.btBoxShape(
        new AmmoLib.btVector3(length * 0.5, 0.05, 0.05),
      );
      const t = new AmmoLib.btTransform();
      t.setIdentity();
      t.setOrigin(new AmmoLib.btVector3(xCenter, y, 0));
      const ms = new AmmoLib.btDefaultMotionState(t);
      const rbInfo = new AmmoLib.btRigidBodyConstructionInfo(
        0,
        ms,
        shape,
        new AmmoLib.btVector3(0, 0, 0),
      );
      const body = new AmmoLib.btRigidBody(rbInfo);
      (bar as any).userData.physicsBody = body;
      physicsWorld.addRigidBody(body);
      return bar;
    };

    const createCurtains = () => {
      assertReady();
      const { viewW, viewH } = computeViewSize();
      const half = viewW / 2;
      const yTop = viewH / 2 - 0.2;

      // outward slide distance; push beyond edges so cloth leaves frame
      slideDistance = viewW * 5;

      // rods
      leftRodMesh = createRod(-half / 2, yTop, half);
      rightRodMesh = createRod(+half / 2, yTop, half);
      leftRodStartX = -half / 2;
      rightRodStartX = +half / 2;

      // planes (visible even without physics)
      const mk = (xShift: number, color: number) => {
        const geo = new THREE.PlaneGeometry(half, viewH, segX, segY);
        geo.translate(xShift, yTop - viewH / 2, 0);
        const mat = new THREE.MeshLambertMaterial({
          color,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene!.add(mesh);
        return mesh;
      };

      leftCloth = mk(-half / 2, 0xb3002d);
      rightCloth = mk(+half / 2, 0xb3002d);
      leftPosAttr = leftCloth.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      rightPosAttr = rightCloth.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;

      if (!AmmoLib) {
        // console.warn("[Curtain] Ammo missing — static planes only");
        return;
      }

      // soft bodies
      const sbh = new AmmoLib.btSoftBodyHelpers();
      const makePatch = (xLeft: number, xRight: number) => {
        const yBottom = yTop - viewH;
        const c00 = new AmmoLib.btVector3(xLeft, yTop, 0);
        const c01 = new AmmoLib.btVector3(xRight, yTop, 0);
        const c10 = new AmmoLib.btVector3(xLeft, yBottom, 0);
        const c11 = new AmmoLib.btVector3(xRight, yBottom, 0);
        const body = sbh.CreatePatch(
          physicsWorld.getWorldInfo(),
          c00,
          c01,
          c10,
          c11,
          segX + 1,
          segY + 1,
          0,
          true,
        );
        const cfg = body.get_m_cfg();
        cfg.set_viterations(18);
        cfg.set_piterations(18);
        body.setTotalMass(1.0, false);
        AmmoLib.castObject(body, AmmoLib.btCollisionObject)
          .getCollisionShape()
          .setMargin(margin * 2);
        body.setActivationState(4);
        physicsWorld.addSoftBody(body, 1, -1);
        return body;
      };

      const leftSoft = makePatch(-half, 0);
      const rightSoft = makePatch(0, half);

      (leftCloth as any).userData.physicsBody = leftSoft;
      (rightCloth as any).userData.physicsBody = rightSoft;

      // anchor top rows to rods
      const anchorRow = (soft: any, rodMesh: THREE.Mesh | null) => {
        if (!rodMesh) return;
        const rodBody = (rodMesh as any).userData.physicsBody;
        for (let i = 0; i <= segX; i++)
          soft.appendAnchor(i, rodBody, false, 1.0);
      };
      anchorRow(leftSoft, leftRodMesh);
      anchorRow(rightSoft, rightRodMesh);

      // console.log("[Curtain] Curtains created");
    };

    const animate = () => {
      if (!renderer || !scene || !camera) return;

      const dt = clock.getDelta();
      const t = easeOutCubic(scrollProgress);

      // move rods outward based on scroll
      const moveRod = (
        mesh: THREE.Mesh | null,
        startX: number,
        dir: 1 | -1,
      ) => {
        if (!mesh) return;
        const targetX = startX + dir * slideDistance * t;
        mesh.position.x = targetX;

        // sync Ammo rigid body
        const body = (mesh as any).userData.physicsBody;
        if (body && AmmoLib) {
          const tr = new AmmoLib.btTransform();
          tr.setIdentity();
          tr.setOrigin(
            new AmmoLib.btVector3(targetX, mesh.position.y, mesh.position.z),
          );
          const q = mesh.quaternion;
          tr.setRotation(new AmmoLib.btQuaternion(q.x, q.y, q.z, q.w));
          body.setWorldTransform(tr);
          body.setLinearVelocity(new AmmoLib.btVector3(0, 0, 0));
          body.setAngularVelocity(new AmmoLib.btVector3(0, 0, 0));
          body.activate();
        }
      };

      moveRod(leftRodMesh, leftRodStartX, -1); // left slides left
      moveRod(rightRodMesh, rightRodStartX, +1); // right slides right

      if (physicsWorld && AmmoLib) {
        physicsWorld.stepSimulation(dt, 10);

        // optional tiny assist force near the inner seam to help bottom follow
        if (tinyAssistForce > 0) {
          const applyAssist = (soft: any, side: "left" | "right") => {
            const nodes = soft.get_m_nodes();
            const cols = 2; // how many inner columns to nudge
            const fx =
              side === "left" ? -tinyAssistForce * t : tinyAssistForce * t;
            const force = new AmmoLib.btVector3(fx, 0, 0);
            for (let c = 0; c < cols; c++) {
              for (let y = 0; y <= segY; y++) {
                const xIndex = side === "left" ? c : segX - c;
                const idx = xIndex + y * (segX + 1);
                const n = nodes.at(idx);
                n.get_m_f().op_add(force);
              }
            }
          };
          if (leftCloth)
            applyAssist((leftCloth as any).userData.physicsBody, "left");
          if (rightCloth)
            applyAssist((rightCloth as any).userData.physicsBody, "right");
        }

        // sync cloth vertices
        const sync = (mesh: any, attr: THREE.BufferAttribute | null) => {
          if (!mesh || !attr) return;
          const soft = mesh.userData.physicsBody;
          const arr = attr.array as Float32Array;
          const numVerts = arr.length / 3;
          const nodes = soft.get_m_nodes();
          let i3 = 0;
          for (let i = 0; i < numVerts; i++) {
            const p = nodes.at(i).get_m_x();
            arr[i3++] = p.x();
            arr[i3++] = p.y();
            arr[i3++] = p.z();
          }
          mesh.geometry.computeVertexNormals();
          attr.needsUpdate = true;
          const nAttr = mesh.geometry.getAttribute(
            "normal",
          ) as THREE.BufferAttribute;
          if (nAttr) nAttr.needsUpdate = true;
        };

        if (leftCloth) sync(leftCloth, leftPosAttr);
        if (rightCloth) sync(rightCloth, rightPosAttr);
      }

      // optional: fade the canvas out when fully open
      if (renderer) renderer.domElement.style.opacity = t >= 1 ? "0" : "1";

      renderer!.render(scene, camera);
      requestAnimationFrame(animate);
    };

    (async () => {
      try {
        initGraphics(); // graphics first
        await loadScript("/ammo/ammo.wasm.js");
        if (window.Ammo) {
          AmmoLib = await window.Ammo({
            locateFile: (f: string) => `/ammo/${f}`,
          });
          initPhysics();
        }
        createCurtains();
        onScroll();
        animate();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[Curtain] Boot error", e);
      }
    })();

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll);
      renderer?.dispose();
      renderer = null;
      scene = null;
      camera = null;
    };
  }, []);

  return <div ref={containerRef} className="fixed inset-0 z-[9999]" />;
}
