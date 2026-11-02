import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { runtime, type Project } from "@/lib/runtime"

export function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  onCreated(project: Project): void
}) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    const now = Date.now()
    const project: Project = {
      id: `prj_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      description: description.trim() || undefined,
      knowledge: [],
      created: now,
      updated: now,
    }
    try {
      await runtime.saveProject(project)
      setName("")
      setDescription("")
      onOpenChange(false)
      onCreated(project)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,520px)]">
        <DialogTitle className="font-serif text-[22px] font-normal">Create a project</DialogTitle>
        <DialogDescription>Group chats with shared instructions and knowledge files.</DialogDescription>
        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <label className="block space-y-1.5">
            <span className="text-[13px] font-medium text-fg-secondary">What are you working on?</span>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name your project"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[13px] font-medium text-fg-secondary">What are you trying to achieve?</span>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your project, goals, subject, etc…"
            />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={!name.trim() || busy}>
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
