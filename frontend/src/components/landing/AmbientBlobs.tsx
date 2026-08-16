'use client'

import React from 'react'

export default function AmbientBlobs() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
      {/* Layer 1: Deep Space Base Radial Gradient */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at top, #0a0a0f 0%, #050506 50%, #020203 100%)',
        }}
      />

      {/* Layer 2: SVG Noise Texture for tactile quality */}
      <svg
        className="absolute inset-0 w-full h-full opacity-[0.018] mix-blend-overlay"
        xmlns="http://www.w3.org/2000/svg"
      >
        <filter id="linear-noise-filter">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.75"
            numOctaves="3"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#linear-noise-filter)" />
      </svg>

      {/* Layer 3: Technical Precision Grid Overlay (64px) */}
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(255, 255, 255, 0.15) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255, 255, 255, 0.15) 1px, transparent 1px)
          `,
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at 50% 30%, black 40%, transparent 85%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 30%, black 40%, transparent 85%)',
        }}
      />

      {/* Layer 4: Cinematic Animated Floating Gradient Blobs */}
      {/* Primary Blob: Top-Center Accent Glow */}
      <div
        className="absolute -top-[15%] left-1/2 -translate-x-1/2 w-[900px] h-[550px] md:w-[1200px] md:h-[700px] rounded-full blur-[140px] opacity-25 animate-float-slow"
        style={{
          background: 'radial-gradient(circle, #5E6AD2 0%, #3B82F6 40%, transparent 70%)',
        }}
      />

      {/* Secondary Blob: Left Purple Ambient Glow */}
      <div
        className="absolute top-[25%] -left-[10%] w-[500px] h-[650px] md:w-[750px] md:h-[900px] rounded-full blur-[130px] opacity-15 animate-float-delayed"
        style={{
          background: 'radial-gradient(circle, #8B5CF6 0%, #6366F1 50%, transparent 75%)',
        }}
      />

      {/* Tertiary Blob: Right Cyan/Indigo Accent Glow */}
      <div
        className="absolute top-[45%] -right-[10%] w-[500px] h-[650px] md:w-[700px] md:h-[850px] rounded-full blur-[120px] opacity-12 animate-float-reverse"
        style={{
          background: 'radial-gradient(circle, #38BDF8 0%, #5E6AD2 50%, transparent 70%)',
        }}
      />

      {/* Bottom Subtle Center Pulse Glow */}
      <div
        className="absolute bottom-[5%] left-1/2 -translate-x-1/2 w-[700px] h-[350px] md:w-[1000px] md:h-[450px] rounded-full blur-[150px] opacity-15 animate-pulse-glow"
        style={{
          background: 'radial-gradient(circle, #5E6AD2 0%, #4338CA 50%, transparent 75%)',
        }}
      />
    </div>
  )
}
