import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { LogOut, KeyRound } from 'lucide-react'
import LoadingModal, { initialLoadingState, type LoadingState } from '@/components/LoadingModal'

const ProfilePage = (): ReactNode => {
  const navigate = useNavigate()
  const { user, logout, changePassword } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [loading, setLoading] = useState<LoadingState>(initialLoadingState)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      toast.error('Veuillez remplir tous les champs')
      return
    }

    if (newPassword !== confirmNewPassword) {
      toast.error('Les nouveaux mots de passe ne correspondent pas')
      return
    }

    setIsChangingPassword(true)
    setLoading({ open: true, message: 'Mise à jour du mot de passe…' })
    try {
      const ok = await changePassword(currentPassword, newPassword)
      if (ok) {
        setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Mot de passe mis à jour' }))
        toast.success('Mot de passe mis à jour')
        setCurrentPassword('')
        setNewPassword('')
        setConfirmNewPassword('')
      } else {
        setLoading((s) => ({ ...s, result: 'error', resultMessage: 'Mot de passe actuel incorrect' }))
        toast.error('Impossible de changer le mot de passe. Vérifiez votre mot de passe actuel.')
      }
    } catch (err) {
      console.error(err)
      setLoading((s) => ({ ...s, result: 'error', resultMessage: 'Erreur lors du changement de mot de passe' }))
      toast.error('Erreur lors du changement de mot de passe')
    } finally {
      setIsChangingPassword(false)
    }
  }

  return (
    <div className="p-6 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Mon profil</h1>
        <Button variant="outline" onClick={handleLogout}>
          <LogOut className="size-4 mr-2" />
          Déconnexion
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Informations du compte</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid gap-1">
            <span className="text-muted-foreground text-sm">Identifiant</span>
            <p className="font-medium">{user?.identifiant ?? '—'}</p>
          </div>
          <div className="grid gap-1">
            <span className="text-muted-foreground text-sm">Rôle</span>
            <p className="font-medium capitalize">{user?.role ?? '—'}</p>
          </div>
          {user?.direction_name && (
            <div className="grid gap-1">
              <span className="text-muted-foreground text-sm">Direction</span>
              <p className="font-medium">{user.direction_name}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <KeyRound className="size-5" />
            Changer mon mot de passe
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 max-w-xs">
            <Label htmlFor="current-password">Mot de passe actuel</Label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-2 max-w-xs">
            <Label htmlFor="new-password">Nouveau mot de passe</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-2 max-w-xs">
            <Label htmlFor="confirm-new-password">Confirmer le nouveau mot de passe</Label>
            <Input
              id="confirm-new-password"
              type="password"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
            />
          </div>
          <Button onClick={handleChangePassword} disabled={isChangingPassword}>
            <KeyRound className="size-4 mr-2" />
            {isChangingPassword ? 'Mise à jour...' : 'Mettre à jour le mot de passe'}
          </Button>
        </CardContent>
      </Card>

      <LoadingModal state={loading} onClose={() => setLoading(initialLoadingState)} />
    </div>
  )
}

export default ProfilePage
