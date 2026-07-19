const { app, BrowserWindow, dialog, ipcMain, Menu, systemPreferences } = require('electron')
const { execFile, execFileSync, spawn } = require('child_process')
const fs = require('fs/promises')
const path = require('path')

const developmentRoot = path.join(__dirname, '..', '..')
let configPath
let eventStatePath
let audioPath
let serverPath
let iconPath
let developmentServerAssembly
let converterInputPath
let converterOutputPath
let ffmpegPath
let ffprobePath
const audioExtensions = new Set(['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.aac', '.wma'])
const converterExtensions = new Set(['.wav', '.mp3', '.m4a'])
const fallbackAccentColor = '#3d82f5'
const settingKeys = new Set(['LaunchAtStartup', 'Theme', 'DefaultVolume', 'OutputDevice', 'SmoothScroll'])
const eventStateKeys = new Set(['AudioName', 'Enabled', 'UseCustomVolume', 'TriggerVolume'])
const readBaseConfig = async () => JSON.parse(await fs.readFile(configPath, 'utf8'))
async function readEventState() {
  try {
    const state = JSON.parse(await fs.readFile(eventStatePath, 'utf8'))
    if (!state || typeof state !== 'object' || !state.events || typeof state.events !== 'object' || Array.isArray(state.events)) return { version: 1, events: {} }
    return state
  } catch (error) {
    if (error?.code !== 'ENOENT') sendServerLog('WARN', `Unable to read saved event state: ${error.message}`)
    return { version: 1, events: {} }
  }
}
async function writeEventState(state) {
  await fs.mkdir(path.dirname(eventStatePath), { recursive: true })
  await fs.writeFile(eventStatePath, `${JSON.stringify({ version: 1, events: state.events || {} }, null, 2)}\n`, 'utf8')
}
function extractEventState(config) {
  const events = {}
  for (const [callback, value] of Object.entries(config || {})) {
    if (callback === 'Settings' || !value || typeof value !== 'object') continue
    events[callback] = Object.fromEntries(Object.entries(value).filter(([key]) => eventStateKeys.has(key)))
  }
  return { version: 1, events }
}
async function initializeEventState() {
  try { await fs.access(eventStatePath) } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await writeEventState(extractEventState(await readBaseConfig()))
  }
}
async function readConfig() {
  const config = await readBaseConfig()
  const state = await readEventState()
  for (const [callback, saved] of Object.entries(state.events || {})) {
    if (!config[callback] || typeof config[callback] !== 'object' || !saved || typeof saved !== 'object') continue
    for (const [key, value] of Object.entries(saved)) {
      if (eventStateKeys.has(key)) config[callback][key] = value
    }
  }
  return config
}
async function updateSavedEventState(callback, changes) {
  const config = await readBaseConfig()
  if (!config[callback] || typeof config[callback] !== 'object') throw new Error(`Unknown event callback: ${callback}`)
  const state = await readEventState()
  state.events = state.events || {}
  state.events[callback] = state.events[callback] && typeof state.events[callback] === 'object' ? state.events[callback] : {}
  for (const [key, value] of Object.entries(changes || {})) {
    if (eventStateKeys.has(key)) state.events[callback][key] = value
  }
  await writeEventState(state)
  return { ...config[callback], ...state.events[callback] }
}
const isAudioFile = fileName => audioExtensions.has(path.extname(fileName).toLowerCase())
const isSafeAudioFileName = fileName => typeof fileName === 'string' && fileName.length > 0 && path.basename(fileName) === fileName && isAudioFile(fileName) && !/[<>:"/\\|?*\u0000-\u001f]/.test(fileName) && !/[. ]$/.test(fileName)
const isConverterFile = fileName => converterExtensions.has(path.extname(fileName).toLowerCase())
const isSafeConverterFileName = fileName => typeof fileName === 'string' && fileName.length > 0 && path.basename(fileName) === fileName && isConverterFile(fileName) && !/[<>:"/\\|?*\u0000-\u001f]/.test(fileName) && !/[. ]$/.test(fileName)
function readAccentColor() {
  if (process.platform === 'win32') {
    try {
      const output = execFileSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\DWM', '/v', 'ColorizationColor'], { encoding: 'utf8', windowsHide: true })
      const match = output.match(/ColorizationColor\s+REG_DWORD\s+0x([0-9a-f]+)/i)
      if (match) return `#${match[1].padStart(8, '0').slice(-6)}`
    } catch {
      return fallbackAccentColor
    }
    return fallbackAccentColor
  }
  try {
    const value = systemPreferences.getAccentColor()
    if (typeof value !== 'string') return fallbackAccentColor
    const match = value.match(/^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i)
    return match ? `#${match[1]}` : fallbackAccentColor
  } catch {
    return fallbackAccentColor
  }
}
let serverProcess = null
let audioHostProcess = null
let audioHostBuffer = ''
let audioHostRequestId = 0
const audioHostRequests = new Map()
const previewChannels = new Map()
let converterRunning = false
let gracefulStopTimer = null
let exitAfterServerStops = false
let allowAppQuit = false

function configureRuntimePaths() {
  eventStatePath = path.join(app.getPath('userData'), 'event-state.json')
  const converterRoot = path.join(app.getPath('userData'), 'converter')
  converterInputPath = path.join(converterRoot, 'input')
  converterOutputPath = path.join(converterRoot, 'output')
  iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'TriggerPad.ico')
    : path.join(developmentRoot, 'UI', 'build-resources', 'TriggerPad.ico')
  ffmpegPath = app.isPackaged
    ? path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe')
    : path.join(developmentRoot, 'UI', 'build-resources', 'ffmpeg', 'ffmpeg.exe')
  ffprobePath = app.isPackaged
    ? path.join(process.resourcesPath, 'ffmpeg', 'ffprobe.exe')
    : path.join(developmentRoot, 'UI', 'build-resources', 'ffmpeg', 'ffprobe.exe')
  if (app.isPackaged) {
    const runtimeRoot = path.join(app.getPath('userData'), 'runtime')
    configPath = path.join(runtimeRoot, 'config.json')
    audioPath = path.join(runtimeRoot, 'audio')
    serverPath = path.join(process.resourcesPath, 'server')
  } else {
    configPath = path.join(developmentRoot, 'config.json')
    audioPath = path.join(developmentRoot, 'audio')
    serverPath = path.join(developmentRoot, 'Server')
    developmentServerAssembly = path.join(serverPath, 'bin', 'Debug', 'net8.0-windows', 'TriggerPad.dll')
  }
}

function spawnServerExecutable(args = []) {
  const options = {
    cwd: serverPath,
    windowsHide: true,
    shell: false,
    env: { ...process.env, TRIGGERPAD_CONFIG_PATH: configPath, TRIGGERPAD_EVENT_STATE_PATH: eventStatePath, TRIGGERPAD_AUDIO_PATH: audioPath }
  }
  return app.isPackaged
    ? spawn(path.join(serverPath, 'TriggerPad.Server.exe'), args, options)
    : spawn('dotnet', [developmentServerAssembly, ...args], options)
}

function broadcastPreviewState(state) {
  if (state?.channel) {
    if (state.state === 'started') previewChannels.set(state.channel, state.fileName)
    else if (state.state === 'ended' || state.state === 'stopped' || state.state === 'error') previewChannels.delete(state.channel)
  }
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('audio:preview-state', state)
}

function handleAudioHostLine(line) {
  if (!line.trim()) return
  let message
  try { message = JSON.parse(line) } catch {
    sendServerLog('WARN', `Unable to parse audio host response: ${line}`)
    return
  }
  if (message.type === 'state') {
    broadcastPreviewState(message)
    return
  }
  if (message.type !== 'response' || !message.id) return
  const pending = audioHostRequests.get(message.id)
  if (!pending) return
  audioHostRequests.delete(message.id)
  clearTimeout(pending.timer)
  if (message.ok) pending.resolve(message.result)
  else pending.reject(new Error(message.error || 'Audio host request failed'))
}

function rejectAudioHostRequests(error) {
  for (const pending of audioHostRequests.values()) {
    clearTimeout(pending.timer)
    pending.reject(error)
  }
  audioHostRequests.clear()
}

function ensureAudioHost() {
  if (audioHostProcess && !audioHostProcess.killed) return audioHostProcess
  audioHostBuffer = ''
  const child = spawnServerExecutable(['--audio-host'])
  audioHostProcess = child
  child.stdout.on('data', data => {
    audioHostBuffer += data.toString('utf8')
    const lines = audioHostBuffer.split(/\r?\n/)
    audioHostBuffer = lines.pop() || ''
    lines.forEach(handleAudioHostLine)
  })
  child.stderr.on('data', data => sendServerLog('ERROR', `Audio host: ${data.toString('utf8')}`))
  child.on('error', error => {
    rejectAudioHostRequests(error)
    broadcastPreviewState({ channel: 'system', state: 'error', message: error.message })
  })
  child.on('close', code => {
    if (audioHostProcess === child) audioHostProcess = null
    previewChannels.clear()
    rejectAudioHostRequests(new Error(`Audio host exited with code ${code ?? 'unknown'}`))
  })
  return child
}

function sendAudioHostCommand(command, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const child = ensureAudioHost()
    const id = `audio-${Date.now()}-${++audioHostRequestId}`
    const timer = setTimeout(() => {
      audioHostRequests.delete(id)
      reject(new Error('Audio host request timed out'))
    }, timeoutMs)
    audioHostRequests.set(id, { resolve, reject, timer })
    child.stdin.write(`${JSON.stringify({ id, ...command })}\n`, error => {
      if (!error) return
      const pending = audioHostRequests.get(id)
      if (!pending) return
      audioHostRequests.delete(id)
      clearTimeout(timer)
      reject(error)
    })
  })
}

function stopAudioHost() {
  const child = audioHostProcess
  audioHostProcess = null
  if (!child || child.killed) return
  try { child.stdin.write(`${JSON.stringify({ id: 'shutdown', command: 'shutdown' })}\n`) } catch { /* process already closed */ }
  const timer = setTimeout(() => { if (!child.killed) child.kill() }, 1000)
  child.once('close', () => clearTimeout(timer))
}

async function stopPreviewChannelsForFile(fileName) {
  const channels = [...previewChannels.entries()].filter(([, playingFile]) => !fileName || playingFile === fileName).map(([channel]) => channel)
  await Promise.allSettled(channels.map(channel => sendAudioHostCommand({ command: 'stop', channel })))
}

async function initializeRuntimeData() {
  await fs.mkdir(converterInputPath, { recursive: true })
  await fs.mkdir(converterOutputPath, { recursive: true })
  if (!app.isPackaged) return
  const defaultsRoot = path.join(process.resourcesPath, 'defaults')
  await fs.mkdir(audioPath, { recursive: true })
  try { await fs.access(configPath) } catch { await fs.copyFile(path.join(defaultsRoot, 'config.json'), configPath) }
  const defaultAudioPath = path.join(defaultsRoot, 'audio')
  try {
    await fs.access(defaultAudioPath)
    await fs.cp(defaultAudioPath, audioPath, { recursive: true, force: false, errorOnExist: false })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

function sendServerLog(level, message) {
  const text = String(message).trim()
  if (!text) return
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('server:log', { level, message: text })
}

function requestServerStop({ quitApp = false } = {}) {
  if (quitApp) exitAfterServerStops = true
  if (!serverProcess) return false
  if (gracefulStopTimer) return true
  if (serverProcess.stdin?.writable) {
    serverProcess.stdin.write('\n')
    sendServerLog('INFO', 'Stop signal sent to Server input.')
    gracefulStopTimer = setTimeout(() => {
      if (!serverProcess) return
      sendServerLog('WARN', 'Server did not exit in time; forcing process termination.')
      serverProcess.kill()
    }, 5000)
  } else {
    serverProcess.kill()
    sendServerLog('WARN', 'Server input is unavailable; forcing process termination.')
  }
  return true
}

function clearResidualServerProcesses() {
  if (app.isPackaged) return Promise.resolve()
  const serverBin = path.join(serverPath, 'bin').replace(/'/g, "''")
  const command = `$root = '${serverBin}'; $targets = @(Get-Process -Name TriggerPad -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) }); $targets | Stop-Process -Force; $targets.Count`
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true }, (error, stdout) => {
      const count = Number.parseInt(stdout.trim(), 10) || 0
      if (count > 0) sendServerLog('WARN', `Cleared ${count} residual Server process(es) before startup.`)
      else if (error) sendServerLog('WARN', `Unable to check residual Server processes: ${error.message}`)
      resolve()
    })
  })
}

async function listAudio() {
  await fs.mkdir(audioPath, { recursive: true })
  const entries = await fs.readdir(audioPath, { withFileTypes: true })
  return entries.filter(entry => entry.isFile() && isAudioFile(entry.name)).map(entry => ({
    fileName: entry.name,
    audioName: path.parse(entry.name).name
  })).sort((a, b) => a.fileName.localeCompare(b.fileName, 'zh-CN'))
}

async function uniqueDestination(fileName) {
  return uniqueDestinationIn(audioPath, fileName)
}

async function uniqueDestinationIn(directory, fileName) {
  const parsed = path.parse(fileName)
  let candidate = fileName
  let index = 1
  while (true) {
    try { await fs.access(path.join(directory, candidate)); candidate = `${parsed.name} (${index++})${parsed.ext}` } catch { return path.join(directory, candidate) }
  }
}

async function listConverterFiles(directory) {
  await fs.mkdir(directory, { recursive: true })
  const entries = await fs.readdir(directory, { withFileTypes: true })
  return entries.filter(entry => entry.isFile() && isConverterFile(entry.name)).map(entry => ({
    fileName: entry.name,
    audioName: path.parse(entry.name).name
  })).sort((a, b) => a.fileName.localeCompare(b.fileName, 'zh-CN'))
}

function sendConverterProgress(payload) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('converter:progress', payload)
}

function execFileText(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr
        reject(error)
        return
      }
      resolve(stdout)
    })
  })
}

async function readAudioDuration(filePath) {
  const output = await execFileText(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath])
  const duration = Number.parseFloat(String(output).trim())
  return Number.isFinite(duration) && duration > 0 ? duration : 0
}

function ffmpegArguments(inputPath, outputPath, targetFormat) {
  const codecArguments = targetFormat === 'wav'
    ? ['-c:a', 'pcm_s16le']
    : targetFormat === 'mp3'
      ? ['-c:a', 'libmp3lame', '-b:a', '192k']
      : ['-c:a', 'aac', '-b:a', '192k']
  return ['-y', '-i', inputPath, '-map', '0:a:0', '-vn', ...codecArguments, '-progress', 'pipe:1', '-nostats', outputPath]
}

function runConversion(inputPath, outputPath, targetFormat, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ffmpegArguments(inputPath, outputPath, targetFormat), { windowsHide: true, shell: false })
    let stderr = ''
    let stdoutBuffer = ''
    child.stdout.on('data', chunk => {
      stdoutBuffer += chunk.toString('utf8')
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() || ''
      for (const line of lines) {
        const match = line.match(/^out_time_(?:us|ms)=(\d+)$/)
        if (match) onProgress(Number(match[1]))
      }
    })
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8000) })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `FFmpeg exited with code ${code ?? 'unknown'}`))
    })
  })
}

async function convertQueuedAudio(targetFormat) {
  if (!['wav', 'mp3', 'm4a'].includes(targetFormat)) throw new Error('Invalid target format')
  if (converterRunning) throw new Error('Conversion is already running')
  converterRunning = true
  const statuses = {}
  try {
    await fs.access(ffmpegPath)
    await fs.access(ffprobePath)
    const inputs = await listConverterFiles(converterInputPath)
    if (!inputs.length) throw new Error('No audio files to convert')
    for (const input of inputs) {
      const inputPath = path.join(converterInputPath, input.fileName)
      const destination = await uniqueDestinationIn(converterOutputPath, `${path.parse(input.fileName).name}.${targetFormat}`)
      statuses[input.fileName] = { state: 'running', progress: 0 }
      sendConverterProgress({ fileName: input.fileName, state: 'running', progress: 0 })
      try {
        const duration = await readAudioDuration(inputPath)
        await runConversion(inputPath, destination, targetFormat, outputTime => {
          const progress = duration > 0 ? Math.min(99, Math.max(0, Math.floor((outputTime / 1000000) / duration * 100))) : 0
          statuses[input.fileName] = { state: 'running', progress }
          sendConverterProgress({ fileName: input.fileName, state: 'running', progress })
        })
        statuses[input.fileName] = { state: 'success', progress: 100 }
        sendConverterProgress({ fileName: input.fileName, state: 'success', progress: 100 })
      } catch (error) {
        await fs.rm(destination, { force: true })
        statuses[input.fileName] = { state: 'error', progress: 0, message: error.message }
        sendConverterProgress({ fileName: input.fileName, state: 'error', progress: 0, message: error.message })
      }
    }
    return { inputFiles: await listConverterFiles(converterInputPath), outputFiles: await listConverterFiles(converterOutputPath), statuses }
  } finally {
    converterRunning = false
  }
}

ipcMain.handle('config:read', () => readConfig())
ipcMain.handle('config:bind-audio', async (_event, { callback, audioName }) => {
  await updateSavedEventState(callback, { AudioName: audioName })
  return readConfig()
})
ipcMain.handle('config:set-event-enabled', async (_event, { callback, enabled }) => {
  return updateSavedEventState(callback, { Enabled: Boolean(enabled) })
})
ipcMain.handle('config:update-event-audio', async (_event, { callback, changes }) => {
  const normalized = {}
  if (Object.prototype.hasOwnProperty.call(changes || {}, 'UseCustomVolume')) normalized.UseCustomVolume = Boolean(changes.UseCustomVolume)
  if (Object.prototype.hasOwnProperty.call(changes || {}, 'TriggerVolume')) {
    const volume = Number(changes.TriggerVolume)
    if (!Number.isFinite(volume)) throw new Error('Invalid trigger volume')
    normalized.TriggerVolume = Math.max(0, Math.min(100, Math.round(volume)))
  }
  return updateSavedEventState(callback, normalized)
})
ipcMain.handle('settings:update', async (_event, changes) => {
  const config = await readBaseConfig()
  config.Settings = config.Settings || {}
  for (const [key, value] of Object.entries(changes || {})) {
    if (settingKeys.has(key)) config.Settings[key] = value
  }
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return config.Settings
})
ipcMain.handle('audio:list', () => listAudio())
ipcMain.handle('audio:list-output-devices', async () => {
  const devices = await sendAudioHostCommand({ command: 'list-devices' })
  return (devices || []).map(device => ({ id: device.Id, name: device.Name, isDefault: Boolean(device.IsDefault) }))
})
ipcMain.handle('audio:preview-play', async (_event, options) => {
  const channel = options?.channel
  const fileName = options?.fileName
  if (!['pool', 'test'].includes(channel)) throw new Error('Invalid preview channel')
  if (!isSafeAudioFileName(fileName)) throw new Error('Invalid audio file name')
  const result = await sendAudioHostCommand({
    command: 'play', channel, fileName,
    volume: Math.max(0, Math.min(100, Math.round(Number(options?.volume) || 0))),
    outputDevice: typeof options?.outputDevice === 'string' ? options.outputDevice : 'default'
  })
  const normalized = { deviceId: result.DeviceId, deviceName: result.DeviceName, usedFallback: Boolean(result.UsedFallback) }
  if (normalized.usedFallback) sendServerLog('WARN', `Selected audio output is unavailable; using ${normalized.deviceName}.`)
  return normalized
})
ipcMain.handle('audio:preview-stop', async (_event, channel) => {
  if (!['pool', 'test'].includes(channel)) throw new Error('Invalid preview channel')
  const result = await sendAudioHostCommand({ command: 'stop', channel })
  return { stopped: Boolean(result?.stopped ?? result?.Stopped) }
})
ipcMain.handle('audio:read', async (_event, fileName) => {
  if (!isAudioFile(fileName) || path.basename(fileName) !== fileName) throw new Error('Invalid audio file name')
  const extension = path.extname(fileName).toLowerCase()
  const mimeTypes = {
    '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
    '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wma': 'audio/x-ms-wma'
  }
  const data = await fs.readFile(path.join(audioPath, fileName))
  return `data:${mimeTypes[extension] || 'application/octet-stream'};base64,${data.toString('base64')}`
})
ipcMain.handle('audio:import', async event => {
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: '导入音频', properties: ['openFile', 'multiSelections'],
    filters: [{ name: '音频文件', extensions: [...audioExtensions].map(ext => ext.slice(1)) }]
  })
  if (result.canceled) return { canceled: true, files: await listAudio() }
  await fs.mkdir(audioPath, { recursive: true })
  for (const sourcePath of result.filePaths) {
    const destination = await uniqueDestination(path.basename(sourcePath))
    await fs.copyFile(sourcePath, destination)
  }
  return { canceled: false, files: await listAudio() }
})
ipcMain.handle('audio:rename', async (_event, { oldFileName, newFileName }) => {
  if (!isSafeAudioFileName(oldFileName) || !isSafeAudioFileName(newFileName)) throw new Error('Invalid audio file name')
  if (path.extname(oldFileName).toLowerCase() !== path.extname(newFileName).toLowerCase()) throw new Error('Audio file extension cannot be changed')
  if (oldFileName === newFileName) return { files: await listAudio() }
  const oldPath = path.join(audioPath, oldFileName)
  const newPath = path.join(audioPath, newFileName)
  try { await fs.access(newPath); throw new Error('An audio file with that name already exists') } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await stopPreviewChannelsForFile(oldFileName)
  await fs.rename(oldPath, newPath)
  const state = await readEventState()
  let changed = false
  for (const value of Object.values(state.events || {})) {
    if (value && typeof value === 'object' && value.AudioName === oldFileName) {
      value.AudioName = newFileName
      changed = true
    }
  }
  if (changed) await writeEventState(state)
  return { files: await listAudio() }
})
ipcMain.handle('audio:remove', async (_event, fileName) => {
  if (!isAudioFile(fileName) || path.basename(fileName) !== fileName) throw new Error('Invalid audio file name')
  await stopPreviewChannelsForFile(fileName)
  await fs.rm(path.join(audioPath, fileName), { force: true })
  return listAudio()
})
ipcMain.handle('audio:clear', async () => {
  await stopPreviewChannelsForFile()
  const files = await listAudio()
  await Promise.all(files.map(file => fs.rm(path.join(audioPath, file.fileName), { force: true })))
  return []
})
ipcMain.handle('converter:list-input', () => listConverterFiles(converterInputPath))
ipcMain.handle('converter:list-output', () => listConverterFiles(converterOutputPath))
ipcMain.handle('converter:import', async event => {
  if (converterRunning) throw new Error('Conversion is running')
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: '导入待转换音频', properties: ['openFile', 'multiSelections'],
    filters: [{ name: '音频文件', extensions: [...converterExtensions].map(ext => ext.slice(1)) }]
  })
  if (result.canceled) return { canceled: true, files: await listConverterFiles(converterInputPath) }
  await fs.mkdir(converterInputPath, { recursive: true })
  for (const sourcePath of result.filePaths) {
    const destination = await uniqueDestinationIn(converterInputPath, path.basename(sourcePath))
    await fs.copyFile(sourcePath, destination)
  }
  return { canceled: false, files: await listConverterFiles(converterInputPath) }
})
ipcMain.handle('converter:remove-input', async (_event, fileName) => {
  if (converterRunning) throw new Error('Conversion is running')
  if (!isSafeConverterFileName(fileName)) throw new Error('Invalid converter audio file name')
  await fs.rm(path.join(converterInputPath, fileName), { force: true })
  return listConverterFiles(converterInputPath)
})
ipcMain.handle('converter:clear-input', async () => {
  if (converterRunning) throw new Error('Conversion is running')
  const files = await listConverterFiles(converterInputPath)
  await Promise.all(files.map(file => fs.rm(path.join(converterInputPath, file.fileName), { force: true })))
  return []
})
ipcMain.handle('converter:convert', async (_event, targetFormat) => convertQueuedAudio(targetFormat))
ipcMain.handle('converter:clear-output', async () => {
  if (converterRunning) throw new Error('Conversion is running')
  const files = await listConverterFiles(converterOutputPath)
  await Promise.all(files.map(file => fs.rm(path.join(converterOutputPath, file.fileName), { force: true })))
  return []
})
ipcMain.handle('converter:add-to-audio-pool', async (_event, fileNames) => {
  if (converterRunning) throw new Error('Conversion is running')
  if (!Array.isArray(fileNames)) throw new Error('Invalid output selection')
  const selected = [...new Set(fileNames)]
  for (const fileName of selected) {
    if (!isSafeConverterFileName(fileName)) throw new Error('Invalid converter audio file name')
    const source = path.join(converterOutputPath, fileName)
    await fs.access(source)
    const destination = await uniqueDestination(fileName)
    await fs.copyFile(source, destination)
  }
  return listAudio()
})
ipcMain.handle('window:minimize', event => BrowserWindow.fromWebContents(event.sender)?.minimize())
ipcMain.handle('window:is-maximized', event => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false)
ipcMain.handle('window:is-always-on-top', event => BrowserWindow.fromWebContents(event.sender)?.isAlwaysOnTop() ?? false)
ipcMain.handle('window:get-accent-color', () => readAccentColor())
ipcMain.handle('window:toggle-maximize', event => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return false
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
  return win.isMaximized()
})
ipcMain.handle('window:toggle-always-on-top', event => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return false
  const next = !win.isAlwaysOnTop()
  win.setAlwaysOnTop(next)
  win.webContents.send('window:always-on-top', next)
  return next
})
ipcMain.handle('window:close', event => BrowserWindow.fromWebContents(event.sender)?.close())
ipcMain.handle('server:start', async () => {
  if (serverProcess) return { started: false, message: 'Server is already running.' }
  try {
    await fs.access(serverPath)
    await clearResidualServerProcesses()
    if (!app.isPackaged) await fs.access(developmentServerAssembly)
    serverProcess = spawnServerExecutable()
    serverProcess.stdout.on('data', data => sendServerLog('INFO', data.toString('utf8')))
    serverProcess.stderr.on('data', data => sendServerLog('ERROR', data.toString('utf8')))
    serverProcess.on('error', error => sendServerLog('ERROR', `Unable to start Server: ${error.message}`))
    serverProcess.on('close', code => {
      if (gracefulStopTimer) clearTimeout(gracefulStopTimer)
      gracefulStopTimer = null
      sendServerLog(code === 0 ? 'INFO' : 'ERROR', `Server process exited with code ${code ?? 'unknown'}.`)
      serverProcess = null
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send('server:status', { running: false })
      if (exitAfterServerStops) {
        exitAfterServerStops = false
        allowAppQuit = true
        app.quit()
      }
    })
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('server:status', { running: true })
    sendServerLog('INFO', app.isPackaged ? 'Starting packaged Server.' : 'Starting built Server assembly.')
    return { started: true }
  } catch (error) {
    sendServerLog('ERROR', `Server directory is unavailable: ${error.message}`)
    return { started: false, message: error.message }
  }
})
ipcMain.handle('server:stop', () => {
  return { stopped: requestServerStop() }
})

const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 800,
    minHeight: 600,
    center: true,
    title: 'TriggerPad v0.1.0',
    frame: false,
    resizable: true,
    thickFrame: true,
    backgroundColor: '#1b1b1b',
    icon: iconPath,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.cjs') }
  })
  win.on('close', event => {
    if (!serverProcess || allowAppQuit) return
    event.preventDefault()
    requestServerStop({ quitApp: true })
  })
  const broadcastWindowState = () => {
    const maximized = win.isMaximized()
    win.webContents.send('window:maximized', maximized)
  }
  const broadcastTopState = () => win.webContents.send('window:always-on-top', win.isAlwaysOnTop())
  win.on('maximize', broadcastWindowState)
  win.on('unmaximize', broadcastWindowState)
  win.webContents.once('did-finish-load', broadcastWindowState)
  win.webContents.once('did-finish-load', broadcastTopState)
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(async () => {
  configureRuntimePaths()
  await initializeRuntimeData()
  await initializeEventState()
  Menu.setApplicationMenu(null)
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('before-quit', event => {
  if (!serverProcess || allowAppQuit) return
  event.preventDefault()
  requestServerStop({ quitApp: true })
})
app.on('will-quit', stopAudioHost)
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
