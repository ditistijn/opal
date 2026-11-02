import {
  AppWindow,
  BookOpen,
  FilePen,
  FileSearch,
  FileText,
  Globe,
  ListTodo,
  MessageCircleQuestion,
  Network,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import type { ToolPart } from "@/lib/runtime"

export interface ToolLabel {
  icon: LucideIcon
  running: string
  done: string
  detail?: string
}

function str(v: unknown) {
  return typeof v === "string" ? v : undefined
}

function base(path: string | undefined) {
  return path?.split("/").pop()
}

/** OpenCode exposes namespaced tools as "<namespace>_<name>" (e.g. opencode_artifact_create); strip the namespace. */
export function baseToolName(name: string) {
  return name.replace(/^opencode_/, "")
}

export function isArtifactTool(name: string) {
  const base = baseToolName(name)
  return base === "artifact_create" || base === "artifact_update"
}

/** Human labels for tool activity rows ("Reading file…" / "Read revenue.csv"). */
export function toolLabel(part: Pick<ToolPart, "name" | "input">): ToolLabel {
  const input = part.input ?? {}
  const file = str(input.filePath) ?? str(input.path) ?? str(input.file)
  switch (baseToolName(part.name)) {
    case "read":
      return { icon: FileText, running: "Reading file…", done: "Read file", detail: base(file) }
    case "write":
      return { icon: FilePen, running: "Writing file…", done: "Wrote file", detail: base(file) }
    case "edit":
    case "multiedit":
    case "patch":
    case "apply_patch":
      return { icon: FilePen, running: "Editing file…", done: "Edited file", detail: base(file) }
    case "bash":
    case "shell":
      return {
        icon: SquareTerminal,
        running: "Running command…",
        done: "Ran command",
        detail: str(input.command),
      }
    case "websearch":
    case "web_search":
      return {
        icon: Globe,
        running: "Searching the web…",
        done: "Searched the web",
        detail: str(input.query),
      }
    case "question": {
      const questions = Array.isArray(input.questions) ? (input.questions as { header?: unknown }[]) : []
      const headers = questions.map((q) => str(q?.header)).filter(Boolean)
      return {
        icon: MessageCircleQuestion,
        running: questions.length > 1 ? "Asking questions…" : "Asking a question…",
        done: questions.length > 1 ? "Asked questions" : "Asked a question",
        detail: headers.join(", ") || undefined,
      }
    }
    case "webfetch":
    case "fetch":
      return { icon: Globe, running: "Fetching page…", done: "Fetched page", detail: str(input.url) }
    case "glob":
    case "grep":
    case "list":
    case "ls":
      return {
        icon: FileSearch,
        running: "Searching files…",
        done: "Searched files",
        detail: str(input.pattern) ?? str(input.query) ?? file,
      }
    case "artifact_create":
      return {
        icon: AppWindow,
        running: "Creating artifact…",
        done: "Created artifact",
        detail: str(input.title),
      }
    case "artifact_update":
      return {
        icon: AppWindow,
        running: "Updating artifact…",
        done: "Updated artifact",
        detail: str(input.title),
      }
    case "artifact_read":
      return { icon: AppWindow, running: "Reading artifact…", done: "Read artifact", detail: str(input.id) }
    case "task":
    case "subagent":
      return {
        icon: Network,
        running: "Running subagent…",
        done: "Ran subagent",
        detail: str(input.description),
      }
    case "todowrite":
    case "todoread":
      return { icon: ListTodo, running: "Updating plan…", done: "Updated plan" }
    case "skill":
      return { icon: BookOpen, running: "Loading skill…", done: "Loaded skill", detail: str(input.name) }
    default:
      return { icon: Wrench, running: `Using ${part.name}…`, done: `Used ${part.name}` }
  }
}
