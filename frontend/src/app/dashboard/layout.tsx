'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AuthProvider, useAuth } from '@/lib/auth-context'
import { useTheme } from '@/lib/theme-context'
import {
  LayoutDashboard, Truck, BookOpen, Users, Calendar,
  DollarSign, Settings, LogOut, TrendingUp, FileText,
  UserCheck, Shield, Sun, Moon
} from 'lucide-react'

function NavContent() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, userRole, isAdmin, isSiteManager, isStakeholder } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const supabase = createClient()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  // Build nav items based on role
  const operationsNav = [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ['admin', 'site_manager', 'stakeholder'] },
    { href: '/dashboard/trips', icon: Truck, label: 'Trips', roles: ['admin', 'site_manager'] },
    { href: '/dashboard/cash-book', icon: BookOpen, label: 'Cash Book', roles: ['admin', 'site_manager'] },
    { href: '/dashboard/attendance', icon: Calendar, label: 'Attendance', roles: ['admin', 'site_manager'] },
    { href: '/dashboard/leave', icon: FileText, label: 'Leave', roles: ['admin', 'site_manager'] },
    { href: '/dashboard/payroll', icon: DollarSign, label: 'Payroll', roles: ['admin', 'site_manager'] },
    { href: '/dashboard/reports', icon: TrendingUp, label: 'Reports', roles: ['admin', 'site_manager'] },
    { href: '/dashboard/stakeholder', icon: TrendingUp, label: 'My Dashboard', roles: ['stakeholder'] },
  ]

  const mgmtNav = [
    { href: '/dashboard/employees', icon: Users, label: 'Employees', roles: ['admin', 'site_manager'] },
    { href: '/dashboard/settings', icon: Settings, label: 'Master Data', roles: ['admin'] },
    { href: '/dashboard/users', icon: Shield, label: 'User Access', roles: ['admin'] },
  ]

  const role = userRole?.role || 'site_manager'

  const visibleOps = operationsNav.filter(i => i.roles.includes(role))
  const visibleMgmt = mgmtNav.filter(i => i.roles.includes(role))

  const roleColor = isAdmin ? 'var(--accent)' : isSiteManager ? 'var(--info)' : 'var(--success)'
  const roleLabel = isAdmin ? 'Admin' : isSiteManager ? 'Site Manager' : 'Stakeholder'

  return (
    <>
      {/* Desktop Sidebar */}
      <nav className="sidebar">
        <div className="sidebar-logo">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <span style={{ fontSize: '1.5rem' }}>⛏️</span>
            <div>
              <div className="sidebar-logo-text">MineOps</div>
              <div className="sidebar-logo-sub">Logistics Platform</div>
            </div>
          </div>
        </div>

        <div className="sidebar-nav">
          <span className="sidebar-section-label">Operations</span>
          {visibleOps.map(item => (
            <Link key={item.href} href={item.href}
              className={`sidebar-item ${pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href)) ? 'active' : ''}`}>
              <item.icon size={18} strokeWidth={2} />
              {item.label}
            </Link>
          ))}

          {visibleMgmt.length > 0 && (
            <>
              <span className="sidebar-section-label" style={{ marginTop: '0.5rem' }}>Management</span>
              {visibleMgmt.map(item => (
                <Link key={item.href} href={item.href}
                  className={`sidebar-item ${pathname.startsWith(item.href) ? 'active' : ''}`}>
                  <item.icon size={18} strokeWidth={2} />
                  {item.label}
                </Link>
              ))}
            </>
          )}
        </div>

        {/* User section */}
        <div style={{ padding: '1rem 0.75rem', borderTop: '1px solid var(--border)' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            padding: '0.5rem 0.875rem', borderRadius: 'var(--radius)',
            background: 'var(--bg-elevated)',
          }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '50%',
              background: `rgba(${isAdmin ? '245,158,11' : isSiteManager ? '59,130,246' : '16,185,129'},0.15)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: roleColor, fontSize: '0.8rem', fontWeight: 700,
            }}>
              {user?.email?.[0]?.toUpperCase() || 'U'}
            </div>
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.email?.split('@')[0] || 'User'}
              </div>
              <div style={{ fontSize: '0.65rem', color: roleColor }}>{roleLabel}</div>
            </div>
            <button onClick={toggleTheme} className="btn-ghost btn btn-icon" title="Toggle theme">
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <button onClick={handleLogout} className="btn-ghost btn btn-icon" title="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Header */}
      <header className="mobile-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.25rem' }}>⛏️</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--accent)' }}>MineOps</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: '999px', background: `rgba(${isAdmin ? '245,158,11' : isSiteManager ? '59,130,246' : '16,185,129'},0.15)`, color: roleColor, fontWeight: 600 }}>
            {roleLabel}
          </span>
          <button onClick={toggleTheme} className="btn btn-ghost btn-icon" title="Toggle theme">
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button onClick={handleLogout} className="btn btn-ghost btn-icon"><LogOut size={18} /></button>
        </div>
      </header>

      {/* Mobile Bottom Nav — role-aware */}
      <nav className="bottom-nav">
        {visibleOps.slice(0, 5).map(item => {
          const isActive = item.href === '/dashboard' ? pathname === item.href : pathname.startsWith(item.href)
          return (
            <Link key={item.href} href={item.href}
              className={`bottom-nav-item ${isActive ? 'active' : ''}`}>
              <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
              <span className="bottom-nav-label">{item.label.split(' ')[0]}</span>
            </Link>
          )
        })}
        {isAdmin && (
          <Link href="/dashboard/settings"
            className={`bottom-nav-item ${pathname.startsWith('/dashboard/settings') ? 'active' : ''}`}>
            <Settings size={22} />
            <span className="bottom-nav-label">Settings</span>
          </Link>
        )}
      </nav>
    </>
  )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <div className="app-shell">
        <NavContent />
        <main className="main-content">{children}</main>
      </div>
    </AuthProvider>
  )
}
