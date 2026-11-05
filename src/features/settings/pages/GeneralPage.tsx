import { runtime } from "@/lib/runtime"
import type { AppSettings, ModeID } from "@/lib/runtime/contracts"
import { MODE_IDS, MODES } from "@/lib/config/prompts"
import { ModelSelector } from "@/features/models/ModelSelector"
import { visionModels } from "@/lib/config/vision"
import type { ModelInfo } from "@/lib/opencode/types"
import { PageHeader, SectionTitle, Select, SettingRow, Stepper, Switch } from "../controls"

/** Stable reference for ModelSelector's memo: image-capable models that can call tools (the helper uses read). */
const isVisionModel = (model: ModelInfo) => visionModels([model]).length > 0

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
          label="Image fallback"
          description="When a chat's model can't see images, let it hand dropped images to an image-capable model that describes them."
          htmlFor="settings-image-fallback"
        >
          <Switch
            id="settings-image-fallback"
            checked={settings.imageFallback.enabled}
            onCheckedChange={(enabled) => update({ imageFallback: { ...settings.imageFallback, enabled } })}
          />
        </SettingRow>
        {settings.imageFallback.enabled ? (
          <SettingRow
            label="Image fallback model"
            description="Must accept image input. Picked automatically when you add a vision model."
          >
            <ModelSelector
              value={settings.imageFallback.model}
              onChange={(model) =>
                update({
                  imageFallback: {
                    ...settings.imageFallback,
                    model: { providerID: model.providerID, id: model.id },
                  },
                })
              }
              filter={isVisionModel}
              placeholder="No vision model"
              align="end"
            />
          </SettingRow>
        ) : null}
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
