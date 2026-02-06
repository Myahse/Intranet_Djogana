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

const Login = () => {
  const navigate = useNavigate()
  const { login, user } = useAuth()
  const form = useForm({
    defaultValues: {
      identifiant: "",
      mot_de_passe: "",
    },
  })

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
      <main className="flex-1 flex items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="flex flex-col gap-2 justify-center items-center">
            <CardTitle className="text-2xl font-bold justify-center">Connexion</CardTitle>
            <CardDescription className="text-sm text-gray-500 justify-center">
              Connectez-vous à votre compte
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(async (data) => {
                  const ok = await login(data.identifiant, data.mot_de_passe)
                  if (ok) {
                    navigate("/dashboard")
                  } else {
                    toast.error("Identifiant ou mot de passe incorrect")
                  }
                })}
                className="flex flex-col gap-4"
              >
                <FormField
                  control={form.control}
                  name="identifiant"
                  render={({ field }) => (
                    <Input
                      {...field}
                      placeholder="Entrez votre identifiant de connexion"
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
                      placeholder="Entrez votre mot de passe"
                      type="password"
                    />
                  )}
                />
                <Button type="submit">Se connecter</Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </main>
    </div>
  )
};

export default Login;