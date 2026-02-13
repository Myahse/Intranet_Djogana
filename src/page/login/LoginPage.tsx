import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FormField } from "@/components/ui/form"
import { Form } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { useAuth } from "@/contexts/AuthContext"
import logoDjogana from "@/assets/logo_djogana.png"
import { User, Eye, EyeOff, Clock } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const REQUEST_VALIDITY_SECONDS = 15
const COOLDOWN_SECONDS = 20

/** Format remaining seconds as just "Xs" */
function formatTime(sec: number): string {
  return `${sec}s`
}

const Login = () => {
  const navigate = useNavigate()
  const { user, requestDeviceLogin, pollDeviceRequest } = useAuth()
  const form = useForm({
    defaultValues: {
      identifiant: "",
      mot_de_passe: "",
    },
  })

  const [showPassword, setShowPassword] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [deviceRequestId, setDeviceRequestId] = useState<string | null>(null)
  const [deviceCode, setDeviceCode] = useState("")
  const [approvalStatus, setApprovalStatus] = useState<"pending" | "denied" | "expired" | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Countdown timer state
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [totalSeconds, setTotalSeconds] = useState(0)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cooldown between requests (20s)
  const [cooldown, setCooldown] = useState(0)
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startCooldown = useCallback(() => {
    setCooldown(COOLDOWN_SECONDS)
    if (cooldownRef.current) clearInterval(cooldownRef.current)
    cooldownRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [])

  // Start countdown timer
  const startCountdown = useCallback((expiresInSec: number) => {
    setTotalSeconds(expiresInSec)
    setSecondsLeft(expiresInSec)
    if (countdownRef.current) clearInterval(countdownRef.current)
    countdownRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [])

  // Auto-close the modal when the countdown reaches 0
  useEffect(() => {
    if (modalOpen && secondsLeft === 0 && totalSeconds > 0 && approvalStatus === "pending") {
      toast.error("La demande a expiré")
      closeModal()
    }
  }, [secondsLeft, modalOpen, totalSeconds, approvalStatus])

  useEffect(() => {
    if (!modalOpen || !deviceRequestId || approvalStatus !== "pending") return
    const poll = async () => {
      const result = await pollDeviceRequest(deviceRequestId)
      if (result.status === "approved") {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null
        }
        if (countdownRef.current) {
          clearInterval(countdownRef.current)
          countdownRef.current = null
        }
        setModalOpen(false)
        toast.success("Connexion approuvée")
        // Redirect to password change page if first login, otherwise dashboard
        if (result.user?.must_change_password) {
          navigate("/change-password")
        } else {
          navigate("/dashboard")
        }
        return
      }
      if (result.status === "denied") {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null
        }
        setApprovalStatus("denied")
        toast.error("Connexion refusée")
      }
      if (result.status === "expired") {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null
        }
        toast.error("La demande a expiré")
        closeModal()
      }
    }
    poll()
    pollIntervalRef.current = setInterval(poll, 2500)
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  }, [modalOpen, deviceRequestId, approvalStatus, pollDeviceRequest, navigate])

  const closeModal = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current)
      countdownRef.current = null
    }
    setModalOpen(false)
    setDeviceRequestId(null)
    setDeviceCode("")
    setApprovalStatus(null)
    setSecondsLeft(0)
    setTotalSeconds(0)
    // Start the 20s cooldown before next request
    startCooldown()
  }

  const handleSubmit = async () => {
    if (cooldown > 0) {
      toast.error(`Veuillez patienter ${cooldown}s avant de renvoyer une requête`)
      return
    }
    const data = form.getValues()
    const ident = (data.identifiant || "").trim()
    const password = (data.mot_de_passe || "").trim()
    if (!ident || !password) {
      toast.error("Identifiant et mot de passe requis")
      return
    }
    const result = await requestDeviceLogin(ident, password)
    if ("error" in result) {
      toast.error("Identifiants incorrects")
      return
    }
    setDeviceRequestId(result.requestId)
    setDeviceCode(result.code)
    setApprovalStatus("pending")
    setModalOpen(true)
    startCountdown(REQUEST_VALIDITY_SECONDS)
  }

  // Compute progress percentage for the countdown bar
  const progressPct = totalSeconds > 0 ? (secondsLeft / totalSeconds) * 100 : 0
  // Color shifts: green > 66%, orange 33-66%, red < 33%
  const timerColor =
    progressPct > 66
      ? "text-emerald-600"
      : progressPct > 33
        ? "text-orange-500"
        : "text-red-500"
  const barColor =
    progressPct > 66
      ? "bg-emerald-500"
      : progressPct > 33
        ? "bg-orange-500"
        : "bg-red-500"

  return (
    <div className="min-h-svh flex flex-col bg-gradient-to-b from-background to-muted/30">
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4 w-full">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <img src={logoDjogana} alt="Djogana" className="h-20 w-auto" />
        </Link>
        {user && (
          <Link
            to="/dashboard"
            className="flex size-10 items-center justify-center rounded-full border bg-muted hover:bg-muted/80 transition-colors"
            aria-label="Accéder au tableau de bord"
          >
            <User className="size-5 text-muted-foreground" />
          </Link>
        )}
      </header>
      <main className="flex-1 flex items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="flex flex-col gap-2 justify-center items-center text-center">
            <CardTitle className="text-2xl font-bold">Connexion</CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              Identifiant et mot de passe, puis validation de la connexion sur l'application mobile.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(handleSubmit)}
                className="flex flex-col gap-4"
              >
                <FormField
                  control={form.control}
                  name="identifiant"
                  render={({ field }) => (
                    <Input
                      {...field}
                      placeholder="Identifiant"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      onChange={(e) => field.onChange(e.target.value.replace(/\D/g, ""))}
                    />
                  )}
                />
                <FormField
                  control={form.control}
                  name="mot_de_passe"
                  render={({ field }) => (
                    <div className="relative">
                      <Input
                        {...field}
                        placeholder="Mot de passe"
                        type={showPassword ? "text" : "password"}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-0 top-0 h-full px-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                        tabIndex={-1}
                      >
                        {showPassword ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                    </div>
                  )}
                />
                <Button type="submit" className="w-full" disabled={cooldown > 0}>
                  {cooldown > 0 ? `Patientez ${cooldown}s` : "Se connecter"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </main>

      <Dialog open={modalOpen} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent
          className="sm:max-w-md"
          onPointerDownOutside={(e) => {
            if (approvalStatus === "pending") e.preventDefault()
            else closeModal()
          }}
        >
          <DialogHeader>
            <DialogTitle>En attente d'approbation</DialogTitle>
            <DialogDescription>
              Ouvrez l'application Djogana sur votre téléphone et approuvez cette connexion.
            </DialogDescription>
          </DialogHeader>
          {approvalStatus === "pending" && (
            <>
              <div className="rounded-xl border-2 border-primary bg-primary/5 px-6 py-4 text-center">
                <p className="text-sm text-muted-foreground mb-1">Code à 6 chiffres</p>
                <p className="text-3xl font-mono font-bold tracking-widest">
                  {String(deviceCode).padStart(6, "0").slice(-6)}
                </p>
              </div>

              {/* Countdown timer */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="size-3.5" />
                    <span>Validité de la requête</span>
                  </div>
                  <span className={`font-mono font-semibold tabular-nums ${timerColor}`}>
                    {formatTime(secondsLeft)}
                  </span>
                </div>
                {/* Progress bar */}
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ease-linear ${barColor}`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Spinner className="size-4" />
                <span className="text-sm">En attente de validation sur l'app mobile…</span>
              </div>
            </>
          )}
          {(approvalStatus === "denied" || approvalStatus === "expired") && (
            <p className="text-sm text-destructive">
              {approvalStatus === "denied"
                ? "Connexion refusée sur l'application mobile."
                : "La demande a expiré."}
            </p>
          )}
          <Button
            type="button"
            variant={approvalStatus === "pending" ? "ghost" : "default"}
            className="w-full"
            onClick={closeModal}
          >
            {approvalStatus === "pending" ? "Annuler" : "Fermer"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default Login
