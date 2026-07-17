'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AuthProvider, useAuth } from '@/lib/auth-context'
import { useTheme } from '@/lib/theme-context'
import { clearOfflineCache } from '@/lib/offline-cache'
import {
  LayoutDashboard, Truck, BookOpen, Users, Calendar,
  DollarSign, Settings, LogOut, TrendingUp, FileText,
  UserCheck, Shield, Sun, Moon, Menu
} from 'lucide-react'
import { featureForPath } from '@/lib/features'
import toast from 'react-hot-toast'

function NavContent() {
  const pathname = usePathname()
  const router = useRouter()
  const {
    user, isAdmin, isSiteManager, isStakeholder, isSiteEmployee, isEmployee,
    isPlatformOwner, organizationName, hasFeature, loading: authLoading, userRole,
  } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const supabase = createClient()
  const [showMoreMenu, setShowMoreMenu] = useState(false)

  // Platform owners should never live in the tenant shell
  useEffect(() => {
    if (authLoading) return
    if (isPlatformOwner) {
      router.replace('/platform')
    }
  }, [authLoading, isPlatformOwner, router])

  // Enforce org feature entitlements on deep links (nav already hides disabled modules)
  useEffect(() => {
    if (authLoading || isPlatformOwner) return
    const required = featureForPath(pathname)
    if (required && !hasFeature(required)) {
      toast.error('This module is not enabled for your organization')
      router.replace('/dashboard')
    }
  }, [authLoading, isPlatformOwner, pathname, hasFeature, router])

  const handleLogout = async () => {
    clearOfflineCache()
    await supabase.auth.signOut()
    router.push('/')
  }

  type NavItem = {
    href: string
    icon: typeof LayoutDashboard
    label: string
    roles: string[]
    feature?: Parameters<typeof hasFeature>[0]
  }

  // Build nav items based on role + org feature entitlements
  const operationsNav: NavItem[] = [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ['admin', 'site_manager', 'stakeholder'] },
    { href: '/dashboard/my-work', icon: LayoutDashboard, label: 'Home', roles: ['employee', 'site_employee'] },
    { href: '/dashboard/trips', icon: Truck, label: 'Trips', roles: ['admin', 'site_manager'], feature: 'trips' },
    { href: '/dashboard/cash-book', icon: BookOpen, label: 'Cash Book', roles: ['admin', 'site_manager'], feature: 'cash_book' },
    { href: '/dashboard/attendance', icon: Calendar, label: 'Attendance', roles: ['admin', 'site_manager'], feature: 'attendance' },
    { href: '/dashboard/leave', icon: FileText, label: 'Leave', roles: ['admin', 'site_manager'], feature: 'leave' },
    { href: '/dashboard/payroll', icon: DollarSign, label: 'Payroll', roles: ['admin', 'site_manager'], feature: 'payroll' },
    { href: '/dashboard/reports', icon: TrendingUp, label: 'Reports', roles: ['admin', 'site_manager'], feature: 'reports' },
    { href: '/dashboard/stakeholder', icon: TrendingUp, label: 'My Dashboard', roles: ['stakeholder'], feature: 'stakeholder' },
  ]

  const mgmtNav: NavItem[] = [
    { href: '/dashboard/manage-employees', icon: Users, label: 'Employees', roles: ['admin', 'site_manager'], feature: 'manage_employees' },
    { href: '/dashboard/settings', icon: Settings, label: 'Master Data', roles: ['admin'], feature: 'master_data' },
    { href: '/dashboard/users', icon: Shield, label: 'User Access', roles: ['admin'], feature: 'users' },
  ]

  const roleAllows = (item: NavItem) =>
    (isAdmin && item.roles.includes('admin')) ||
    (isSiteManager && item.roles.includes('site_manager')) ||
    (isStakeholder && item.roles.includes('stakeholder')) ||
    ((isEmployee || isSiteEmployee) && item.roles.some((r) => r === 'employee' || r === 'site_employee'))

  const featureAllows = (item: NavItem) => !item.feature || hasFeature(item.feature)

  const visibleOps = operationsNav.filter((item) => roleAllows(item) && featureAllows(item))

  const visibleMgmt = mgmtNav.filter((item) => roleAllows(item) && featureAllows(item))

  const drawerItems = [
    { href: '/dashboard/attendance', icon: Calendar, label: 'Attendance', roles: ['admin', 'site_manager'], feature: 'attendance' as const },
    { href: '/dashboard/leave', icon: FileText, label: 'Leave', roles: ['admin', 'site_manager'], feature: 'leave' as const },
    { href: '/dashboard/payroll', icon: DollarSign, label: 'Payroll', roles: ['admin', 'site_manager'], feature: 'payroll' as const },
    { href: '/dashboard/reports', icon: TrendingUp, label: 'Reports', roles: ['admin', 'site_manager'], feature: 'reports' as const },
    { href: '/dashboard/manage-employees', icon: Users, label: 'Employees', roles: ['admin', 'site_manager'], feature: 'manage_employees' as const },
    { href: '/dashboard/settings', icon: Settings, label: 'Master Data', roles: ['admin'], feature: 'master_data' as const },
    { href: '/dashboard/users', icon: Shield, label: 'User Access', roles: ['admin'], feature: 'users' as const },
  ].filter((item) => roleAllows(item) && featureAllows(item))

  const roleColor = isAdmin ? 'var(--accent)' : isSiteManager ? 'var(--info)' : (isSiteEmployee || isEmployee) ? 'var(--success)' : 'var(--success)'
  
  const rolesList: string[] = []
  if (isPlatformOwner) rolesList.push('Platform owner')
  if (isAdmin) rolesList.push('Admin')
  if (isSiteManager) rolesList.push('Site Manager')
  if (isStakeholder) rolesList.push('Stakeholder')
  if (isSiteEmployee) rolesList.push('Site Employee')
  else if (isEmployee) rolesList.push('Employee')
  const roleLabel = rolesList.join(' + ') || 'No Role Assigned'
  const hasNoTenantRole = !userRole && !isPlatformOwner

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
          {hasNoTenantRole && (
            <div style={{
              margin: '0.5rem 0.75rem 1rem',
              padding: '0.75rem',
              borderRadius: 'var(--radius)',
              background: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.3)',
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.4,
            }}>
              <strong style={{ color: 'var(--accent)' }}>No tenant role</strong>
              <p style={{ margin: '0.35rem 0 0.5rem' }}>
                This account is not a site admin. If you are the platform operator, open the platform console or complete setup.
              </p>
              <Link href="/platform" className="btn btn-primary btn-sm" style={{ width: '100%', marginBottom: 6 }}>
                Open /platform
              </Link>
              <Link href="/platform/setup" className="btn btn-secondary btn-sm" style={{ width: '100%' }}>
                First-time setup
              </Link>
            </div>
          )}
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
              <div style={{ fontSize: '0.65rem', color: roleColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {roleLabel}{organizationName ? ` · ${organizationName}` : ''}
              </div>
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

      {/* Mobile More Menu Bottom Sheet */}
      {showMoreMenu && (
        <>
          <div 
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.5)',
              zIndex: 999,
              backdropFilter: 'blur(4px)',
            }}
            onClick={() => setShowMoreMenu(false)}
          />
          <div 
            style={{
              position: 'fixed',
              bottom: '56px',
              left: 0,
              right: 0,
              background: 'var(--bg-elevated)',
              borderTopLeftRadius: '16px',
              borderTopRightRadius: '16px',
              padding: '1.25rem 1rem',
              zIndex: 1000,
              maxHeight: '70vh',
              overflowY: 'auto',
              boxShadow: '0 -4px 20px rgba(0,0,0,0.3)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.625rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
              <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>More Operations</span>
              <button 
                onClick={() => setShowMoreMenu(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 500 }}
              >
                Close
              </button>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.625rem' }}>
              {drawerItems.map(item => {
                const isItemActive = pathname.startsWith(item.href)
                return (
                  <Link 
                    key={item.href} 
                    href={item.href} 
                    onClick={() => setShowMoreMenu(false)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.625rem',
                      padding: '0.75rem',
                      borderRadius: 'var(--radius)',
                      background: isItemActive ? 'rgba(245,158,11,0.1)' : 'var(--bg-secondary)',
                      color: isItemActive ? 'var(--accent)' : 'var(--text-secondary)',
                      textDecoration: 'none',
                      fontSize: '0.8rem',
                      fontWeight: 500,
                      border: isItemActive ? '1px solid rgba(245,158,11,0.3)' : '1px solid transparent',
                    }}
                  >
                    <item.icon size={16} />
                    <span>{item.label}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* Mobile Bottom Nav */}
      <nav className="bottom-nav">
        {isStakeholder ? (
          <>
            <Link href="/dashboard" className={`bottom-nav-item ${pathname === '/dashboard' ? 'active' : ''}`}>
              <LayoutDashboard size={22} />
              <span className="bottom-nav-label">Dashboard</span>
            </Link>
            <Link href="/dashboard/stakeholder" className={`bottom-nav-item ${pathname === '/dashboard/stakeholder' ? 'active' : ''}`}>
              <TrendingUp size={22} />
              <span className="bottom-nav-label">Summary</span>
            </Link>
          </>
        ) : (isSiteEmployee || isEmployee) ? (
          <>
            <Link href="/dashboard/my-work" className={`bottom-nav-item ${pathname === '/dashboard/my-work' ? 'active' : ''}`}>
              <LayoutDashboard size={22} />
              <span className="bottom-nav-label">Home</span>
            </Link>
            <Link href="/dashboard/trips" className={`bottom-nav-item ${pathname.startsWith('/dashboard/trips') ? 'active' : ''}`}>
              <Truck size={22} />
              <span className="bottom-nav-label">Log Trip</span>
            </Link>
            <Link href="/dashboard/cash-book" className={`bottom-nav-item ${pathname.startsWith('/dashboard/cash-book') ? 'active' : ''}`}>
              <BookOpen size={22} />
              <span className="bottom-nav-label">Expense</span>
            </Link>
          </>
        ) : (
          <>
            <Link href="/dashboard" className={`bottom-nav-item ${pathname === '/dashboard' ? 'active' : ''}`}>
              <LayoutDashboard size={22} />
              <span className="bottom-nav-label">Dashboard</span>
            </Link>
            <Link href="/dashboard/trips" className={`bottom-nav-item ${pathname.startsWith('/dashboard/trips') ? 'active' : ''}`}>
              <Truck size={22} />
              <span className="bottom-nav-label">Trips</span>
            </Link>
            <Link href="/dashboard/cash-book" className={`bottom-nav-item ${pathname.startsWith('/dashboard/cash-book') ? 'active' : ''}`}>
              <BookOpen size={22} />
              <span className="bottom-nav-label">Cash Book</span>
            </Link>
            <button 
              onClick={() => setShowMoreMenu(prev => !prev)} 
              className={`bottom-nav-item ${showMoreMenu || drawerItems.some(item => pathname.startsWith(item.href)) ? 'active' : ''}`}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              <Menu size={22} />
              <span className="bottom-nav-label">More</span>
            </button>
          </>
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
