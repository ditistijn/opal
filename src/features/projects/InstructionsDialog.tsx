import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"

export function InstructionsDialog({
  open,
  onOpenChange,
  initial,
  projectName,
  onSave,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  initial: string
  projectName: string
  onSave(text: string): void
}) {
  const [text, setText] = useState(initial)
  useEffect(() => {
    if (open) setText(initial)
  }, [open, initial])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,640px)]">
        <DialogTitle className="font-serif text-[22px] font-normal">Set project instructions</DialogTitle>
        <DialogDescription>
          Opal follows these instructions in every chat in “{projectName}”.
        </DialogDescription>
        <Textarea
          autoFocus
          aria-label="Project instructions"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Think step by step and show reasoning for complex problems. Use specific examples."
          className="mt-4 min-h-[260px] text-[14px]"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onSave(text)
              onOpenChange(false)
            }}
          >
            Save instructions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
