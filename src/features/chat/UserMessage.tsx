import { useState } from "react"
import { Button } from "@/components/ui/button"
import { AttachmentChip } from "@/features/composer/AttachmentChip"
import { runtime, type ChatMessage } from "@/lib/runtime"
import { CopyAction, EditAction } from "./MessageActions"

export function messageText(m: ChatMessage) {
  return m.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n\n")
}

/** Right-aligned bubble; hover shows copy / edit. Editing resends from this point. */
export function UserMessage({ message, canEdit }: { message: ChatMessage; canEdit: boolean }) {
  const text = messageText(message)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)

  if (editing) {
    return (
      <div className="flex justify-end" data-role="user">
        <div className="w-full max-w-[80%] rounded-2xl bg-bubble-user p-3">
          <textarea
            autoFocus
            aria-label="Edit message"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false)
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                if (draft.trim()) {
                  setEditing(false)
                  void runtime.editMessage(message.sessionID, message.id, { text: draft.trim() })
                }
              }
            }}
            rows={Math.min(10, Math.max(2, draft.split("\n").length))}
            className="selectable w-full resize-none bg-transparent px-1 text-[15px] leading-6 text-fg outline-none focus-visible:outline-none"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!draft.trim()}
              onClick={() => {
                setEditing(false)
                void runtime.editMessage(message.sessionID, message.id, { text: draft.trim() })
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group/msg flex flex-col items-end" data-role="user">
      {message.attachments?.length ? (
        <div className="mb-2 flex max-w-[80%] flex-wrap justify-end gap-2">
          {message.attachments.map((a, i) => (
            <AttachmentChip
              key={`${a.name}-${i}`}
              name={a.name}
              mime={a.mime}
              size={a.size}
              previewURL={a.uri?.startsWith("data:image/") ? a.uri : undefined}
            />
          ))}
        </div>
      ) : null}
      {text ? (
        <div className="selectable max-w-[80%] whitespace-pre-wrap break-words rounded-2xl bg-bubble-user px-4 py-2.5 text-[15px] leading-6 text-fg">
          {text}
        </div>
      ) : null}
      <div className="mt-1 flex h-7 items-center gap-0.5 opacity-0 transition-opacity duration-[120ms] group-hover/msg:opacity-100 focus-within:opacity-100">
        <CopyAction text={text} />
        {canEdit ? (
          <EditAction
            onClick={() => {
              setDraft(text)
              setEditing(true)
            }}
          />
        ) : null}
      </div>
    </div>
  )
}
