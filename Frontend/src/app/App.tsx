/**
 * App — Thin application shell.
 *
 * Responsibilities:
 *  - Bootstrap session verification on mount (httpOnly refresh cookie).
 *  - Derive role flags (isGuest, isClient, isAdmin, etc.).
 *  - Build navigation items based on role.
 *  - Render layout: nav bar + main content (delegates to AppRoutes) + session timeout modal.
 *
 * Route definitions live in router.tsx. App.tsx contains NO inline route definitions.
 */
import { NavLink, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { AppRoutes, UnauthenticatedRoutes } from './router'
import SessionTimeoutModal from '@/features/auth/components/SessionTimeoutModal'
import { apiFetch, getAccessToken, refreshSession } from '@/shared/api/client'
import type { UserInfo } from '@/shared/api/client'
import { useCartStore } from '@/shared/store/cartStore'
import { useAuthStore } from '@/shared/store/authStore'

/* ── Helpers ── */

function hasRole(roles: string[], ...allowed: string[]) {
  return allowed.some((r) => roles.includes(r));
}

function App() {
  const [verifying, setVerifying] = useState(true)
  const roles = useAuthStore((s) => s.roles)
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const cartCount = useCartStore((s) => s.getItemCount())

  useEffect(() => {
    async function bootstrap() {
      useCartStore.getState().hydrate();

      const { accessToken, expiresAt } = useAuthStore.getState()

      if (accessToken && expiresAt && Date.now() < expiresAt) {
        try {
          const user = await apiFetch<UserInfo>('/auth/me')
          useAuthStore.getState().setUser(user)
          useCartStore.getState().hydrate();
          setVerifying(false)
          return
        } catch {
          // Token invalid — fall through to try refresh or logout
        }
      }

      const hasSession = await refreshSession()

      if (!hasSession) {
        useAuthStore.getState().logout()
        useCartStore.getState().hydrate();
        setVerifying(false)
        return
      }

      try {
        const user = await apiFetch<UserInfo>('/auth/me')
        useAuthStore.getState().setUser(user)
        useCartStore.getState().hydrate();
      } catch {
        useCartStore.getState().hydrate();
      }
      setVerifying(false)
    }

    bootstrap()
  }, [])

  const handleLogout = async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' })
    } catch {
      // If the server call fails, still clear local state.
    }
    useAuthStore.getState().logout()
    useCartStore.getState().hydrate()
    navigate('/login')
  }

  // ── Loading state ──
  if (verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Verificando sesion...</p>
      </div>
    )
  }

  // ── Unauthenticated state ──
  if (roles === null) {
    return <UnauthenticatedRoutes />
  }

  // ── Role-based flags ──
  const isGuest = !getAccessToken();
  const isClient = !isGuest && !hasRole(roles, 'ADMIN', 'STOCK', 'PEDIDOS')
  const isAdmin = hasRole(roles, 'ADMIN')
  const isStock = hasRole(roles, 'STOCK')
  const isPedidos = hasRole(roles, 'PEDIDOS')

  // ── Navigation items ──
  let navItems: { to: string; label: string }[];
  if (isGuest) {
    navItems = [{ to: '/productos', label: 'Menu' }];
  } else if (isClient) {
    navItems = [
      { to: '/productos', label: 'Menu' },
      { to: '/pedidos', label: 'Mis Pedidos' },
      { to: '/direcciones', label: 'Direcciones' },
      { to: '/carrito', label: `Carrito${cartCount > 0 ? ` (${cartCount})` : ''}` },
    ];
  } else if (isStock) {
    navItems = [{ to: '/productos', label: 'Productos' }];
  } else if (isPedidos) {
    navItems = [{ to: '/pedidos', label: 'Pedidos' }];
  } else if (isAdmin) {
    navItems = [
      { to: '/categorias', label: 'Categorias' },
      { to: '/ingredientes', label: 'Ingredientes' },
      { to: '/productos', label: 'Productos' },
      { to: '/pedidos', label: 'Pedidos' },
      { to: '/direcciones', label: 'Direcciones' },
      { to: '/carrito', label: `Carrito${cartCount > 0 ? ` (${cartCount})` : ''}` },
    ];
    navItems.splice(0, 0, { to: '/admin/dashboard', label: 'Dashboard' });
    navItems.splice(1, 0, { to: '/admin/usuarios', label: 'Usuarios' });
  } else {
    navItems = [
      { to: '/productos', label: 'Productos' },
      { to: '/pedidos', label: 'Pedidos' },
      { to: '/direcciones', label: 'Direcciones' },
      { to: '/carrito', label: `Carrito${cartCount > 0 ? ` (${cartCount})` : ''}` },
    ];
  }

  return (
    <div className="min-h-screen bg-white">
      <nav className="bg-gray-800 text-white px-4 py-3 flex justify-between items-center">
        <div className="flex gap-4 items-center">
          <span className="font-bold mr-4">{isClient || isGuest ? 'Menu' : 'Catalogo de Productos'}</span>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `px-3 py-1 rounded ${isActive ? 'bg-gray-600' : 'hover:bg-gray-700'}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
        <div className="flex items-center gap-4">
          {!isGuest && (
            <span className="text-sm text-gray-300">{user?.email}</span>
          )}
          <button
            onClick={handleLogout}
            className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm transition-colors cursor-pointer"
          >
            Cerrar Sesion
          </button>
        </div>
      </nav>

      <main>
        <AppRoutes
          roles={roles}
          isGuest={isGuest}
          isClient={isClient}
          isStock={isStock}
          isPedidos={isPedidos}
        />
      </main>

      <SessionTimeoutModal />
    </div>
  )
}

export default App
