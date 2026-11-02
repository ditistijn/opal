/**
 * Re-exports of OpenCode payload types from the generated client, under stable names.
 * Keep this the only place that reaches into @opencode/client's type namespace.
 */
import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client/promise"

export type { OpenCodeClient, OpenCodeEvent }

type Await<T> = T extends Promise<infer U> ? U : T
type Client = OpenCodeClient

export type SessionInfo = Await<ReturnType<Client["session"]["get"]>>
export type SessionMessage = Await<ReturnType<Client["message"]["list"]>>["data"][number]
export type AssistantMessage = Extract<SessionMessage, { type: "assistant" }>
export type UserMessage = Extract<SessionMessage, { type: "user" }>
export type AssistantContent = AssistantMessage["content"][number]
export type ModelInfo = Await<ReturnType<Client["model"]["list"]>>["data"][number]
export type ModelRef = NonNullable<SessionInfo["model"]>
export type ProviderInfo = Await<ReturnType<Client["provider"]["list"]>>["data"][number]
export type AgentInfo = Await<ReturnType<Client["agent"]["list"]>>["data"][number]
export type ArtifactInfo = Await<ReturnType<Client["experimental"]["artifacts"]["list"]>>["data"][number]
export type ArtifactContent = Await<ReturnType<Client["experimental"]["artifacts"]["get"]>>["data"]
export type PermissionRequest = Await<ReturnType<Client["permission"]["list"]>>[number]
export type FileDiff = Await<ReturnType<Client["session"]["diff"]>>[number]
export type CredentialEntry = Await<ReturnType<Client["credential"]["list"]>>[number]
export type ProjectInfo = Await<ReturnType<Client["project"]["list"]>>[number]
export type WorktreeEntry = Await<ReturnType<Client["worktree"]["list"]>>[number]
export type PtyInfo = Await<ReturnType<Client["pty"]["create"]>>["data"]
export type ConfigEntry = Await<ReturnType<Client["config"]["get"]>>[number]
export type FormInfo = Await<ReturnType<Client["session"]["form"]["list"]>>[number]
export type FormField = FormInfo["fields"][number]
export type FormAnswer = Parameters<Client["session"]["form"]["reply"]>[0]["answer"]
export type FormValue = FormAnswer[string]

export type EventOf<T extends OpenCodeEvent["type"]> = Extract<OpenCodeEvent, { type: T }>
export type PromptMetadata = NonNullable<Parameters<Client["session"]["prompt"]>[0]["metadata"]>
export type PromptFile = NonNullable<Parameters<Client["session"]["prompt"]>[0]["files"]>[number]
