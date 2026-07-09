'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/* ───────────────────────────────────────────────
   ParticleField — torus knot point cloud
   Reacts to mouse via shared ref, auto-rotates
   ─────────────────────────────────────────────── */
interface ParticleFieldProps {
  mouse: React.MutableRefObject<{ x: number; y: number }>;
}

function ParticleField({ mouse }: ParticleFieldProps) {
  const pointsRef = useRef<THREE.Points>(null!);
  const dummy = useRef({ rotX: 0, rotY: 0 });

  const [positions, colors] = useMemo(() => {
    const count = 1024;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);

    const R = 2.4;
    const r = 0.9;
    const p = 2;
    const q = 3;

    for (let i = 0; i < count; i++) {
      const t = (i / count) * Math.PI * 2;
      const scatter = 0.6;

      // Torus knot parametric
      const x = R * (1 + r * Math.cos(q * t)) * Math.cos(p * t);
      const y = R * (1 + r * Math.cos(q * t)) * Math.sin(p * t);
      const z = r * Math.sin(q * t);

      pos[i * 3]     = x + (Math.random() - 0.5) * scatter;
      pos[i * 3 + 1] = y + (Math.random() - 0.5) * scatter;
      pos[i * 3 + 2] = z + (Math.random() - 0.5) * scatter;

      const mix = Math.random();
      col[i * 3]     = 0.25 + mix * 0.35;
      col[i * 3 + 1] = 0.15 + (1 - mix) * 0.25;
      col[i * 3 + 2] = 0.55 + mix * 0.45;
    }

    return [pos, col];
  }, []);

  useFrame(({ pointer }) => {
    if (!pointsRef.current) return;
    const mesh = pointsRef.current;

    // Auto-rotation
    mesh.rotation.x += 0.0015;
    mesh.rotation.y += 0.0025;

    // Mouse-driven parallax (lerp towards target)
    const tx = pointer.x * 0.4;
    const ty = pointer.y * 0.3;
    dummy.current.rotX += (ty - dummy.current.rotX) * 0.025;
    dummy.current.rotY += (tx - dummy.current.rotY) * 0.025;

    mesh.rotation.x += dummy.current.rotX * 0.008;
    mesh.rotation.y += dummy.current.rotY * 0.008;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={positions.length / 3}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          args={[colors, 3]}
          count={colors.length / 3}
          array={colors}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.035}
        vertexColors
        transparent
        opacity={0.7}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/* ───────────────────────────────────────────────
   Scene — wraps ParticleField + subtle ambient
   ─────────────────────────────────────────────── */
function Scene({ mouse }: ParticleFieldProps) {
  return (
    <>
      <ambientLight intensity={0.2} />
      <ParticleField mouse={mouse} />
    </>
  );
}

/* ───────────────────────────────────────────────
   Public component — mounts the R3F Canvas
   ─────────────────────────────────────────────── */
interface ParticleMeshProps {
  mouseRef: React.MutableRefObject<{ x: number; y: number }>;
}

export default function ParticleMesh({ mouseRef }: ParticleMeshProps) {
  return (
    <Canvas
      camera={{ position: [0, 0, 5.5], fov: 45 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true }}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      <Scene mouse={mouseRef} />
    </Canvas>
  );
}
