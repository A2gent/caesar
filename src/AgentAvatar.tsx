/**
 * AgentAvatar — fluid sphere avatar driven by audio state.
 *
 * States:
 *   idle     — slow organic noise morphing, dim cool glow
 *   listening — faster morph, reacts to mic amplitude
 *   speaking  — pulsing morph, warm color shift
 *
 * Tech: React Three Fiber + custom vertex/fragment GLSL shader
 */

import React, { useRef, useMemo, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAvatarAudio } from './avatarAudio';

// ─── GLSL ───────────────────────────────────────────────────────────────────

// Classic 3D simplex noise (Ashima Arts / stegu)
const SIMPLEX_NOISE_GLSL = /* glsl */`
vec3 mod289(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+10.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314*r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g  = step(x0.yzx, x0.xyz);
  vec3 l  = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3  ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m*m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

const VERTEX_SHADER = /* glsl */`
${SIMPLEX_NOISE_GLSL}

uniform float uTime;
uniform float uAudioLevel;   // 0..1
uniform float uMode;         // 0=idle, 1=listening, 2=speaking

varying vec3 vNormal;
varying float vNoise;
varying float vMode;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vMode   = uMode;

  // Base noise frequency and amplitude per mode
  float baseFreq  = 1.8;
  float baseAmp   = 0.08;
  float timeScale = 0.5;

  if (uMode > 1.5) {
    // speaking
    baseFreq  = 2.2;
    baseAmp   = 0.13 + uAudioLevel * 0.20;
    timeScale = 1.4;
  } else if (uMode > 0.5) {
    // listening
    baseFreq  = 2.5;
    baseAmp   = 0.10 + uAudioLevel * 0.28;
    timeScale = 1.1;
  }

  // Multi-octave noise for organic feel
  vec3 p = position * baseFreq + uTime * timeScale;
  float n =
      snoise(p) * 1.00
    + snoise(p * 2.01 + 17.3) * 0.50
    + snoise(p * 4.03 + 31.1) * 0.25;

  vNoise = n;

  vec3 displaced = position + normal * n * baseAmp;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;


// Fragment shader: normal-based rim lighting (ShaderMaterial doesn't provide vViewPosition)
const FRAGMENT_SHADER_V2 = /* glsl */`
uniform float uTime;
uniform float uAudioLevel;
uniform float uMode;

varying vec3 vNormal;
varying float vNoise;
varying float vMode;

void main() {
  // Fake rim: dot of normal with camera-ish direction (0,0,1 in view space)
  float rim = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
  rim = pow(clamp(rim, 0.0, 1.0), 2.0);

  // Shimmer from noise
  float shimmer = vNoise * 0.5 + 0.5; // 0..1

  // Blue/white palette per mode
  vec3 coreColor;
  vec3 glowColor;

  if (uMode > 1.5) {
    // speaking: electric blue with white highlights
    float t = clamp(uAudioLevel * 0.7 + 0.2 + sin(uTime * 4.0) * 0.1, 0.0, 1.0);
    coreColor = mix(vec3(0.03, 0.20, 0.58), vec3(0.08, 0.58, 0.96), t);
    glowColor = vec3(0.90, 0.97, 1.00);
  } else if (uMode > 0.5) {
    // listening: vivid blue, closer to white at the rim
    float t = clamp(uAudioLevel * 0.8 + 0.1, 0.0, 1.0);
    coreColor = mix(vec3(0.05, 0.18, 0.52), vec3(0.12, 0.46, 0.88), t);
    glowColor = vec3(0.82, 0.92, 1.00);
  } else {
    // idle: calm but clearly blue
    float pulse = sin(uTime * 0.8) * 0.07 + 0.70;
    coreColor = vec3(0.06, 0.18, 0.48) * pulse;
    glowColor = vec3(0.78, 0.90, 1.00);
  }

  vec3 color = mix(coreColor, glowColor, rim * 0.68 + shimmer * 0.14);
  float whiteSpec = pow(clamp(rim, 0.0, 1.0), 4.0);
  color += vec3(0.22, 0.40, 0.75) * (0.18 + shimmer * 0.22);
  color += vec3(0.96, 0.99, 1.00) * whiteSpec * 0.55;

  // Brightness
  float bright = uMode > 1.5
    ? (1.00 + uAudioLevel * 0.24)
    : uMode > 0.5
      ? (0.95 + uAudioLevel * 0.30)
      : 0.86;
  color *= bright;

  float alpha = 0.90 + rim * 0.10;
  gl_FragColor = vec4(color, alpha);
}
`;

// ─── Sphere mesh ─────────────────────────────────────────────────────────────

interface FluidSphereProps {
  mode: number;   // 0 | 1 | 2
  level: number;  // 0..1
  cursorX: number; // -1..1
  cursorY: number; // -1..1
}

function FluidSphere({ mode, level, cursorX, cursorY }: FluidSphereProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const baseRotXRef = useRef(0);
  const baseRotYRef = useRef(0);

  const uniforms = useMemo(
    () => ({
      uTime:       { value: 0 },
      uAudioLevel: { value: 0 },
      uMode:       { value: 0 },
    }),
    [],
  );

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader:   VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER_V2,
        uniforms,
        transparent: true,
        side: THREE.FrontSide,
      }),
    [uniforms],
  );

  // Keep camera looking at origin
  useEffect(() => {
    camera.position.set(0, 0, 2.8);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  useFrame((_, delta) => {
    uniforms.uTime.value       += delta;
    uniforms.uAudioLevel.value  = level;
    uniforms.uMode.value        = mode;

    // Slow base rotation + subtle cursor parallax
    if (meshRef.current) {
      baseRotYRef.current += delta * (mode > 0 ? 0.35 : 0.14);
      baseRotXRef.current += delta * (mode > 0 ? 0.08 : 0.03);

      const targetX = baseRotXRef.current + cursorY * 0.16;
      const targetY = baseRotYRef.current + cursorX * 0.22;
      meshRef.current.rotation.x = THREE.MathUtils.lerp(meshRef.current.rotation.x, targetX, 0.10);
      meshRef.current.rotation.y = THREE.MathUtils.lerp(meshRef.current.rotation.y, targetY, 0.10);
    }
  });

  return (
    <mesh ref={meshRef} material={material}>
      <icosahedronGeometry args={[1, 5]} />
    </mesh>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

interface AgentAvatarProps {
  /** Override size (default 96px) */
  size?: number;
  className?: string;
}

// Global frequency data buffer reused across frames
const _freqData = new Uint8Array(128);

export function AgentAvatar({ size = 96, className }: AgentAvatarProps) {
  const { state } = useAvatarAudio();
  const levelRef = useRef(0);
  const rafRef   = useRef<number | null>(null);
  const [level, setLevel] = React.useState(0);
  const [cursor, setCursor] = React.useState({ x: 0, y: 0 });

  // Poll the analyser node for live mic level, or simulate speaking pulse
  const pollLevel = useCallback(() => {
    const { analyser, mode } = state;

    if (analyser && mode === 'listening') {
      analyser.getByteFrequencyData(_freqData);
      let sum = 0;
      for (let i = 0; i < _freqData.length; i++) {
        sum += _freqData[i];
      }
      const raw = sum / (_freqData.length * 255);
      levelRef.current = levelRef.current * 0.7 + raw * 3.0 * 0.3; // EMA + boost
      levelRef.current = Math.min(1, levelRef.current);
    } else if (mode === 'speaking') {
      // Fake organic pulse: slow sine + noise-like variation
      const t = performance.now() / 1000;
      const fake = 0.35 + Math.sin(t * 3.5) * 0.18 + Math.sin(t * 7.1) * 0.08;
      levelRef.current = levelRef.current * 0.75 + fake * 0.25;
    } else {
      levelRef.current *= 0.92; // decay to 0
    }

    setLevel(levelRef.current);
    rafRef.current = requestAnimationFrame(pollLevel);
  }, [state]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(pollLevel);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [pollLevel]);

  const modeNum = state.mode === 'speaking' ? 2 : state.mode === 'listening' ? 1 : 0;

  return (
    <div
      className={`agent-avatar${state.isRecording ? ' recording-active' : ''}${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
      aria-label={`Agent avatar (${state.mode})`}
      role="img"
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = ((event.clientY - rect.top) / rect.height) * 2 - 1;
        setCursor({ x: Math.max(-1, Math.min(1, nx)), y: Math.max(-1, Math.min(1, ny)) });
      }}
      onMouseLeave={() => setCursor({ x: 0, y: 0 })}
    >
      <Canvas
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
        camera={{ fov: 45, near: 0.1, far: 100 }}
      >
        <FluidSphere mode={modeNum} level={level} cursorX={cursor.x} cursorY={cursor.y} />
      </Canvas>
      {/* Mode indicator ring */}
      <div className={`agent-avatar-ring mode-${state.mode}`} />
    </div>
  );
}

export default AgentAvatar;
