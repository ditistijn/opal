import { Composer } from "@/features/composer/Composer"
import type { SessionInfo } from "@/lib/opencode/types"
import { runtime } from "@/lib/runtime"
import { ConversationHeader } from "./ConversationHeader"
import { MessageList } from "./MessageList"
import { PermissionCard } from "./PermissionCard"
import { QuestionCard } from "./QuestionCard"

/** The chat column for one conversation: header, transcript, question/permission prompts, docked composer. */
export function ConversationView({
  session,
  artifactOpen,
  hasArtifacts,
  onToggleArtifact,
  hideHeader,
}: {
  session: SessionInfo
  artifactOpen: boolean
  hasArtifacts: boolean
  onToggleArtifact(): void
  hideHeader?: boolean
}) {
  const messages = runtime.useMessages(session.id)
  const activity = runtime.useSessionActivity(session.id)
  const permissions = runtime.usePermissions(session.id)
  const forms = runtime.useForms(session.id)
  const meta = runtime.getOpalMetadata(session)
  const busy = activity !== "idle"

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {hideHeader ? null : (
        <ConversationHeader
          session={session}
          artifactOpen={artifactOpen}
          hasArtifacts={hasArtifacts}
          onToggleArtifact={onToggleArtifact}
        />
      )}
      <MessageList messages={messages} busy={busy} />
      <div data-composer-dock className="mx-auto w-full max-w-[var(--content-max-width)] shrink-0 px-6 pb-4">
        <Composer
          draftKey={session.id}
          placeholder="Reply to Opal…"
          activity={activity}
          sessionID={session.id}
          projectID={meta.projectID}
          mode={meta.mode}
          onModeChange={(m) => runtime.setSessionMode(session.id, m)}
          model={session.model}
          onModelChange={(m) => runtime.setSessionModel(session.id, m)}
          onSubmit={(input) => runtime.sendPrompt(session.id, input)}
          onStop={() => runtime.interrupt(session.id)}
          autoFocus
          above={
            forms.length || permissions.length ? (
              <>
                {forms.length ? (
                  <div aria-label="Questions">
                    {forms.map((f) => (
                      <QuestionCard key={f.id} form={f} />
                    ))}
                  </div>
                ) : null}
                {permissions.length ? (
                  <div aria-label="Permission requests">
                    {permissions.map((p) => (
                      <PermissionCard key={p.id} request={p} />
                    ))}
                  </div>
                ) : null}
              </>
            ) : null
          }
        />
        <p className="mt-2 text-center text-[11.5px] text-fg-faint">
          Opal can make mistakes. Check important info.
        </p>
      </div>
    </div>
  )
}
