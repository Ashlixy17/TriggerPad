import { useEffect, useMemo, useState } from 'react'

const defaultSettings = { LaunchAtStartup: true, Theme: 'dark', DefaultVolume: 68, OutputDevice: 'default' }

function hexToRgba(hex, alpha) {
  const value = String(hex || '').replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(value)) return `rgba(61, 130, 245, ${alpha})`
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function Icon({ children }) {
  return <span className="icon" aria-hidden="true">{children}</span>
}

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
  const [isMaximized, setIsMaximized] = useState(false)
  const [accentColor, setAccentColor] = useState('#3d82f5')
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
      if (manual) addLog('INFO', `事件列表已刷新，共加载 ${items.length} 个事件。`)
    } catch (error) { addLog('ERROR', `读取 config.json 失败：${error.message}`) }
  }

  const loadAudio = async () => {
    try { setAudio(await window.triggerPad?.listAudio() || []) }
    catch (error) { addLog('ERROR', `读取音频目录失败：${error.message}`) }
  }

  useEffect(() => { loadEvents(); loadAudio() }, [])
  useEffect(() => {
    const removeLogListener = window.triggerPad?.onServerLog(entry => addLog(entry.level, entry.message))
    const removeStatusListener = window.triggerPad?.onServerStatus(status => setRunning(status.running))
    return () => { removeLogListener?.(); removeStatusListener?.() }
  }, [])
  useEffect(() => {
    let mounted = true
    window.triggerPad?.isMaximizedWindow?.().then(value => { if (mounted) setIsMaximized(Boolean(value)) })
    const removeWindowStateListener = window.triggerPad?.onWindowMaximized?.(setIsMaximized)
    return () => { mounted = false; removeWindowStateListener?.() }
  }, [])
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const updateTheme = event => setSystemTheme(event.matches ? 'dark' : 'light')
    mediaQuery.addEventListener('change', updateTheme)
    return () => mediaQuery.removeEventListener('change', updateTheme)
  }, [])
  useEffect(() => {
    let mounted = true
    Promise.resolve(window.triggerPad?.getAccentColor?.()).then(value => {
      if (mounted && /^#[0-9a-f]{6}$/i.test(String(value || ''))) setAccentColor(value)
    })
    return () => { mounted = false }
  }, [])

  const selectedEvent = useMemo(() => events.find(item => item.callback === selected), [events, selected])
  const chooseEvent = callback => {
    const event = events.find(item => item.callback === callback)
    setSelected(callback)
    setAudioSelection(event?.AudioName || '')
  }
  const bindAudio = async () => {
    if (!selectedEvent || !audioSelection) return
    try {
      await window.triggerPad?.bindAudio(selectedEvent.callback, audioSelection)
      setEvents(items => items.map(item => item.callback === selectedEvent.callback ? { ...item, AudioName: audioSelection } : item))
      addLog('INFO', `${selectedEvent.callback} 已绑定 ${audioSelection}。`)
    } catch (error) { addLog('ERROR', `保存音频绑定失败：${error.message}`) }
  }
  const testAudio = async () => {
    if (!audioSelection) return
    try {
      const source = await window.triggerPad?.readAudio(audioSelection)
      if (!source) throw new Error('Electron 未返回音频数据')
      const player = new Audio(source)
      player.volume = Number(volume) / 100
      await player.play()
      addLog('INFO', `正在以 ${volume}% 音量播放 ${audioSelection}。`)
    } catch (error) { addLog('ERROR', `播放音频失败：${error.message}`) }
  }
  const toggleRunning = async () => {
    if (running) {
      const result = await window.triggerPad?.stopServer()
      if (!result?.stopped) addLog('WARN', '监听服务当前未运行。')
      return
    }
    const result = await window.triggerPad?.startServer()
    if (result?.started) setRunning(true)
    else if (result?.message) addLog('ERROR', result.message)
  }
  const importAudio = async () => {
    try {
      const result = await window.triggerPad?.importAudio()
      if (result?.files) { setAudio(result.files); if (!result.canceled) addLog('INFO', '音频文件已导入。') }
    } catch (error) { addLog('ERROR', `导入音频失败：${error.message}`) }
  }
  const removeSound = async fileName => {
    try { setAudio(await window.triggerPad?.removeAudio(fileName) || []) }
    catch (error) { addLog('ERROR', `移除音频失败：${error.message}`) }
  }
  const clearAudio = async () => {
    try { setAudio(await window.triggerPad?.clearAudio() || []); setAudioSelection('') }
    catch (error) { addLog('ERROR', `清空音频失败：${error.message}`) }
  }
  const updateSettings = async changes => {
    const next = { ...settings, ...changes }
    setSettings(next)
    try { await window.triggerPad?.updateSettings(changes); addLog('INFO', '设置已保存。') }
    catch (error) { addLog('ERROR', `保存设置失败：${error.message}`) }
  }

  const activeTheme = settings.Theme === 'system' ? systemTheme : settings.Theme
  const accentStyle = {
    '--accent-color': accentColor,
    '--accent-soft': hexToRgba(accentColor, 0.16),
    '--accent-muted': hexToRgba(accentColor, 0.09),
    '--accent-border': hexToRgba(accentColor, 0.58)
  }
  return <div className={`app-shell theme-${activeTheme}`} style={accentStyle}>
    <header className="window-titlebar">
      <div className="titlebar-drag" onDoubleClick={() => window.triggerPad?.toggleMaximizeWindow?.()}>
        <div className="titlebar-mark"><img src="/TriggerPad.ico" alt="" /></div>
        <strong>TriggerPad</strong><span className="titlebar-version">v0.1.0-alpha</span>
      </div>
      <div className="window-controls" onDoubleClick={event => event.stopPropagation()}>
        <button type="button" className="minimize-window" title="最小化" aria-label="最小化" onClick={() => window.triggerPad?.minimizeWindow?.()} />
        <button type="button" className={isMaximized ? 'restore-window' : 'maximize-window'} title={isMaximized ? '还原' : '最大化'} aria-label={isMaximized ? '还原' : '最大化'} onClick={() => window.triggerPad?.toggleMaximizeWindow?.()} />
        <button type="button" className="close-window" title="关闭" aria-label="关闭" onClick={() => window.triggerPad?.closeWindow?.()} />
      </div>
    </header>
    <nav className="tabs" aria-label="主导航">
      {[
        ['events', '事件'],
        ['logs', '日志'],
        ['settings', '设置'],
        ['help', '帮助']
      ].map(([id, text]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{text}</button>)}
    </nav>

    <main className="workspace">
      {tab === 'events' && <>
        <div className="event-sidebar">
        <aside className="event-queue panel">
          <PanelHead title="可用触发事件" action="刷新" onAction={() => loadEvents(true)} />
          <div className="event-list">
            {events.map(event => <button className={'event-row ' + (event.callback === selected ? 'selected' : '')} key={event.callback} onClick={() => chooseEvent(event.callback)}>
              <span className="event-check">✓</span>
              <span className="event-copy"><strong>{event.Trigger || event.callback}</strong><small>{event.callback}</small></span>
              <span className={'event-status ' + (event.AudioName ? 'bound' : 'unbound')}>{event.AudioName ? '已绑定' : '未绑定'}</span>
            </button>)}
            {!events.length && <p className="empty-state">尚未从 config.json 读取到事件</p>}
          </div>
          <div className="queue-footer"><span>{events.length} 个事件</span><span className="hint">点击事件查看详情</span></div>
        </aside>
        <div className="sidebar-start"><StartControl running={running} onToggle={toggleRunning} /></div>
        </div>

        <section className="event-details panel">
          <PanelHead title="事件详情" />
          {selectedEvent ? <div className="detail-body">
            <div className="detail-summary"><span>事件名称</span><strong>{selectedEvent.Trigger || selectedEvent.callback}</strong><code>{selectedEvent.callback}</code></div>
            <div className="condition-row"><span>触发条件</span><p>{selectedEvent.Condition || '未设置条件说明'}</p></div>
            <div className="form-list compact-form">
              <Field label="绑定音频"><select value={audioSelection} onChange={e => setAudioSelection(e.target.value)}><option value="">未选择音频</option>{audio.map(item => <option key={item.fileName} value={item.fileName}>{item.fileName}</option>)}</select></Field>
              <Field label={`触发音量 · ${volume}%`}><input type="range" min="0" max="100" value={volume} onChange={e => setVolume(e.target.value)} /></Field>
              <div className="detail-actions"><button className="secondary" disabled={!audioSelection} onClick={testAudio}>测试播放</button><button className="primary bind" disabled={!audioSelection} onClick={bindAudio}>保存绑定</button></div>
            </div>
          </div> : <div className="empty-detail"><span>⌁</span><strong>选择左侧事件</strong><p>从事件队列中选择一项以查看详情</p></div>}
        </section>

        <aside className="audio-pool panel">
          <PanelHead title="音频池" />
          <div className="audio-pool-meta"><span>本地音频文件</span><strong>{audio.length}</strong></div>
          <div className="audio-list">{audio.map(item => <div className={'audio-item ' + (item.fileName === audioSelection ? 'selected' : '')} key={item.fileName} onClick={() => setAudioSelection(item.fileName)}><Icon>♪</Icon><span title={item.fileName}>{item.audioName}</span><button title="移除音频" onClick={event => { event.stopPropagation(); removeSound(item.fileName) }}>×</button></div>)}{!audio.length && <p className="empty-state">还没有音频文件</p>}</div>
          <div className="audio-actions"><button onClick={importAudio}>导入音频</button><button onClick={clearAudio}>清空</button></div>
        </aside>
      </>}

      {tab === 'logs' && <div className="wide-view"><Logs logs={logs} onClear={() => setLogs([])} /></div>}
      {tab === 'settings' && <div className="wide-view"><Settings settings={settings} onUpdate={updateSettings} /></div>}
      {tab === 'help' && <div className="wide-view"><Help /></div>}
    </main>

    <footer className={`app-footer ${tab === 'events' ? 'events-footer' : ''}`}>
      {tab !== 'events' && <StartControl running={running} onToggle={toggleRunning} />}
      <div className="status-strip"><Metric label="连接状态" value={running ? '已连接' : '未连接'} good={running} /><Metric label="事件源" value="CS2 GSI" /></div>
    </footer>
  </div>
}

function Metric({ label, value, good }) { return <div className="metric"><span>{label}</span><strong className={good ? 'good' : ''}>{value}</strong></div> }
function StartControl({ running, onToggle }) { return <div className="start-block"><div className="listen-row"><span className="start-label">自动监听事件</span><span className={running ? 'signal live' : 'signal'}>{running ? '运行中' : '待启动'}</span></div><button className={running ? 'primary running' : 'primary'} onClick={onToggle}>{running ? '停止软件' : '启动软件'}</button></div> }
function Logs({ logs, onClear }) { return <section className="panel log-panel"><PanelHead title="运行日志" action="清空" onAction={onClear} /><div className="log-box">{logs.length ? logs.map(([time, level, text], i) => <div key={i}><time>{time}</time> <b className={level.toLowerCase()}>{level}</b> {text}</div>) : <p>暂无日志</p>}</div></section> }
function Settings({ settings, onUpdate }) { return <div className="settings-grid"><section className="panel"><PanelHead title="基础设置" /><div className="form-list"><Toggle title="开机自动启动" hint="系统登录后自动启动 TriggerPad" value={settings.LaunchAtStartup} setValue={value => onUpdate({ LaunchAtStartup: value })} /><Field label="界面色调"><select value={settings.Theme} onChange={e => onUpdate({ Theme: e.target.value })}><option value="light">太阳模式（亮色）</option><option value="dark">深色模式</option><option value="system">跟随系统</option></select></Field></div></section><section className="panel"><PanelHead title="播放设置" /><div className="form-list"><Field label={`默认触发音量 · ${settings.DefaultVolume}%`}><input type="range" min="0" max="100" value={settings.DefaultVolume} onChange={e => onUpdate({ DefaultVolume: Number(e.target.value) })} /></Field><Field label="音频输出设备"><select value={settings.OutputDevice} onChange={e => onUpdate({ OutputDevice: e.target.value })}><option value="default">默认输出设备</option><option value="headphones">耳机</option><option value="virtual">虚拟声卡</option></select></Field></div></section></div> }
function Help() { return <section className="panel help-panel"><PanelHead title="帮助" /><div className="help-body"><div className="help-hero"><span className="help-icon">?</span><div><h1>让游戏事件发出声音</h1><p>TriggerPad 通过 CS2 Game State Integration 监听游戏事件，并播放你绑定的本地音频。</p></div></div><div className="help-steps"><div><b>01</b><strong>导入音频</strong><span>在事件页右侧音频池导入 wav、mp3 等文件。</span></div><div><b>02</b><strong>绑定事件</strong><span>选择左侧事件，挑选音频后保存绑定。</span></div><div><b>03</b><strong>启动监听</strong><span>点击左下角启动软件，开始接收 CS2 GSI 事件。</span></div></div></div></section> }
function PanelHead({ title, action, onAction }) { return <div className="panel-head"><strong>{title}</strong>{action && <button onClick={onAction}>{action}</button>}</div> }
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label> }
function Toggle({ title, hint, value, setValue }) { return <div className="toggle-row"><div><strong>{title}</strong><small>{hint}</small></div><input className="switch" type="checkbox" checked={value} onChange={e => setValue(e.target.checked)} /></div> }
