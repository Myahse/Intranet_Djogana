import Login from '@/page/login/login'
import Home from '@/page/home/home'
import Documents from '@/page/document/document'
import Landing from '@/page/landing/landing'
import { Routes, Route } from 'react-router-dom'
import Dashboard from '@/page/dashboard/dashboard'
import DashboardHome from '@/page/dashboard/DashboardHome'
import DocumentSection from '@/page/dashboard/DocumentSection'
import DocumentPreviewPage from '@/page/preview/DocumentPreviewPage'
import { AuthProvider } from '@/contexts/AuthContext'
import { DocumentsProvider } from '@/contexts/DocumentsContext'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import AdminPage from '@/page/admin/admin'

export default function App() {
  return (
    <AuthProvider>
      <DocumentsProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/home" element={<Home />} />
          <Route path="/document" element={<Documents />} />
          <Route path="/preview" element={<DocumentPreviewPage />} />
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