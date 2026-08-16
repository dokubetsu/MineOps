'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Menu, X, ArrowRight, ShieldCheck, Activity } from 'lucide-react'

interface LandingNavbarProps {
  onOpenSignIn: () => void
}

export default function LandingNavbar({ onOpenSignIn }: LandingNavbarProps) {
  const [isScrolled, setIsScrolled] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <header
      className={`
        fixed top-0 inset-x-0 z-50 transition-all duration-300 ease-expo-out
        ${isScrolled
          ? 'bg-[#050506]/85 backdrop-blur-xl border-b border-white/[0.07] py-3.5 shadow-[0_4px_30px_rgba(0,0,0,0.5)]'
          : 'bg-transparent py-5'
        }
      `}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
        {/* Brand Mark */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-white/10 to-white/[0.03] border border-white/15 p-1.5 shadow-[0_0_15px_rgba(94,106,210,0.25)] group-hover:border-accent/50 transition-colors duration-200">
            <Image
              src="/logo.png"
              alt="Khani ERP"
              width={36}
              height={36}
              className="w-full h-full object-contain"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-lg tracking-tight text-white group-hover:text-indigo-200 transition-colors">
              Khani
            </span>
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium tracking-wide uppercase bg-accent/15 border border-accent/30 text-indigo-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              MineOps Core
            </span>
          </div>
        </Link>

        {/* Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-foreground-muted">
          <a
            href="#features"
            className="hover:text-white transition-colors duration-200"
          >
            Modules
          </a>
          <a
            href="#live-preview"
            className="hover:text-white transition-colors duration-200 flex items-center gap-1.5"
          >
            <Activity size={14} className="text-accent" />
            Live Cockpit
          </a>
          <a
            href="#architecture"
            className="hover:text-white transition-colors duration-200"
          >
            Architecture
          </a>
          <a
            href="#security"
            className="hover:text-white transition-colors duration-200 flex items-center gap-1.5"
          >
            <ShieldCheck size={14} className="text-indigo-400" />
            Security &amp; Offline
          </a>
        </nav>

        {/* Desktop Actions */}
        <div className="hidden md:flex items-center gap-4">
          <button
            type="button"
            onClick={onOpenSignIn}
            className="text-sm font-medium text-foreground-muted hover:text-white px-3 py-2 rounded-lg hover:bg-white/[0.05] transition-all duration-200"
          >
            Sign In
          </button>

          <button
            type="button"
            onClick={onOpenSignIn}
            className="relative group overflow-hidden inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-accent hover:bg-accent-bright shadow-accent-cta transition-all duration-200 ease-expo-out hover:shadow-[0_0_24px_rgba(94,106,210,0.5)] active:scale-[0.98]"
          >
            {/* Hover shine effect sweep */}
            <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-in-out" />
            <span>Launch Platform</span>
            <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform duration-200" />
          </button>
        </div>

        {/* Mobile Hamburger Toggle Button */}
        <div className="flex md:hidden items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-lg text-foreground-muted hover:text-white bg-white/[0.05] border border-white/10 hover:border-white/20 transition-colors"
            aria-label={mobileMenuOpen ? 'Close Menu' : 'Open Menu'}
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile Slide-down Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden mt-3 px-4 pt-2 pb-6 bg-[#050506]/95 backdrop-blur-2xl border-b border-white/[0.08] shadow-2xl transition-all duration-200 animate-in fade-in slide-in-from-top-2">
          <nav className="flex flex-col gap-3 text-sm font-medium text-foreground-muted mb-5">
            <a
              href="#features"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-lg hover:bg-white/[0.05] hover:text-white transition-colors"
            >
              Modules &amp; Operations
            </a>
            <a
              href="#live-preview"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-lg hover:bg-white/[0.05] hover:text-white transition-colors"
            >
              Live Cockpit
            </a>
            <a
              href="#architecture"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-lg hover:bg-white/[0.05] hover:text-white transition-colors"
            >
              Architecture
            </a>
            <a
              href="#security"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-lg hover:bg-white/[0.05] hover:text-white transition-colors"
            >
              Security &amp; Offline
            </a>
          </nav>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false)
                onOpenSignIn()
              }}
              className="w-full py-2.5 rounded-lg text-sm font-semibold text-white bg-accent hover:bg-accent-bright shadow-accent-cta flex items-center justify-center gap-2"
            >
              Sign In to MineOps
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}
    </header>
  )
}
