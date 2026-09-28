import { useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Link } from "react-router-dom"
import logoDjogana from "@/assets/logo_djogana.png"
import { useAuth } from "@/contexts/AuthContext"
import { User } from "lucide-react"
import { useStaggerChildren, useScrollReveal } from "@/hooks/useAnimations"
import { wakeApi } from "@/utils/apiBase"

/**
 * APK download link.
 * External R2 URLs open in a new tab on mobile and often fail to start a download;
 * production uses a same-origin path proxied to R2 in `vercel.json`.
 */
const APK_FILE_NAME = 'intranet-auth.apk'
const APK_SAME_ORIGIN_PATH = `/download/${APK_FILE_NAME}`
const configuredApkUrl = (import.meta.env.VITE_ANDROID_APK_URL as string | undefined)?.trim()
const ANDROID_APK_HREF =
  configuredApkUrl && /^https?:\/\//i.test(configuredApkUrl)
    ? APK_SAME_ORIGIN_PATH
    : configuredApkUrl || '/app/application-10220baa-3ebd-47bd-9b63-dc55f6d0d732.apk'

const Landing = () => {
  const { user } = useAuth()
  const heroRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef<HTMLDivElement>(null)

  useStaggerChildren(heroRef, '> *')
  useScrollReveal(cardsRef)

  useEffect(() => {
    wakeApi()
  }, [])

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
      <main ref={heroRef} className="max-w-4xl mx-auto text-center space-y-0 flex-1 flex flex-col items-center justify-center px-4">
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
        <div ref={cardsRef} className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-12 text-left">
          <div className="p-4 rounded-lg bg-card border shadow-sm transition-transform duration-200 hover:scale-[1.03]">
            <h3 className="font-semibold text-foreground mb-2">Formations</h3>
            <p className="text-sm text-muted-foreground">
              Documentation des formations et parcours d'apprentissage
            </p>
          </div>
          <div className="p-4 rounded-lg bg-card border shadow-sm transition-transform duration-200 hover:scale-[1.03]">
            <h3 className="font-semibold text-foreground mb-2">Modes d'opération</h3>
            <p className="text-sm text-muted-foreground">
              Procédures et bonnes pratiques opérationnelles
            </p>
          </div>
          <div className="p-4 rounded-lg bg-card border shadow-sm transition-transform duration-200 hover:scale-[1.03]">
            <h3 className="font-semibold text-foreground mb-2">Types & Articles</h3>
            <p className="text-sm text-muted-foreground">
              Documentation classée par type et articles
            </p>
          </div>
        </div>
      </main>
      <footer className="border-t bg-background/80 backdrop-blur px-4 py-4">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            © {new Date().getFullYear()} Djogana
          </span>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center justify-center rounded-xl border bg-background p-1.5 shadow-sm">
              <img
                src={logoDjogana}
                alt=""
                className="size-12 rounded-lg object-contain"
              />
            </div>
            <a
              href={ANDROID_APK_HREF}
              download={APK_FILE_NAME}
              className="group inline-flex items-center rounded-xl border bg-card px-3 py-2 text-foreground shadow-sm transition-all hover:border-primary/40 hover:bg-muted/60"
              aria-label="Télécharger l'application Android"
            >
              <span className="flex flex-col leading-tight">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Disponible sur
                </span>
                <span className="text-sm font-semibold group-hover:text-primary">
                  Télécharger l&apos;application Android
                </span>
              </span>
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default Landing
