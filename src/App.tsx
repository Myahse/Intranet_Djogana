import Login from '@/page/login'
import Home from '@/page/home'
import Documents from '@/page/document'
import Landing from '@/page/landing'
import { Routes, Route } from 'react-router-dom'
import Dashboard from '@/page/dashboard'
import DashboardHome from '@/page/dashboard/dashboard-home'
import DocumentSection from '@/page/dashboard/document-section'
import DocumentPreviewPage from '@/page/preview'
import ForceChangePasswordPage from '@/page/dashboard/force-change-password'
import { AuthProvider } from '@/contexts/AuthContext'
import { DocumentsProvider } from '@/contexts/DocumentsContext'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import AdminPage from '@/page/admin'
import Corbeille from '@/page/dashboard/corbeille'
import LiveActivityPage from '@/page/admin/LiveActivityPage'
import PageTransition from '@/components/PageTransition'

export default function App() {
  return (
    <AuthProvider>
      <DocumentsProvider>
        <Routes>
          <Route path="/" element={<PageTransition><Landing /></PageTransition>} />
          <Route path="/login" element={<PageTransition><Login /></PageTransition>} />
          <Route path="/home" element={<PageTransition><Home /></PageTransition>} />
          <Route path="/document" element={<PageTransition><Documents /></PageTransition>} />
          <Route path="/preview" element={<DocumentPreviewPage />} />
          <Route
            path="/change-password"
            element={
              <ProtectedRoute allowPasswordChange>
                <ForceChangePasswordPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardHome />} />
            <Route path="documents" element={<DocumentSection />} />
            <Route path="documents/:folder" element={<DocumentSection />} />
            <Route path="direction/:directionId" element={<DocumentSection />} />
            <Route path="corbeille" element={<Corbeille />} />
            <Route path="stats" element={<AdminPage />} />
            <Route path="live" element={<LiveActivityPage />} />
          </Route>
          <Route
            path="/admin"
            element={
              <ProtectedRoute requireAdmin>
                <AdminPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </DocumentsProvider>
    </AuthProvider>
  )
}
