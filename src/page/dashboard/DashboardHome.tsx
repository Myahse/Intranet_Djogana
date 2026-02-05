import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const DashboardHome = () => {
  return (
    <div className="p-6">
      <Card>
        <CardHeader>
          <CardTitle>Tableau de bord</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Sélectionnez un type de document dans la barre latérale pour accéder aux documents.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export default DashboardHome
