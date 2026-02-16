import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { LogOut, ShieldAlert } from 'lucide-react'

/**
 * Full-screen modal shown when the current user's account is suspended.
 * They can log in and reach the dashboard but cannot see or use any content
 * until they log out. Only action available is "Se déconnecter".
 */
export default function SuspensionModal() {
  const { user, logout } = useAuth()

  if (!user?.is_suspended) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm"
      aria-modal="true"
      aria-labelledby="suspension-title"
      role="alertdialog"
    >
      <div className="mx-4 flex max-w-md flex-col items-center gap-8 rounded-2xl border-2 border-destructive/30 bg-card p-8 shadow-2xl">
        <div className="flex size-20 items-center justify-center rounded-full bg-destructive/15">
          <ShieldAlert className="size-10 text-destructive" aria-hidden />
        </div>
        <div className="space-y-3 text-center">
          <h1
            id="suspension-title"
            className="text-2xl font-bold tracking-tight text-foreground"
          >
            Compte suspendu
          </h1>
          <p className="text-muted-foreground">
            Votre accès à l’intranet a été suspendu par un administrateur.
            Vous ne pouvez pas consulter ni modifier le contenu.
          </p>
          <p className="text-sm text-muted-foreground">
            Pour toute question, contactez l’administrateur.
          </p>
        </div>
        <Button
          variant="outline"
          size="lg"
          className="gap-2 border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={logout}
        >
          <LogOut className="size-4" />
          Se déconnecter
        </Button>
      </div>
    </div>
  )
}
