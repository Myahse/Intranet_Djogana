import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FormField } from "@/components/ui/form"
import { Form } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { useAuth } from "@/contexts/AuthContext"

const Login = () => {
  const navigate = useNavigate()
  const { login } = useAuth()
  const form = useForm({
    defaultValues: {
      identifiant: "",
      mot_de_passe: "",
    },
  })

  return (
    <Card className="w-full max-w-md mx-auto justify-center mt-80">
      <CardHeader className="flex flex-col gap-2 justify-center items-center">
        <CardTitle className="text-2xl font-bold justify-center">Login</CardTitle>
        <CardDescription className="text-sm text-gray-500 justify-center">Connectez-vous à votre compte</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 ">
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
            <FormField control={form.control} name="mot_de_passe" render={({ field }) => <Input {...field} placeholder="Entrez votre mot de passe" type="password" />} />
            <Button  type="submit">Login</Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
};

export default Login;