import { Check, Copy, ExternalLink, LoaderCircle, RefreshCw, Smartphone } from "lucide-react"
import { useEffect, useState } from "react"
import { remoteRuntime, runtime } from "@/lib/runtime"
import type { RemotePairing } from "@/lib/runtime/contracts"
import { isTauri } from "@/lib/utils"
import { Button, PageHeader, SectionTitle, SettingRow, Switch } from "../controls"
import { errorMessage } from "../providers/shared"
import { QrCode } from "../remote/QrCode"

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

function formatRemaining(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={label}
      icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  )
}

export function RemotePage() {
  const settings = runtime.useSettings()
  const { status, busy, error: statusError } = remoteRuntime.useStatus()
  const [pairing, setPairing] = useState<RemotePairing>()
  const [pairingBusy, setPairingBusy] = useState(false)
  const [error, setError] = useState<string>()
  const now = useNow(!!pairing)
  const enabled = settings.remote.enabled
  const desktop = isTauri()
  const expired = pairing ? pairing.expiresAt <= now : false

  const run = async (fn: () => Promise<unknown>) => {
    setError(undefined)
    try {
      await fn()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const pair = () =>
    run(async () => {
      setPairingBusy(true)
      try {
        setPairing(await remoteRuntime.pair())
      } finally {
        setPairingBusy(false)
      }
    })

  if (!desktop)
    return (
      <div>
        <PageHeader title="Remote control" />
        <p className="text-[13px] leading-relaxed text-fg-muted">
          Remote control is turned on and managed from the Opal desktop app on your Mac.
        </p>
      </div>
    )

  return (
    <div>
      <PageHeader
        title="Remote control"
        description="Continue your Opal conversations from your phone or another computer on the same network."
      />

      <div>
        <SettingRow
          label="Allow other devices to connect"
          description="Starts a private web version of Opal on your local network. Turning this off disconnects every paired device."
          htmlFor="settings-remote"
        >
          <Switch
            id="settings-remote"
            checked={enabled}
            disabled={busy}
            onCheckedChange={(on) => {
              setPairing(undefined)
              void run(() => (on ? remoteRuntime.enable() : remoteRuntime.disable()))
            }}
          />
        </SettingRow>
        {enabled && (
          <SettingRow
            label="Listen on the local network"
            description="Reachable from devices on your Wi-Fi (and your Tailscale network). Turn off to allow only this Mac, e.g. through an SSH tunnel."
            htmlFor="settings-remote-lan"
          >
            <Switch
              id="settings-remote-lan"
              checked={settings.remote.lan}
              disabled={busy}
              onCheckedChange={(lan) => void run(() => remoteRuntime.setLan(lan))}
            />
          </SettingRow>
        )}
      </div>

      <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-[12.5px] leading-relaxed text-fg-muted">
        <li>Each pairing link works once and expires after 5 minutes.</li>
        <li>
          The paired device keeps its own sign-in token in its browser; your server password never leaves this
          Mac.
        </li>
        <li>Only devices on the same Wi-Fi can reach Opal, unless you set up a tunnel such as Tailscale.</li>
        <li>Traffic on your network is not encrypted (plain HTTP). Use trusted networks only.</li>
      </ul>

      {enabled && (
        <>
          <SectionTitle>Pair a device</SectionTitle>
          {status?.networkChanged && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-[12.5px] text-fg-secondary">
              Your network changed since Opal started listening.
              <Button
                size="sm"
                icon={<RefreshCw className="size-3.5" />}
                onClick={() => void run(() => remoteRuntime.setLan(settings.remote.lan))}
              >
                Refresh
              </Button>
            </div>
          )}
          {settings.remote.lan && status && status.lanIPs.length === 0 && (
            <p className="mb-3 text-[12.5px] text-fg-muted">
              This Mac has no network address. Connect to Wi-Fi first.
            </p>
          )}
          {!pairing ? (
            <Button
              variant="primary"
              icon={
                pairingBusy ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Smartphone className="size-3.5" />
                )
              }
              disabled={pairingBusy || busy}
              onClick={() => void pair()}
            >
              Pair a device
            </Button>
          ) : (
            <div className="flex gap-5 rounded-md border border-border p-4">
              <div className={expired ? "opacity-30" : undefined}>
                <QrCode value={pairing.link} label="Pairing QR code" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="text-[13px] text-fg">
                  Scan with your phone’s camera, or open the link on the other device.
                </p>
                <div className="flex items-center gap-1">
                  <code
                    className="selectable min-w-0 flex-1 truncate rounded bg-bg-inset px-2 py-1 font-mono text-[11.5px] text-fg-secondary"
                    title={pairing.link}
                  >
                    {pairing.link}
                  </code>
                  <CopyButton text={pairing.link} label="Copy pairing link" />
                </div>
                <p className="text-[12.5px] text-fg-muted" aria-live="polite">
                  {expired
                    ? "This link expired."
                    : `Expires in ${formatRemaining(pairing.expiresAt - now)} · works once`}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    icon={<RefreshCw className="size-3.5" />}
                    disabled={pairingBusy}
                    onClick={() => void pair()}
                  >
                    Regenerate
                  </Button>
                  <a
                    href={pairing.openCodeLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[12.5px] text-fg-muted underline-offset-2 hover:text-fg hover:underline"
                    onClick={(event) => {
                      event.preventDefault()
                      void navigator.clipboard?.writeText(pairing.openCodeLink)
                    }}
                    title="Copies a one-time link to OpenCode’s own web UI (uses the same code)"
                  >
                    <ExternalLink className="size-3" />
                    Copy link to the OpenCode web UI instead
                  </a>
                </div>
              </div>
            </div>
          )}

          <SectionTitle>Connections</SectionTitle>
          <div className="flex flex-col gap-1 text-[12.5px] text-fg-muted">
            <div>
              Opal web:{" "}
              <span className="selectable font-mono text-fg-secondary">{status?.webURL ?? "starting…"}</span>
            </div>
            <div>
              Engine:{" "}
              <span className="selectable font-mono text-fg-secondary">
                {status?.sidecarURL ?? "starting…"}
              </span>
            </div>
            {status?.hostName && (
              <div>
                Also reachable as{" "}
                <span className="selectable font-mono text-fg-secondary">
                  http://{status.hostName}:{status.webPort}
                </span>
              </div>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="danger-ghost"
              disabled={busy}
              onClick={() => void run(() => remoteRuntime.revokeAll())}
            >
              Sign out all devices
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void run(() => remoteRuntime.disable())}>
              Disable
            </Button>
          </div>
        </>
      )}
      {(error || statusError) && <p className="mt-3 text-[12.5px] text-danger">{error ?? statusError}</p>}
    </div>
  )
}
