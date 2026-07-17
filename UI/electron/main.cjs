const { app, BrowserWindow, dialog, ipcMain, Menu, systemPreferences } = require('electron')
const { execFile, execFileSync, spawn } = require('child_process')
const fs = require('fs/promises')
const path = require('path')

const developmentRoot = path.join(__dirname, '..', '..')
let configPath
let audioPath
let serverPath
let iconPath
const audioExtensions = new Set(['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.aac', '.wma'])
const fallbackAccentColor = '#3d82f5'
const settingKeys = new Set(['LaunchAtStartup', 'Theme', 'DefaultVolume', 'OutputDevice'])
const readConfig = async () => JSON.parse(await fs.readFile(configPath, 'utf8'))
const isAudioFile = fileName => audioExtensions.has(path.extname(fileName).toLowerCase())
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
let gracefulStopTimer = null
let exitAfterServerStops = false
let allowAppQuit = false

function configureRuntimePaths() {
  iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'TriggerPad.ico')
    : path.join(developmentRoot, 'UI', 'build-resources', 'TriggerPad.ico')
  if (app.isPackaged) {
    const runtimeRoot = path.join(app.getPath('userData'), 'runtime')
    configPath = path.join(runtimeRoot, 'config.json')
    audioPath = path.join(runtimeRoot, 'audio')
    serverPath = path.join(process.resourcesPath, 'server')
  } else {
    configPath = path.join(developmentRoot, 'config.json')
    audioPath = path.join(developmentRoot, 'audio')
    serverPath = path.join(developmentRoot, 'Server')
  }
}

async function initializeRuntimeData() {
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
  const parsed = path.parse(fileName)
  let candidate = fileName
  let index = 1
  while (true) {
    try { await fs.access(path.join(audioPath, candidate)); candidate = `${parsed.name} (${index++})${parsed.ext}` } catch { return path.join(audioPath, candidate) }
  }
}

ipcMain.handle('config:read', () => readConfig())
ipcMain.handle('config:bind-audio', async (_event, { callback, audioName }) => {
  const config = await readConfig()
  if (!config[callback]) throw new Error(`Unknown event callback: ${callback}`)
  config[callback].AudioName = audioName
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return config
})
ipcMain.handle('settings:update', async (_event, changes) => {
  const config = await readConfig()
  config.Settings = config.Settings || {}
  for (const [key, value] of Object.entries(changes || {})) {
    if (settingKeys.has(key)) config.Settings[key] = value
  }
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return config.Settings
})
ipcMain.handle('audio:list', () => listAudio())
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
ipcMain.handle('audio:remove', async (_event, fileName) => {
  if (!isAudioFile(fileName) || path.basename(fileName) !== fileName) throw new Error('Invalid audio file name')
  await fs.rm(path.join(audioPath, fileName), { force: true })
  return listAudio()
})
ipcMain.handle('audio:clear', async () => {
  const files = await listAudio()
  await Promise.all(files.map(file => fs.rm(path.join(audioPath, file.fileName), { force: true })))
  return []
})
ipcMain.handle('window:minimize', event => BrowserWindow.fromWebContents(event.sender)?.minimize())
ipcMain.handle('window:is-maximized', event => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false)
ipcMain.handle('window:get-accent-color', () => readAccentColor())
ipcMain.handle('window:toggle-maximize', event => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return false
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
  return win.isMaximized()
})
ipcMain.handle('window:close', event => BrowserWindow.fromWebContents(event.sender)?.close())
ipcMain.handle('server:start', async () => {
  if (serverProcess) return { started: false, message: 'Server is already running.' }
  try {
    await fs.access(serverPath)
    await clearResidualServerProcesses()
    const serverOptions = {
      cwd: serverPath,
      windowsHide: true,
      shell: false,
      env: { ...process.env, TRIGGERPAD_CONFIG_PATH: configPath, TRIGGERPAD_AUDIO_PATH: audioPath }
    }
    serverProcess = app.isPackaged
      ? spawn(path.join(serverPath, 'TriggerPad.Server.exe'), [], serverOptions)
      : spawn('dotnet', ['run'], serverOptions)
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
    sendServerLog('INFO', app.isPackaged ? 'Starting packaged Server.' : 'Starting Server: dotnet run')
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
    title: 'TriggerPad v0.1.0-alpha',
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
  win.on('maximize', broadcastWindowState)
  win.on('unmaximize', broadcastWindowState)
  win.webContents.once('did-finish-load', broadcastWindowState)
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(async () => {
  configureRuntimePaths()
  await initializeRuntimeData()
  Menu.setApplicationMenu(null)
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('before-quit', event => {
  if (!serverProcess || allowAppQuit) return
  event.preventDefault()
  requestServerStop({ quitApp: true })
})
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
