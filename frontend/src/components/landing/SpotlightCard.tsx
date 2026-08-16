'use client'

import React, { useRef, useState, useCallback } from 'react'

interface SpotlightCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  className?: string
  spotlightColor?: string
  spotlightSize?: number
  spotlightOpacity?: number
  as?: React.ElementType
}

export default function SpotlightCard({
  children,
  className = '',
  spotlightColor = 'rgba(20, 184, 166, 0.16)',
  spotlightSize = 320,
  spotlightOpacity = 1,
  as: Component = 'div',
  ...props
}: SpotlightCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isHovered, setIsHovered] = useState(false)

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    setPosition({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
  }, [])

  const handleMouseEnter = useCallback(() => setIsHovered(true), [])
  const handleMouseLeave = useCallback(() => setIsHovered(false), [])

  return (
    <Component
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`
        relative overflow-hidden rounded-2xl
        bg-gradient-to-b from-white/[0.07] via-white/[0.03] to-white/[0.015]
        border border-white/[0.07] hover:border-white/[0.14]
        shadow-card-ambient hover:shadow-card-hover
        transition-all duration-300 ease-expo-out
        hover:-translate-y-1
        backdrop-blur-md
        ${className}
      `}
      {...props}
    >
      {/* 1px Top Edge Hairline Highlight */}
      <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none z-10" />

      {/* Mouse Tracking Radial Spotlight Glow */}
      <div
        className="pointer-events-none absolute -inset-px transition-opacity duration-300 ease-expo-out z-0"
        style={{
          opacity: isHovered ? spotlightOpacity : 0,
          background: `radial-gradient(${spotlightSize}px circle at ${position.x}px ${position.y}px, ${spotlightColor}, transparent 80%)`,
        }}
      />

      {/* Inner Card Content */}
      <div className="relative z-10 h-full">{children}</div>
    </Component>
  )
}
