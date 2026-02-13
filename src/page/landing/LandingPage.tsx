import { Button } from "@/components/ui/button"
import { Link } from "react-router-dom"
import logoDjogana from "@/assets/logo_djogana.png"
import { useAuth } from "@/contexts/AuthContext"
import { User } from "lucide-react"

const Landing = () => {
  const { user } = useAuth()

  return (
    <div className="min-h-svh flex flex-col bg-gradient-to-b from-background to-muted/30">
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4 w-full">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <img
            src={logoDjogana}
            alt="Djogana"
            className="h-20 w-auto"
          />
        </Link>
        {user ? (
          <Link
            to="/dashboard"
            className="flex size-10 items-center justify-center rounded-full border bg-muted hover:bg-muted/80 transition-colors"
            aria-label="Accéder au tableau de bord"
          >
            <User className="size-5 text-muted-foreground" />
          </Link>
        ) : (
          <Button asChild variant="ghost" size="sm">
            <Link to="/login">Connexion</Link>
          </Button>
        )}
      </header>
      <main className="max-w-4xl mx-auto text-center space-y-0 flex-1 flex flex-col items-center justify-center px-4">
        <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-foreground tracking-tight text-center">
          Bienvenue sur la base
        </h1>
        <img src={logoDjogana} alt="Djogana" className="h-28 md:h-36 lg:h-44 w-auto object-contain mx-auto" />
        <div className="flex flex-col items-center gap-4">
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          Intranet de l'entreprise — toute la documentation à portée de main&nbsp;:
          formations, modes d'opération, types et articles.
        </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
          {user ? (
            <Button asChild size="lg" className="text-base px-8">
              <Link to="/dashboard">Accéder au tableau de bord</Link>
            </Button>
          ) : (
            <Button asChild size="lg" className="text-base px-8">
              <Link to="/login">Accéder à l'intranet</Link>
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-12 text-left">
          <div className="p-4 rounded-lg bg-card border shadow-sm">
            <h3 className="font-semibold text-foreground mb-2">Formations</h3>
            <p className="text-sm text-muted-foreground">
              Documentation des formations et parcours d'apprentissage
            </p>
          </div>
          <div className="p-4 rounded-lg bg-card border shadow-sm">
            <h3 className="font-semibold text-foreground mb-2">Modes d'opération</h3>
            <p className="text-sm text-muted-foreground">
              Procédures et bonnes pratiques opérationnelles
            </p>
          </div>
          <div className="p-4 rounded-lg bg-card border shadow-sm">
            <h3 className="font-semibold text-foreground mb-2">Types & Articles</h3>
            <p className="text-sm text-muted-foreground">
              Documentation classée par type et articles
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}

export default Landing
