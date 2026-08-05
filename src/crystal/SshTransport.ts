// =============================================================================
// SshTransport — lightweight wrapper for SSH/SCP over the system ssh/scp binaries
// =============================================================================
//
// Crystal TS port of the legacy `core/services/remote/SshTransport.js` (cutting
// the last crystal→legacy-JS runtime tether ahead of the JS nuke). Behaviour is
// preserved verbatim. Used by SecurePodClient to bootstrap RunPod SECURE pods
// (git clone / pip install / launch runner) and by the VastAI path historically.
//
// Uses the system's ssh/scp binaries (not the node ssh2 library) to run commands
// and move files. Notable details preserved from the original:
//
//   1. SSH vs SCP PORT FLAG — ssh uses lowercase `-p`, scp uses uppercase `-P`.
//      Separate arg getters keep this straight (a classic source of bugs).
//   2. HOST KEY CHECKING is disabled (StrictHostKeyChecking=no + /dev/null known
//      hosts) — appropriate for ephemeral rental compute, not persistent servers.
//   3. STDIO — exec defaults to 'pipe' (captures output); upload/download default
//      to 'inherit' (stream to console).
//   4. SSH MULTIPLEXING — all connections reuse one ControlMaster socket at
//      /tmp/vastai-ctrl-{host}-{port}.sock (ControlPersist=120s), so we don't
//      re-negotiate on every command. close() tears it down explicitly.
// =============================================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

/** The subset of a logger SshTransport writes through. `console` satisfies it. */
export interface SshLogger {
  debug?(msg: string): void
  info?(msg: string): void
}

export interface SshTransportOptions {
  host: string
  port?: number
  username?: string
  privateKeyPath: string
  logger?: SshLogger
}

export interface SshExecOptions {
  /** 'inherit' streams to console; 'pipe' (default) captures output. */
  stdio?: 'inherit' | 'pipe'
  /** Timeout in milliseconds. */
  timeout?: number
}

export interface SshTransferOptions {
  recursive?: boolean
  stdio?: 'inherit' | 'pipe'
}

/** An SSH failure carrying the remote exit code + captured streams. */
export interface SshExecError extends Error {
  code?: number
  output?: string
  stderr?: string
}

export class SshTransport {
  private readonly host: string
  private readonly port: number
  private readonly username: string
  private readonly privateKeyPath: string
  private readonly logger: SshLogger
  private readonly controlPath: string

  constructor({ host, port = 22, username = 'root', privateKeyPath, logger }: SshTransportOptions) {
    if (!host) throw new Error('SshTransport requires host')
    if (!privateKeyPath) throw new Error('SshTransport requires privateKeyPath')
    if (!fs.existsSync(privateKeyPath)) {
      throw new Error(`SSH private key not found at ${privateKeyPath}`)
    }

    this.host = host
    this.port = port
    this.username = username
    this.privateKeyPath = privateKeyPath
    this.logger = logger ?? console

    // Unique socket per host+port so concurrent jobs don't share masters.
    const safeHost = host.replace(/[^a-zA-Z0-9.-]/g, '_')
    this.controlPath = path.join(os.tmpdir(), `vastai-ctrl-${safeHost}-${port}.sock`)
  }

  private get sshTarget(): string {
    return `${this.username}@${this.host}`
  }

  private get commonSshArgs(): string[] {
    return [
      '-i', this.privateKeyPath,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', `ControlPath=${this.controlPath}`,
      '-o', 'ControlMaster=auto',
      '-o', 'ControlPersist=120',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      '-p', String(this.port),
    ]
  }

  private get commonScpArgs(): string[] {
    return [
      '-i', this.privateKeyPath,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', `ControlPath=${this.controlPath}`,
      '-o', 'ControlMaster=auto',
      '-o', 'ControlPersist=120',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      '-P', String(this.port),  // SCP uses uppercase -P for port
    ]
  }

  /**
   * Execute a command on the remote host. Resolves the captured stdout when
   * stdio is 'pipe' (default), or undefined when 'inherit'. Rejects with an
   * SshExecError (carrying code/output/stderr) on non-zero exit.
   */
  exec(command: string, options: SshExecOptions = {}): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      const args = [...this.commonSshArgs, this.sshTarget, command]
      // Redact secrets from log output (HF tokens, API keys, etc.).
      const redacted = command
        .replace(/\b(hf_[A-Za-z0-9]{10,})\b/g, 'hf_***REDACTED***')
        .replace(/((?:TOKEN|KEY|SECRET|PASSWORD)=")[^"]*"/gi, '$1***REDACTED***"')
      this.logger.debug?.(`[SSH] ${redacted}`)

      // Default to 'pipe' to capture output for programmatic use.
      const stdio = options.stdio ?? 'pipe'
      const ssh = spawn('ssh', args, { stdio })

      let stdout = ''
      let stderr = ''

      if (stdio === 'pipe') {
        ssh.stdout?.on('data', (data) => { stdout += data.toString() })
        ssh.stderr?.on('data', (data) => { stderr += data.toString() })
      }

      let timeoutId: NodeJS.Timeout | null = null
      if (options.timeout) {
        timeoutId = setTimeout(() => {
          ssh.kill('SIGTERM')
          reject(new Error(`SSH command timed out after ${options.timeout}ms`))
        }, options.timeout)
      }

      ssh.on('close', (code) => {
        if (timeoutId) clearTimeout(timeoutId)

        if (stdout && this.logger.debug) {
          this.logger.debug(`[SSH stdout] ${stdout.substring(0, 500)}`)
        }

        if (code === 0) {
          resolve(stdio === 'pipe' ? stdout : undefined)
        } else {
          const error = new Error(`SSH command failed with code ${code}`) as SshExecError
          error.code = code ?? undefined
          error.output = stdout
          error.stderr = stderr
          reject(error)
        }
      })
      ssh.on('error', (err) => {
        if (timeoutId) clearTimeout(timeoutId)
        reject(err)
      })
    })
  }

  upload(localPath: string, remotePath: string, options: SshTransferOptions = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [...this.commonScpArgs]
      if (options.recursive) args.push('-r')
      args.push(localPath, `${this.sshTarget}:${remotePath}`)
      this.logger.info?.(`[SCP] ${localPath} -> ${remotePath}`)
      const scp = spawn('scp', args, { stdio: options.stdio ?? 'inherit' })
      scp.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`SCP failed with code ${code}`))
      })
      scp.on('error', reject)
    })
  }

  download(remotePath: string, localPath: string, options: SshTransferOptions = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [...this.commonScpArgs]
      if (options.recursive) args.push('-r')
      args.push(`${this.sshTarget}:${remotePath}`, localPath)
      this.logger.info?.(`[SCP] ${remotePath} -> ${localPath}`)
      const scp = spawn('scp', args, { stdio: options.stdio ?? 'inherit' })
      scp.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`SCP download failed with code ${code}`))
      })
      scp.on('error', reject)
    })
  }

  /**
   * Explicitly close the SSH master connection so its socket is cleaned up.
   * Safe to call even if no master is running (errors are swallowed).
   */
  close(): Promise<void> {
    return new Promise((resolve) => {
      const args = [
        '-i', this.privateKeyPath,
        '-o', `ControlPath=${this.controlPath}`,
        '-o', 'ControlMaster=no',
        '-O', 'exit',
        this.sshTarget,
      ]
      const ssh = spawn('ssh', args, { stdio: 'pipe' })
      ssh.on('close', () => resolve())
      ssh.on('error', () => resolve())  // master may already be gone
    })
  }
}
