import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { KeyRound, ShieldAlert, Eye, EyeOff } from 'lucide-react'
import LoadingModal, { initialLoadingState, type LoadingState } from '@/components/LoadingModal'
import logoDjogana from '@/assets/logo_djogana.png'

/**
 * Full-screen page shown when a user must change their password on first login.
 * The user cannot navigate away until the password is updated.
 */
const ForceChangePasswordPage = (): ReactNode => {
  const navigate = useNavigate()
  const { user, changePassword, logout, refreshPermissions } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [isChanging, setIsChanging] = useState(false)
  const [loading, setLoading] = useState<LoadingState>(initialLoadingState)
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      toast.error('Veuillez remplir tous les champs')
      return
    }

    if (newPassword.length < 4) {
      toast.error('Le nouveau mot de passe doit contenir au moins 4 caractères')
      return
    }

    if (newPassword !== confirmNewPassword) {
      toast.error('Les nouveaux mots de passe ne correspondent pas')
      return
    }

    if (currentPassword === newPassword) {
      toast.error('Le nouveau mot de passe doit être différent du mot de passe actuel')
      return
    }

    setIsChanging(true)
    setLoading({ open: true, message: 'Mise à jour du mot de passe…' })
    try {
      const ok = await changePassword(currentPassword, newPassword)
      if (ok) {
        setLoading((s) => ({ ...s, result: 'success', resultMessage: 'Mot de passe mis à jour avec succès !' }))
        toast.success('Mot de passe mis à jour')
        // Wait for the loading modal to auto-close, refresh server state, then navigate
        setTimeout(async () => {
          try { await refreshPermissions() } catch { /* best-effort */ }
          navigate('/dashboard', { replace: true })
        }, 1400)
      } else {
        setLoading((s) => ({ ...s, result: 'error', resultMessage: 'Mot de passe actuel incorrect' }))
        toast.error('Mot de passe actuel incorrect. Vérifiez et réessayez.')
      }
    } catch (err) {
      console.error(err)
      setLoading((s) => ({ ...s, result: 'error', resultMessage: 'Erreur lors du changement' }))
      toast.error('Erreur lors du changement de mot de passe')
    } finally {
      setIsChanging(false)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-svh flex flex-col bg-gradient-to-b from-background to-muted/30">
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4 w-full">
        <div className="flex items-center gap-2 shrink-0">
          <img src={logoDjogana} alt="Djogana" className="h-14 w-auto" />
        </div>
        <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground">
          Se déconnecter
        </Button>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <Card className="w-full max-w-md">
          <CardHeader className="flex flex-col gap-3 items-center text-center">
            <div className="flex items-center justify-center size-14 rounded-full bg-amber-100 text-amber-600">
              <ShieldAlert className="size-7" />
            </div>
            <CardTitle className="text-xl font-bold">
              Changement de mot de passe requis
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              Pour des raisons de sécurité, vous devez changer votre mot de passe avant d'accéder à l'application.
            </CardDescription>
            {user?.identifiant && (
              <p className="text-xs text-muted-foreground">
                Connecté en tant que <span className="font-medium text-foreground">{user.identifiant}</span>
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="force-current-password">Mot de passe actuel</Label>
              <div className="relative">
                <Input
                  id="force-current-password"
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Votre mot de passe actuel"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent((v) => !v)}
                  className="absolute right-0 top-0 h-full px-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showCurrent ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="force-new-password">Nouveau mot de passe</Label>
              <div className="relative">
                <Input
                  id="force-new-password"
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Choisissez un nouveau mot de passe"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNew((v) => !v)}
                  className="absolute right-0 top-0 h-full px-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="force-confirm-password">Confirmer le nouveau mot de passe</Label>
              <div className="relative">
                <Input
                  id="force-confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="Confirmez le nouveau mot de passe"
                  className="pr-10"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleChangePassword()
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute right-0 top-0 h-full px-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <Button
              onClick={handleChangePassword}
              disabled={isChanging}
              className="w-full"
            >
              <KeyRound className="size-4 mr-2" />
              {isChanging ? 'Mise à jour…' : 'Mettre à jour le mot de passe'}
            </Button>
          </CardContent>
        </Card>
      </main>

      <LoadingModal state={loading} onClose={() => setLoading(initialLoadingState)} />
    </div>
  )
}

export default ForceChangePasswordPage
