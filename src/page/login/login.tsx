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
import { User } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const Login = () => {
  const navigate = useNavigate()
  const { user, requestDeviceLogin, pollDeviceRequest } = useAuth()
  const form = useForm({
    defaultValues: {
      identifiant: "",
      mot_de_passe: "",
    },
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [deviceRequestId, setDeviceRequestId] = useState<string | null>(null)
  const [deviceCode, setDeviceCode] = useState("")
  const [approvalStatus, setApprovalStatus] = useState<"pending" | "denied" | "expired" | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!modalOpen || !deviceRequestId || approvalStatus !== "pending") return
    const poll = async () => {
      const result = await pollDeviceRequest(deviceRequestId)
      if (result.status === "approved") {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null
        }
        setModalOpen(false)
        toast.success("Connexion approuvée")
        navigate("/dashboard")
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
        setApprovalStatus("expired")
        toast.error("Demande expirée")
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
    setModalOpen(false)
    setDeviceRequestId(null)
    setDeviceCode("")
    setApprovalStatus(null)
  }

  const handleSubmit = async () => {
    const data = form.getValues()
    const ident = (data.identifiant || "").trim()
    const password = (data.mot_de_passe || "").trim()
    if (!ident || !password) {
      toast.error("Identifiant et mot de passe requis")
      return
    }
    const result = await requestDeviceLogin(ident, password)
    if (!result) {
      toast.error("Identifiant ou mot de passe incorrect")
      return
    }
    setDeviceRequestId(result.requestId)
    setDeviceCode(result.code)
    setApprovalStatus("pending")
    setModalOpen(true)
  }

  return (
    <div className="min-h-svh flex flex-col bg-gradient-to-b from-background to-muted/30">
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4 w-full">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <img src={logoDjogana} alt="Djogana" className="h-20 w-auto" />
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
      <main className="flex-1 flex items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="flex flex-col gap-2 justify-center items-center text-center">
            <CardTitle className="text-2xl font-bold">Connexion</CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              Identifiant et mot de passe, puis validation de la connexion sur l’application mobile.
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
                    <Input
                      {...field}
                      placeholder="Mot de passe"
                      type="password"
                    />
                  )}
                />
                <Button type="submit" className="w-full">
                  Se connecter
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
            <DialogTitle>En attente d’approbation</DialogTitle>
            <DialogDescription>
              Ouvrez l’application Djogana sur votre téléphone et approuvez cette connexion.
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
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Spinner className="size-4" />
                <span className="text-sm">En attente de validation sur l’app mobile…</span>
              </div>
            </>
          )}
          {(approvalStatus === "denied" || approvalStatus === "expired") && (
            <p className="text-sm text-destructive">
              {approvalStatus === "denied"
                ? "Connexion refusée sur l’application mobile."
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
