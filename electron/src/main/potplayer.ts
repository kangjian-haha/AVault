import { existsSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { join } from 'node:path'
import type { AppDatabase } from './database'

const EXECUTABLES = ['PotPlayerMini64.exe', 'PotPlayerMini.exe']

function registryCandidates(): string[] {
  const paths: string[] = []
  for (const executable of EXECUTABLES) {
    for (const hive of ['HKCU', 'HKLM']) {
      try {
        const output = execFileSync('reg.exe', [
          'query', `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executable}`,
          '/ve'
        ], { encoding: 'utf8', windowsHide: true })
        const match = output.match(/REG_SZ\s+(.+)$/m)
        if (match) paths.push(match[1].trim())
      } catch {
        // The registry key is optional.
      }
    }
  }
  return paths
}

export function detectPotPlayer(): string | null {
  const programFiles = process.env.ProgramFiles
  const programFilesX86 = process.env['ProgramFiles(x86)']
  const candidates = [
    ...registryCandidates(),
    programFiles ? join(programFiles, 'DAUM', 'PotPlayer', 'PotPlayerMini64.exe') : '',
    programFiles ? join(programFiles, 'PotPlayer', 'PotPlayerMini64.exe') : '',
    programFilesX86 ? join(programFilesX86, 'DAUM', 'PotPlayer', 'PotPlayerMini.exe') : ''
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export class PotPlayerService {
  constructor(private readonly database: AppDatabase) {}

  getPath(): string | null {
    const configured = this.database.getSetting('potPlayerPath')
    if (configured && existsSync(configured)) return configured
    const detected = detectPotPlayer()
    if (detected) this.database.setSetting('potPlayerPath', detected)
    return detected
  }

  setPath(path: string): void {
    if (!existsSync(path) || !EXECUTABLES.some((name) => path.toLowerCase().endsWith(name.toLowerCase()))) {
      throw new Error('请选择 PotPlayerMini64.exe 或 PotPlayerMini.exe')
    }
    this.database.setSetting('potPlayerPath', path)
  }

  play(filePath: string): void {
    const executable = this.getPath()
    if (!executable) throw new Error('未找到 PotPlayer，请先在设置中选择播放器')
    if (!existsSync(filePath)) throw new Error('影片文件不存在或已被移动')
    const child = spawn(executable, [filePath], { detached: true, stdio: 'ignore', windowsHide: false })
    child.unref()
  }
}
