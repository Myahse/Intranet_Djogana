import { useState, useCallback } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

type ConfirmOptions = {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'destructive' | 'default'
}

type ConfirmState = ConfirmOptions & {
  open: boolean
  resolve: ((value: boolean) => void) | null
}

const initialState: ConfirmState = {
  open: false,
  title: '',
  description: '',
  confirmLabel: 'Confirmer',
  cancelLabel: 'Annuler',
  variant: 'destructive',
  resolve: null,
}

export function useConfirmDialog() {
  const [state, setState] = useState<ConfirmState>(initialState)

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({
        open: true,
        title: options.title,
        description: options.description,
        confirmLabel: options.confirmLabel ?? 'Confirmer',
        cancelLabel: options.cancelLabel ?? 'Annuler',
        variant: options.variant ?? 'destructive',
        resolve,
      })
    })
  }, [])

  const handleConfirm = useCallback(() => {
    state.resolve?.(true)
    setState(initialState)
  }, [state.resolve])

  const handleCancel = useCallback(() => {
    state.resolve?.(false)
    setState(initialState)
  }, [state.resolve])

  const ConfirmDialogComponent = () => (
    <AlertDialog open={state.open} onOpenChange={(open) => { if (!open) handleCancel() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{state.title}</AlertDialogTitle>
          <AlertDialogDescription>{state.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>{state.cancelLabel}</AlertDialogCancel>
          <AlertDialogAction variant={state.variant} onClick={handleConfirm}>
            {state.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { confirm, ConfirmDialog: ConfirmDialogComponent }
}
