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
import { User, Eye, EyeOff, RefreshCw, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Spinner } from "@/components/ui/spinner"

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
  const [loading, setLoading] = useState(false)
  // Pending request state (replaces the modal + timer)
  const [pendingRequest, setPendingRequest] = useState<{
    requestId: string
    code: string
  } | null>(null)
  const [approvalStatus, setApprovalStatus] = useState<
    "pending" | "denied" | "expired" | "detruite" | null
  >(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Poll for approval status when there is a pending request
  useEffect(() => {
    if (!pendingRequest || approvalStatus !== "pending") return
    const poll = async () => {
      const result = await pollDeviceRequest(pendingRequest.requestId)
      if (result.status === "approved") {
        stopPolling()
        setPendingRequest(null)
        setApprovalStatus(null)
        toast.success("Connexion approuvée")
        if (result.user?.must_change_password) {
          navigate("/change-password")
        } else {
          navigate("/dashboard")
        }
        return
      }
      if (result.status === "denied") {
        stopPolling()
        setApprovalStatus("denied")
        toast.error("Connexion refusée")
      }
      if (result.status === "expired") {
        stopPolling()
        setApprovalStatus("expired")
        toast.error("La demande a expiré")
      }
      if ((result.status as string) === "detruite") {
        stopPolling()
        setApprovalStatus("detruite")
      }
    }
    poll()
    pollIntervalRef.current = setInterval(poll, 2500)
    return () => stopPolling()
  }, [pendingRequest, approvalStatus, pollDeviceRequest, navigate])

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }

  const cancelRequest = useCallback(() => {
    stopPolling()
    setPendingRequest(null)
    setApprovalStatus(null)
  }, [])

  const handleSubmit = async () => {
    const data = form.getValues()
    const ident = (data.identifiant || "").trim()
    const password = (data.mot_de_passe || "").trim()
    if (!ident || !password) {
      toast.error("Identifiant et mot de passe requis")
      return
    }
    setLoading(true)
    const result = await requestDeviceLogin(ident, password)
    setLoading(false)
    if ("error" in result) {
      toast.error("Identifiants incorrects")
      return
    }
    // Old pending request (if any) is automatically set to 'detruite' on the server
    setPendingRequest({ requestId: result.requestId, code: result.code })
    setApprovalStatus("pending")
  }

  const handleNewRequest = async () => {
    // Create a new request – the server will mark the old one as 'detruite'
    await handleSubmit()
  }

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
        {/* Show the pending request card OR the login form */}
        {pendingRequest && approvalStatus ? (
          <Card className="w-full max-w-md">
            <CardHeader className="flex flex-col gap-2 justify-center items-center text-center">
              <CardTitle className="text-2xl font-bold">
                {approvalStatus === "pending"
                  ? "Demande en attente"
                  : approvalStatus === "denied"
                    ? "Connexion refusée"
                    : approvalStatus === "expired"
                      ? "Demande expirée"
                      : "Demande remplacée"}
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                {approvalStatus === "pending"
                  ? "Ouvrez l'application Djogana sur votre téléphone et approuvez cette connexion."
                  : approvalStatus === "denied"
                    ? "La connexion a été refusée sur l'application mobile."
                    : approvalStatus === "expired"
                      ? "La demande a expiré. Vous pouvez en créer une nouvelle."
                      : "Cette demande a été remplacée par une nouvelle."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/* Code display */}
              <div className="rounded-xl border-2 border-primary bg-primary/5 px-6 py-4 text-center">
                <p className="text-sm text-muted-foreground mb-1">Code à 6 chiffres</p>
                <p className="text-3xl font-mono font-bold tracking-widest">
                  {String(pendingRequest.code).padStart(6, "0").slice(-6)}
                </p>
              </div>

              {/* Waiting indicator */}
              {approvalStatus === "pending" && (
                <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Spinner className="size-4" />
                  <span className="text-sm">En attente de validation sur l'app mobile…</span>
                </div>
              )}

              {/* Status badge for non-pending */}
              {approvalStatus === "denied" && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-center">
                  <p className="text-sm text-destructive font-medium">
                    Connexion refusée sur l'application mobile.
                  </p>
                </div>
              )}
              {approvalStatus === "expired" && (
                <div className="rounded-lg bg-orange-50 border border-orange-200 px-4 py-3 text-center">
                  <p className="text-sm text-orange-700 font-medium">
                    La demande a expiré.
                  </p>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  className="w-full gap-2"
                  onClick={handleNewRequest}
                  disabled={loading}
                >
                  {loading ? (
                    <Spinner className="size-4" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  Faire une nouvelle demande
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full gap-2"
                  onClick={cancelRequest}
                >
                  <X className="size-4" />
                  Annuler
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
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
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? <Spinner className="size-4" /> : "Se connecter"}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}

export default Login
