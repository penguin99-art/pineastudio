import { useEffect, useRef } from 'react';

interface OrbVisualizerProps {
  state: 'idle' | 'listening' | 'speaking' | 'thinking';
  size?: number;
  className?: string;
}

export default function OrbVisualizer({ state, size = 160, className = '' }: OrbVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const phaseRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const baseRadius = size * 0.25;

    function draw() {
      phaseRef.current += 0.02;
      const t = phaseRef.current;
      ctx.clearRect(0, 0, size, size);

      let radius = baseRadius;
      let glowColor = 'rgba(120, 160, 255, 0.15)';
      let coreColor = 'rgba(140, 180, 255, 0.9)';
      let pulseSpeed = 1;
      let pulseAmp = 0.05;

      if (state === 'listening') {
        glowColor = 'rgba(100, 200, 150, 0.2)';
        coreColor = 'rgba(120, 220, 170, 0.95)';
        pulseSpeed = 2.5;
        pulseAmp = 0.12;
      } else if (state === 'speaking') {
        glowColor = 'rgba(180, 140, 255, 0.2)';
        coreColor = 'rgba(200, 160, 255, 0.95)';
        pulseSpeed = 1.8;
        pulseAmp = 0.15;
      } else if (state === 'thinking') {
        glowColor = 'rgba(255, 200, 100, 0.15)';
        coreColor = 'rgba(255, 210, 120, 0.9)';
        pulseSpeed = 3;
        pulseAmp = 0.08;
      }

      const pulse = 1 + Math.sin(t * pulseSpeed) * pulseAmp;
      radius *= pulse;

      // Outer glow
      const gradient = ctx.createRadialGradient(cx, cy, radius * 0.5, cx, cy, radius * 2.5);
      gradient.addColorStop(0, glowColor);
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);

      // Core orb
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      coreGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      coreGrad.addColorStop(0.4, coreColor);
      coreGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      // Wave ring for speaking/listening
      if (state === 'speaking' || state === 'listening') {
        const waveRadius = radius * (1.3 + Math.sin(t * 3) * 0.1);
        ctx.strokeStyle = coreColor.replace('0.9', '0.3');
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, waveRadius, 0, Math.PI * 2);
        ctx.stroke();

        const waveRadius2 = radius * (1.6 + Math.cos(t * 2.5) * 0.1);
        ctx.strokeStyle = coreColor.replace('0.9', '0.15');
        ctx.beginPath();
        ctx.arc(cx, cy, waveRadius2, 0, Math.PI * 2);
        ctx.stroke();
      }

      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [state, size]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      className={className}
    />
  );
}
