import { useEffect, useState } from 'react'

const defaultSettings = { LaunchAtStartup: true, Theme: 'dark', DefaultVolume: 68, OutputDevice: 'default' }

function Icon({ children }) { return <span className="icon" aria-hidden="true">{children}</span> }

export default function App() {
  const [tab, setTab] = useState('events')
  const [running, setRunning] = useState(false)
  const [audio, setAudio] = useState([])
  const [events, setEvents] = useState([])
  const [selected, setSelected] = useState('')
  const [audioSelection, setAudioSelection] = useState('')
  const [volume, setVolume] = useState(72)
  const [settings, setSettings] = useState(defaultSettings)
  const [logs, setLogs] = useState([])
  const [systemTheme, setSystemTheme] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  const addLog = (type, message) => setLogs(items => [...items, [new Date().toLocaleTimeString('zh-CN', { hour12: false }), type, message]])
  const loadEvents = async (manual = false) => {
    try {
      const config = await window.triggerPad?.readConfig()
      if (!config) return
      const items = Object.entries(config)
        .filter(([callback, item]) => callback !== 'Settings' && item && typeof item === 'object' && ('Trigger' in item || 'Condition' in item || 'AudioName' in item))
        .map(([callback, item]) => ({ callback, ...item }))
      setEvents(items)
      setSettings({ ...defaultSettings, ...(config.Settings || {}) })
      const next = items.some(item => item.callback === selected) ? selected : (items[0]?.callback ?? '')
      setSelected(next)
      setAudioSelection(items.find(item => item.callback === next)?.AudioName || '')
      if (manual) addLog('INFO', `Event list refreshed: ${items.length} event(s) loaded from config.json.`)
    } catch (error) { addLog('ERROR', `Unable to read config.json: ${error.message}`) }
  }
  const loadAudio = async () => {
    try { setAudio(await window.triggerPad?.listAudio() || []) }
    catch (error) { addLog('ERROR', `Unable to read audio directory: ${error.message}`) }
  }
  useEffect(() => { loadEvents(); loadAudio() }, [])
  useEffect(() => {
    const removeLogListener = window.triggerPad?.onServerLog(entry => addLog(entry.level, entry.message))
    const removeStatusListener = window.triggerPad?.onServerStatus(status => setRunning(status.running))
    return () => { removeLogListener?.(); removeStatusListener?.() }
  }, [])
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const updateTheme = event => setSystemTheme(event.matches ? 'dark' : 'light')
    mediaQuery.addEventListener('change', updateTheme)
    return () => mediaQuery.removeEventListener('change', updateTheme)
  }, [])
  const selectedEvent = events.find(item => item.callback === selected)
  const chooseEvent = callback => { const event = events.find(item => item.callback === callback); setSelected(callback); setAudioSelection(event?.AudioName || '') }
  const bindAudio = async () => {
    if (!selectedEvent || !audioSelection) return
    try {
      await window.triggerPad?.bindAudio(selectedEvent.callback, audioSelection)
      setEvents(items => items.map(item => item.callback === selectedEvent.callback ? { ...item, AudioName: audioSelection } : item))
      addLog('INFO', `${selectedEvent.callback} bound to ${audioSelection}.`)
    } catch (error) { addLog('ERROR', `Unable to save audio binding: ${error.message}`) }
  }
  const testAudio = async () => {
    if (!audioSelection) return
    try {
      const source = await window.triggerPad?.readAudio(audioSelection)
      if (!source) throw new Error('Audio data was not returned by Electron')
      const player = new Audio(source)
      player.volume = Number(volume) / 100
      await player.play()
      addLog('INFO', `Playing ${audioSelection} at ${volume}%.`)
    } catch (error) { addLog('ERROR', `Unable to play audio: ${error.message}`) }
  }
  const toggleRunning = async () => {
    if (running) {
      const result = await window.triggerPad?.stopServer()
      if (!result?.stopped) addLog('WARN', 'Server is not running.')
      return
    }
    const result = await window.triggerPad?.startServer()
    if (result?.started) setRunning(true)
    else if (result?.message) addLog('ERROR', result.message)
  }
  const importAudio = async () => { try { const result = await window.triggerPad?.importAudio(); if (result?.files) { setAudio(result.files); if (!result.canceled) addLog('INFO', 'Audio files imported and list refreshed.') } } catch (error) { addLog('ERROR', `Unable to import audio: ${error.message}`) } }
  const removeSound = async fileName => { try { setAudio(await window.triggerPad?.removeAudio(fileName) || []) } catch (error) { addLog('ERROR', `Unable to remove audio: ${error.message}`) } }
  const clearAudio = async () => { try { setAudio(await window.triggerPad?.clearAudio() || []); setAudioSelection('') } catch (error) { addLog('ERROR', `Unable to clear audio: ${error.message}`) } }
  const updateSettings = async changes => {
    const next = { ...settings, ...changes }
    setSettings(next)
    try {
      await window.triggerPad?.updateSettings(changes)
      addLog('INFO', 'Settings saved to config.json.')
    } catch (error) { addLog('ERROR', `Unable to save settings: ${error.message}`) }
  }
  const activeTheme = settings.Theme === 'system' ? systemTheme : settings.Theme
  return <div className={`app-shell theme-${activeTheme}`}><header className="titlebar"><div className="brand-row"><div className="mark"><img src="/TriggerPad.ico" alt="" /></div><strong>TriggerPad</strong><span className="version">v0.1.0</span><span className="subtitle">事件驱动音频触发面板</span><span className="window-caption">CS2 Game State Integration</span><div className="window-controls"><button title="最小化" onClick={() => window.triggerPad?.minimizeWindow()}>−</button><button className="close-window" title="关闭" onClick={() => window.triggerPad?.closeWindow()}>×</button></div></div><nav className="tabs">{[['events', '事件'], ['logs', '日志'], ['settings', '设置']].map(([id, text]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{text}</button>)}</nav></header><main className="workspace"><aside className="sidebar"><section className="audio-card"><div className="section-heading"><h2>音频列表</h2><span>{audio.length} 个</span></div><div className="audio-list">{audio.map(item => <div className="audio-item" key={item.fileName}><Icon>♪</Icon><span>{item.audioName}</span><button title="移除音频" onClick={() => removeSound(item.fileName)}>×</button></div>)}</div><div className="side-actions single-import"><button onClick={importAudio}>导入音频</button><button onClick={clearAudio}>清空</button></div></section><div className="start-block"><div className="divider-label">启动台</div><div className="listen-row"><span>自动监听事件</span><span className={running ? 'signal live' : 'signal'}>{running ? '运行中' : '待启动'}</span></div><button className={running ? 'primary running' : 'primary'} onClick={toggleRunning}>{running ? '停止软件' : '启动软件'}</button></div></aside><section className="main-content"><div className="status-strip"><Metric label="连接状态" value={running ? '已连接' : '待启动'} good={running}/><Metric label="事件源" value="CS2 GSI"/></div>{tab === 'events' && <Events events={events} selected={selected} chooseEvent={chooseEvent} audio={audio} audioSelection={audioSelection} setAudioSelection={setAudioSelection} volume={volume} setVolume={setVolume} onRefresh={() => loadEvents(true)} onBind={bindAudio} onTest={testAudio}/>} {tab === 'logs' && <Logs logs={logs} onClear={() => setLogs([])}/>} {tab === 'settings' && <Settings settings={settings} onUpdate={updateSettings}/>}</section></main></div>
}
function Metric({ label, value, good }) { return <div className="metric"><span>{label}</span><strong className={good ? 'good' : ''}>{value}</strong></div> }
function Events({ events, selected, chooseEvent, audio, audioSelection, setAudioSelection, volume, setVolume, onRefresh, onBind, onTest }) { return <div className="view event-view"><section className="panel"><PanelHead title="事件触发队列" action="刷新" onAction={onRefresh}/><div className="event-list">{events.map(event => <button className={'event-row ' + (event.callback === selected ? 'selected' : '')} key={event.callback} onClick={() => chooseEvent(event.callback)}><div><strong>{event.Trigger || event.callback}</strong><span>条件：{event.Condition || '—'}<br/>音频：{event.AudioName || '未绑定'}</span></div><em className={event.AudioName ? '' : 'unbound'}>{event.AudioName ? '已绑定' : '未绑定'}</em></button>)}{!events.length && <p className="empty-state">尚未从 config.json 读取到事件</p>}</div></section><aside className="panel"><PanelHead title="事件详情"/><div className="form-list"><Field label="选择事件"><select value={selected} onChange={e => chooseEvent(e.target.value)}>{events.map(event => <option key={event.callback} value={event.callback}>{event.callback}</option>)}</select></Field><Field label="播放音频"><select value={audioSelection} onChange={e => setAudioSelection(e.target.value)} disabled={!selected}><option value="">未选择音频</option>{audio.map(item => <option key={item.fileName} value={item.fileName}>{item.fileName}</option>)}</select></Field><Field label={`触发音量 · ${volume}%`}><input type="range" value={volume} onChange={e => setVolume(e.target.value)}/></Field><button className="primary test" disabled={!audioSelection} onClick={onTest}>测试播放</button><button className="primary bind" disabled={!audioSelection} onClick={onBind}>绑定音频</button></div></aside></div> }
function Logs({ logs, onClear }) { return <div className="view log-view"><section className="panel"><PanelHead title="运行日志" action="清空" onAction={onClear}/><div className="log-box">{logs.length ? logs.map(([time, level, text], i) => <div key={i}><time>{time}</time> <b className={level.toLowerCase()}>{level}</b> {text}</div>) : <p>暂无日志</p>}</div></section></div> }
function Settings({ settings, onUpdate }) { return <div className="view settings-view"><section className="panel"><PanelHead title="基础设置"/><div className="form-list"><Toggle title="开机自启动" hint="系统登录后自动启动 TriggerPad" value={settings.LaunchAtStartup} setValue={value => onUpdate({ LaunchAtStartup: value })}/><Field label="界面色调"><select value={settings.Theme} onChange={e => onUpdate({ Theme: e.target.value })}><option value="dark">深色</option><option value="light">浅色</option><option value="system">跟随系统</option></select></Field></div></section><section className="panel"><PanelHead title="播放设置"/><div className="form-list"><Field label={`默认触发音量 · ${settings.DefaultVolume}%`}><input type="range" min="0" max="100" value={settings.DefaultVolume} onChange={e => onUpdate({ DefaultVolume: Number(e.target.value) })}/></Field><Field label="音频输出设备"><select value={settings.OutputDevice} onChange={e => onUpdate({ OutputDevice: e.target.value })}><option value="default">默认输出设备</option><option value="headphones">耳机</option><option value="virtual">虚拟声卡</option></select></Field></div></section></div> }
function PanelHead({ title, action, onAction }) { return <div className="panel-head"><strong>{title}</strong>{action && <button onClick={onAction}>{action}</button>}</div> }
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label> }
function Toggle({ title, hint, value, setValue }) { return <div className="toggle-row"><div><strong>{title}</strong><small>{hint}</small></div><input className="switch" type="checkbox" checked={value} onChange={e => setValue(e.target.checked)}/></div> }
