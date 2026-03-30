import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Clock } from 'lucide-react'
import { useEffect, useState } from 'react'

export default function SessionExpiredModal() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState<string>('Votre session a expiré.')

  useEffect(() => {
    const onExpired = (e: Event) => {
      const detail = (e as CustomEvent | undefined)?.detail as { message?: string } | undefined
      setMessage(detail?.message || 'Votre session a expiré.')
      setOpen(true)
    }
    window.addEventListener('auth:session_expired', onExpired as EventListener)
    return () => window.removeEventListener('auth:session_expired', onExpired as EventListener)
  }, [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="sm:max-w-[420px]"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="size-5 text-muted-foreground" aria-hidden />
            Session expirée
          </DialogTitle>
          <DialogDescription>
            {message}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setOpen(false)}>OK</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

