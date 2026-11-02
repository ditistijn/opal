import { runtime } from "@/lib/runtime"
import type { AppSettings, ModeID } from "@/lib/runtime/contracts"
import { MODE_IDS, MODES } from "@/lib/config/prompts"
import { ModelSelector } from "@/features/models/ModelSelector"
import { PageHeader, SectionTitle, Select, SettingRow, Stepper, Switch } from "../controls"

export const MIN_CONNECTIONS = 1
export const MAX_CONNECTIONS = 16

export function GeneralPage() {
  const settings = runtime.useSettings()
  const update = (patch: Partial<AppSettings>) => void runtime.updateSettings(patch)

  return (
    <div>
      <PageHeader title="General" />

      <SectionTitle>Conversations</SectionTitle>
      <div>
        <SettingRow
          label="Default mode"
          description="The mode new chats start in. You can switch per conversation."
        >
          <Select<ModeID>
            ariaLabel="Default mode"
            value={settings.defaultMode}
            onValueChange={(defaultMode) => update({ defaultMode })}
            options={MODE_IDS.map((id) => ({
              value: id,
              label: MODES[id].label,
              description: MODES[id].description,
            }))}
            className="w-[200px]"
          />
        </SettingRow>
        <SettingRow
          label="Default model"
          description="Used for new conversations unless a project or session picks another."
        >
          <ModelSelector
            value={settings.defaultModel}
            onChange={(defaultModel) => update({ defaultModel })}
            align="end"
          />
        </SettingRow>
        <SettingRow
          label="Max concurrent API connections"
          description={
            <>
              How many conversations may talk to model APIs at the same time. Extra requests wait in a queue
              and show as “Queued” until a slot frees up. Lower this if a provider rate-limits you.
            </>
          }
        >
          <Stepper
            ariaLabel="Max concurrent API connections"
            value={settings.maxConcurrentConnections}
            min={MIN_CONNECTIONS}
            max={MAX_CONNECTIONS}
            onChange={(maxConcurrentConnections) => update({ maxConcurrentConnections })}
          />
        </SettingRow>
      </div>

      <SectionTitle>Code</SectionTitle>
      <div>
        <SettingRow
          label="Use git worktrees"
          description="Run each new Code session in its own worktree and branch, so parallel sessions never collide."
          htmlFor="settings-worktrees"
        >
          <Switch
            id="settings-worktrees"
            checked={settings.codeSurface.useWorktrees}
            onCheckedChange={(useWorktrees) =>
              update({ codeSurface: { ...settings.codeSurface, useWorktrees } })
            }
          />
        </SettingRow>
        <SettingRow
          label="Permissions"
          description="How the Code mode handles file edits and shell commands."
        >
          <Select<AppSettings["codeSurface"]["permissionMode"]>
            ariaLabel="Code permissions"
            value={settings.codeSurface.permissionMode}
            onValueChange={(permissionMode) =>
              update({ codeSurface: { ...settings.codeSurface, permissionMode } })
            }
            options={[
              {
                value: "ask",
                label: "Ask before changes",
                description: "Approve edits and commands (read-only commands run freely).",
              },
              {
                value: "auto",
                label: "Auto-approve",
                description: "Edit and run freely; still asks for risky commands and paths outside the repo.",
              },
            ]}
            className="w-[200px]"
          />
        </SettingRow>
      </div>
    </div>
  )
}
