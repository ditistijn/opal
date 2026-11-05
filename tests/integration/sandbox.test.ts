/**
 * The macOS sandbox shell (src-tauri/src/sandbox_shell.sh, installed by sandbox_exec.rs as <root>/bin/sandbox/zsh):
 * run directly and as OpenCode's configured `shell` through the real binary. Skipped without /usr/bin/sandbox-exec.
 *
 * Denial targets live under $HOME (temp folders are writable inside the sandbox by design).
 */
import { execFile, execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { newSessionID } from "@/lib/opencode/ids"
import { buildOpenCodeConfig } from "@/lib/config/build"
import { harnessConfig, startServer, waitFor, workRoot, type TestServer } from "./harness"

const SANDBOX_EXEC = "/usr/bin/sandbox-exec"
const available = process.platform === "darwin" && fs.existsSync(SANDBOX_EXEC)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/** Installs the wrapper the way sandbox_exec.rs does (header + body). */
function installWrapper(root: string) {
  const dir = path.join(root, "bin", "sandbox")
  fs.mkdirSync(dir, { recursive: true })
  const body = fs.readFileSync(path.join(repoRoot, "src-tauri/src/sandbox_shell.sh"), "utf8")
  const shell = path.join(dir, "zsh")
  fs.writeFileSync(shell, `#!/bin/sh\nSANDBOX_DIR=${shq(dir)}\nOPAL_ROOT=${shq(root)}\n${body}`, {
    mode: 0o755,
  })
  return {
    shell,
    configure(mode: "off" | "filesystem" | "strict", allow: string[] = [], denyPorts: number[] = []) {
      fs.writeFileSync(
        path.join(dir, "config.env"),
        `OPAL_SANDBOX_MODE=${mode}\nOPAL_SANDBOX_ALLOW=${allow.join(":")}\nOPAL_SANDBOX_DENY_PORTS=${denyPorts.join(":")}\n`,
      )
    },
  }
}

/** Async variant: needed when the command talks to a server in this process (spawnSync blocks the event loop). */
function runAsync(shell: string, cwd: string, command: string): Promise<string> {
  return new Promise((resolve) =>
    execFile(shell, ["-c", command], { cwd, encoding: "utf8", timeout: 30_000 }, (_err, stdout, stderr) =>
      resolve(`${stdout}${stderr}`),
    ),
  )
}

function run(shell: string, cwd: string, command: string) {
  const res = spawnSync(shell, ["-c", command], { cwd, encoding: "utf8", timeout: 30_000 })
  return { code: res.status, out: `${res.stdout}${res.stderr}` }
}

describe.skipIf(!available)("sandbox shell (sandbox-exec)", () => {
  let root: string
  let home: string
  let conv: string
  let outside: string
  let wrapper: ReturnType<typeof installWrapper>
  let local: http.Server
  let localPort = 0

  beforeAll(async () => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(workRoot(), "sbx-")))
    wrapper = installWrapper(root)
    // Not under a temp root, so writes here are only allowed when it is the working folder.
    home = fs.realpathSync(fs.mkdtempSync(path.join(os.homedir(), ".opal-sandbox-it-")))
    conv = path.join(home, "conversation")
    outside = path.join(home, "outside")
    fs.mkdirSync(conv)
    fs.mkdirSync(outside)
    local = http.createServer((_req, res) => res.end("local"))
    await new Promise<void>((r) => local.listen(0, "127.0.0.1", r))
    localPort = (local.address() as { port: number }).port
  })

  afterAll(async () => {
    await new Promise((r) => local?.close(r))
    if (home) fs.rmSync(home, { recursive: true, force: true })
  })

  it("filesystem mode: writes inside the working folder, denies writes elsewhere", () => {
    wrapper.configure("filesystem")
    const res = run(
      wrapper.shell,
      conv,
      `echo hi > ok.txt; echo x > ${shq(path.join(outside, "denied.txt"))}`,
    )
    expect(fs.readFileSync(path.join(conv, "ok.txt"), "utf8")).toBe("hi\n")
    expect(fs.existsSync(path.join(outside, "denied.txt"))).toBe(false)
    expect(res.out).toMatch(/operation not permitted/i)
  })

  it("protects Opal's own sandbox config even when its folder is allowed", () => {
    wrapper.configure("filesystem", [root])
    const config = path.join(root, "bin", "sandbox", "config.env")
    run(
      wrapper.shell,
      conv,
      `echo OPAL_SANDBOX_MODE=off > ${shq(config)}; echo ok > ${shq(path.join(root, "allowed.txt"))}`,
    )
    expect(fs.readFileSync(config, "utf8")).toContain("OPAL_SANDBOX_MODE=filesystem")
    expect(fs.existsSync(path.join(root, "allowed.txt"))).toBe(true)
  })

  it("extra allowed folders become writable", () => {
    wrapper.configure("filesystem", [outside])
    run(wrapper.shell, conv, `echo y > ${shq(path.join(outside, "extra.txt"))}`)
    expect(fs.existsSync(path.join(outside, "extra.txt"))).toBe(true)
  })

  it("strict mode blocks outbound network but allows localhost", async () => {
    wrapper.configure("strict")
    const remote = run(wrapper.shell, conv, "nc -z -G 3 1.1.1.1 443 && echo CONNECTED || echo BLOCKED")
    expect(remote.out).toContain("BLOCKED")
    expect(await runAsync(wrapper.shell, conv, `curl -s -m 5 http://127.0.0.1:${localPort}/`)).toBe("local")
  })

  it("scrubs the engine's credentials from the environment in every mode", () => {
    for (const mode of ["off", "filesystem"] as const) {
      wrapper.configure(mode)
      const res = spawnSync(
        wrapper.shell,
        ["-c", "printenv OPENCODE_PASSWORD; printenv OPENCODE_SERVER_PASSWORD; echo end"],
        {
          cwd: conv,
          encoding: "utf8",
          env: { ...process.env, OPENCODE_PASSWORD: "top-secret", OPENCODE_SERVER_PASSWORD: "also-secret" },
        },
      )
      expect(res.stdout).not.toContain("secret")
      expect(res.stdout).toContain("end")
    }
  })

  it("hides the engine's data, config and credentials from commands but keeps Code worktrees readable", () => {
    const db = path.join(root, "opencode", "data", "opencode", "opencode.db")
    const cfg = path.join(root, "opencode", "config", "opencode", "opencode.json")
    const worktreeFile = path.join(root, "opencode", "data", "opencode", "worktree", "w1", "file.txt")
    for (const f of [db, cfg, worktreeFile]) fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(db, "sqlite-with-api-keys")
    fs.writeFileSync(cfg, "{}")
    fs.writeFileSync(worktreeFile, "worktree-ok")
    wrapper.configure("filesystem")
    const res = run(wrapper.shell, conv, `cat ${shq(db)}; cat ${shq(cfg)}; cat ${shq(worktreeFile)}`)
    expect(res.out).not.toContain("sqlite-with-api-keys")
    expect(res.out).toMatch(/operation not permitted/i)
    expect(res.out).toContain("worktree-ok")
  })

  it("denies the engine's loopback ports in filesystem mode", async () => {
    wrapper.configure("filesystem", [], [localPort])
    expect(
      await runAsync(wrapper.shell, conv, `curl -s -m 5 http://127.0.0.1:${localPort}/ || echo DENIED`),
    ).toContain("DENIED")
    wrapper.configure("filesystem")
    expect(await runAsync(wrapper.shell, conv, `curl -s -m 5 http://127.0.0.1:${localPort}/`)).toBe("local")
  })

  it("off mode runs plain zsh", () => {
    wrapper.configure("off")
    run(wrapper.shell, conv, `echo z > ${shq(path.join(outside, "off.txt"))}`)
    expect(fs.existsSync(path.join(outside, "off.txt"))).toBe(true)
  })

  it("keeps zsh semantics (ZSH_NAME, -l login shells)", () => {
    wrapper.configure("filesystem")
    const out = execFileSync(wrapper.shell, ["-l", "-c", "echo $ZSH_NAME; [[ -o login ]] && echo login"], {
      cwd: conv,
      encoding: "utf8",
    })
    expect(out).toContain("zsh")
    expect(out).toContain("login")
  })

  describe("as OpenCode's configured shell", () => {
    let server: TestServer

    beforeAll(async () => {
      wrapper.configure("filesystem")
      // The `shell` key exactly as buildOpenCodeConfig emits it.
      const generated = buildOpenCodeConfig({
        settings: {
          theme: "system",
          maxConcurrentConnections: 3,
          defaultMode: "artifact",
          promptOverrides: {},
          providers: [],
          projects: [],
          codeSurface: { useWorktrees: true, permissionMode: "ask" },
          sidebarCollapsed: false,
          lastSurface: "chat",
          sandbox: { mode: "filesystem", allowPaths: [] },
          remote: { enabled: false, lan: true },
          updates: { autoCheck: true },
          imageFallback: { enabled: true },
        },
        prompts: { artifact: "a", code: "c", general: "g", research: "r" },
        sandboxShellPath: wrapper.shell,
      })
      expect(generated.shell).toBe(wrapper.shell)
      server = await startServer({ ...harnessConfig(), shell: generated.shell })
    })

    afterAll(async () => {
      await server?.stop()
    })

    it("runs session shell commands through the sandbox", async () => {
      const id = newSessionID()
      await server.client.session.create({ id, location: { directory: conv } })
      await server.client.session.shell({
        sessionID: id,
        command: `echo via-opencode > oc.txt; echo x > ${shq(path.join(outside, "oc-denied.txt"))}`,
      })
      await waitFor(() => fs.existsSync(path.join(conv, "oc.txt")) || undefined, 30_000)
      expect(fs.readFileSync(path.join(conv, "oc.txt"), "utf8")).toBe("via-opencode\n")
      // Give the second redirect time to (not) happen, then check the transcript shows the denial.
      const output = await waitFor(async () => {
        const page = await server.client.message.list({ sessionID: id, limit: 20 })
        const text = JSON.stringify(page.data)
        return /operation not permitted/i.test(text) ? text : undefined
      }, 30_000)
      expect(output).toMatch(/oc-denied\.txt/)
      expect(fs.existsSync(path.join(outside, "oc-denied.txt"))).toBe(false)
    })
  })
})
