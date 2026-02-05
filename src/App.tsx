import Login from '@/page/login/login'
import Home from '@/page/home/home'
import Documents from '@/page/document/document'
import Landing from '@/page/landing/landing'
import { Routes, Route } from 'react-router-dom'
import Dashboard from '@/page/dashboard/dashboard'
import DashboardHome from '@/page/dashboard/DashboardHome'
import DocumentSection from '@/page/dashboard/DocumentSection'
import { AuthProvider } from '@/contexts/AuthContext'
import { DocumentsProvider } from '@/contexts/DocumentsContext'

export default function App() {
  return (
    <AuthProvider>
      <DocumentsProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/home" element={<Home />} />
          <Route path="/document" element={<Documents />} />
          <Route path="/dashboard" element={<Dashboard />}>
            <Route index element={<DashboardHome />} />
            <Route path="documents/formation" element={<DocumentSection />} />
            <Route path="documents/mode-operation" element={<DocumentSection />} />
            <Route path="documents/mode-operation/gestion-projet" element={<DocumentSection />} />
            <Route
              path="documents/mode-operation/reglement-interieur"
              element={<DocumentSection />}
            />
            <Route path="documents/mode-operation/gestion-personnel" element={<DocumentSection />} />
          </Route>
        </Routes>
      </DocumentsProvider>
    </AuthProvider>
  )
}