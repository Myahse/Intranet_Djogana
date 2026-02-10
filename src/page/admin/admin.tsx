import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/contexts/AuthContext'

export default function AdminPage() {
  const { user } = useAuth()

  return (
    <div className="min-h-svh flex items-center justify-center px-4">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Administration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Espace réservé aux administrateurs pour la gestion des utilisateurs, des directions
            et des droits d&apos;accès.
          </p>
          {user && (
            <p className="text-sm">
              Connecté en tant que <span className="font-semibold">{user.identifiant}</span> (
              {user.role})
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

