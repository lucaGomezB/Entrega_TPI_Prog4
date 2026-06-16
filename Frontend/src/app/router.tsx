/**
 * AppRouter — Pure component that returns role-based route definitions.
 *
 * Receives role flags as props and returns <Routes> with the appropriate
 * route set for each role. No side effects, no state, no API calls.
 *
 * Cross-feature imports follow the rule: only API modules from other features.
 */
import { Routes, Route, Navigate } from 'react-router-dom'
import CategoriasCRUD from '@/features/categorias/pages/CategoriasCRUD'
import IngredientesCRUD from '@/features/productos/pages/IngredientesCRUD'
import ProductosCRUD from '@/features/productos/pages/ProductosCRUD'
import ProductosCliente from '@/features/productos/pages/ProductosCliente'
import Carrito from '@/features/pedidos/pages/Carrito'
import PedidosPage from '@/features/pedidos/pages/PedidosPage'
import DireccionesPage from '@/features/pedidos/pages/DireccionesPage'
import AdminUsuariosPage from '@/features/auth/pages/AdminUsuariosPage'
import Dashboard from '@/features/estadisticas/pages/Dashboard'
import Login from '@/features/auth/pages/LoginConceptual'

/* ── Helpers ── */

function hasRole(roles: string[], ...allowed: string[]) {
  return allowed.some((r) => roles.includes(r));
}

/* ── Props ── */

export interface AppRoutesProps {
  roles: string[]
  isGuest: boolean
  isClient: boolean
  isStock: boolean
  isPedidos: boolean
}

/* ── Component ── */

export function AppRoutes({ roles, isGuest, isClient, isStock, isPedidos }: AppRoutesProps) {
  let productRole: 'admin' | 'stock' | 'pedidos' | 'client';
  if (isClient || isGuest) productRole = 'client';
  else if (hasRole(roles, 'ADMIN')) productRole = 'admin';
  else if (hasRole(roles, 'STOCK')) productRole = 'stock';
  else productRole = 'pedidos';

  if (isClient) {
    return (
      <Routes>
        <Route path="/" element={<Navigate to="/productos" replace />} />
        <Route path="/productos" element={<ProductosCliente />} />
        {!isGuest && <Route path="/carrito" element={<Carrito />} />}
        <Route path="/pedidos" element={<PedidosPage />} />
        <Route path="/pedidos/:id" element={<PedidosPage />} />
        <Route path="/direcciones" element={<DireccionesPage />} />
        <Route path="*" element={<Navigate to="/productos" replace />} />
      </Routes>
    );
  }
  if (isStock) {
    return (
      <Routes>
        <Route path="/" element={<Navigate to="/productos" replace />} />
        <Route path="/productos" element={<ProductosCRUD role={productRole} />} />
        <Route path="*" element={<Navigate to="/productos" replace />} />
      </Routes>
    );
  }
  if (isPedidos) {
    return (
      <Routes>
        <Route path="/" element={<Navigate to="/pedidos" replace />} />
        <Route path="/pedidos" element={<PedidosPage />} />
        <Route path="/pedidos/:id" element={<PedidosPage />} />
        <Route path="*" element={<Navigate to="/pedidos" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/productos" replace />} />
      <Route path="/categorias" element={<CategoriasCRUD />} />
      <Route path="/ingredientes" element={<IngredientesCRUD />} />
      <Route path="/admin/usuarios" element={<AdminUsuariosPage />} />
      <Route path="/admin/dashboard" element={<Dashboard />} />
      <Route path="/productos" element={
        productRole === 'client' ? <ProductosCliente /> : <ProductosCRUD role={productRole} />
      } />
      {!isGuest && <Route path="/carrito" element={<Carrito />} />}
      <Route path="/pedidos" element={<PedidosPage />} />
      <Route path="/pedidos/:id" element={<PedidosPage />} />
      <Route path="/direcciones" element={<DireccionesPage />} />
      <Route path="*" element={<Navigate to="/productos" replace />} />
    </Routes>
  );
}

/**
 * UnauthenticatedRoutes — Only shown when roles === null.
 * Only the login page is accessible; everything else redirects to /login.
 */
export function UnauthenticatedRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
