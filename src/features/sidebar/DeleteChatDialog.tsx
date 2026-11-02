import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog"
import type { SessionInfo } from "@/lib/opencode/types"
import { sessionTitle } from "./group-sessions"

export function DeleteChatDialog({
  session,
  onCancel,
  onConfirm,
}: {
  session: SessionInfo | undefined
  onCancel(): void
  onConfirm(): void
}) {
  return (
    <Dialog open={!!session} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent hideClose>
        <DialogTitle>Delete chat?</DialogTitle>
        <DialogDescription>
          “{sessionTitle(session)}” and its files will be permanently deleted. This can't be undone.
        </DialogDescription>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} autoFocus>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
