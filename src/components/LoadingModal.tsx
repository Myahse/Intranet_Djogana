import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'

export type LoadingState = {
  open: boolean
  message?: string
  /** Set to 'success' or 'error' to show a result before auto-closing */
  result?: 'success' | 'error' | null
  resultMessage?: string
}

export const initialLoadingState: LoadingState = {
  open: false,
  message: '',
  result: null,
  resultMessage: '',
}

interface LoadingModalProps {
  state: LoadingState
  onClose?: () => void
}

/**
 * A modal overlay with a spinner while an async action is in progress.
 * Shows a brief success/error result before auto-closing.
 */
export default function LoadingModal({ state, onClose }: LoadingModalProps) {
  const { open, message, result, resultMessage } = state
  const [visible, setVisible] = useState(open)

  useEffect(() => {
    if (open) {
      setVisible(true)
    }
  }, [open])

  // Auto-close after showing result
  useEffect(() => {
    if (result && open) {
      const timer = setTimeout(() => {
        setVisible(false)
        onClose?.()
      }, 1200)
      return () => clearTimeout(timer)
    }
  }, [result, open, onClose])

  return (
    <Dialog open={visible} onOpenChange={(v) => { if (!v && result) { setVisible(false); onClose?.() } }}>
      <DialogContent
        className="sm:max-w-[320px] flex flex-col items-center gap-4 py-10"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => { if (!result) e.preventDefault() }}
      >
        <DialogTitle className="sr-only">
          {result === 'success' ? 'Succès' : result === 'error' ? 'Erreur' : 'Chargement'}
        </DialogTitle>

        {result === 'success' ? (
          <CheckCircle2 className="size-12 text-green-500 animate-in zoom-in-50 duration-300" />
        ) : result === 'error' ? (
          <XCircle className="size-12 text-destructive animate-in zoom-in-50 duration-300" />
        ) : (
          <Loader2 className="size-10 text-primary animate-spin" />
        )}

        <p className="text-sm font-medium text-center text-foreground">
          {result ? (resultMessage || (result === 'success' ? 'Terminé !' : 'Une erreur est survenue.')) : (message || 'Veuillez patienter…')}
        </p>
      </DialogContent>
    </Dialog>
  )
}
