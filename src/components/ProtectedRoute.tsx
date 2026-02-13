import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

type ProtectedRouteProps = {
  children: ReactNode
  requireAdmin?: boolean
  /** When true, skip the must_change_password redirect (used for the change-password page itself) */
  allowPasswordChange?: boolean
}

export function ProtectedRoute({ children, requireAdmin = false, allowPasswordChange = false }: ProtectedRouteProps) {
  const { user, isAdmin } = useAuth()
  const location = useLocation()

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Force password change on first login — redirect to /change-password
  if (user.must_change_password && !allowPasswordChange) {
    return <Navigate to="/change-password" replace />
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}

