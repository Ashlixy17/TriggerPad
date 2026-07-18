import { useEffect, useMemo, useRef, useState } from 'react'

const defaultSettings = {
  LaunchAtStartup: true,
  Theme: 'dark',
  DefaultVolume: 68,
  OutputDevice: 'default',
  SmoothScroll: true
}

function hexToRgba(hex, alpha) {
  const value = String(hex || '').replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(value)) return `rgba(61, 130, 245, ${alpha})`
  return `rgba(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}, ${alpha})`
}

export default function App() {
  const [tab, setTab] = useState('events')
  const [running, setRunning] = useState(false)
  const [audio, setAudio] = useState([])
  const [audioEnabled, setAudioEnabled] = useState({})
  const [events, setEvents] = useState([])
  const [selected, setSelected] = useState('')
  const [audioSelection, setAudioSelection] = useState('')
  const [editingAudio, setEditingAudio] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [renamingAudio, setRenamingAudio] = useState(false)
  const renameCancelled = useRef(false)
  const renameSubmitting = useRef(false)
  const [volume, setVolume] = useState(72)
  const [testingAudio, setTestingAudio] = useState(false)
  const [settings, setSettings] = useState(defaultSettings)
  const [logs, setLogs] = useState([])
  const [isMaximized, setIsMaximized] = useState(false)
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false)
  const [accentColor, setAccentColor] = useState('#3d82f5')
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const [systemTheme, setSystemTheme] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

  const addLog = (type, message) => setLogs(items => [...items, [new Date().toLocaleTimeString('zh-CN', { hour12: false }), type, message]])
  const showToast = message => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    const id = Date.now()
    setToast({ id, message, closing: false })
    toastTimer.current = setTimeout(() => setToast(current => current?.id === id ? { ...current, closing: true } : current), 5000)
  }
  const dismissToast = () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = null
    setToast(null)
  }

  useEffect(() => {
    if (!toast?.closing) return undefined
    const timer = setTimeout(() => setToast(current => current?.id === toast.id ? null : current), 220)
    return () => clearTimeout(timer)
  }, [toast])
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  const loadEvents = async (manual = false) => {
    try {
      const config = await window.triggerPad?.readConfig()
      if (!config) return
      const items = Object.entries(config)
        .filter(([callback, item]) => callback !== 'Settings' && item && typeof item === 'object' && ('Trigger' in item || 'Condition' in item || 'AudioName' in item))
        .map(([callback, item]) => ({ callback, ...item, Enabled: item.Enabled !== false }))
      setEvents(items)
      setSettings({ ...defaultSettings, ...(config.Settings || {}), SmoothScroll: config.Settings?.SmoothScroll !== false })
      const next = items.some(item => item.callback === selected) ? selected : (items[0]?.callback ?? '')
      setSelected(next)
      setAudioSelection(items.find(item => item.callback === next)?.AudioName || '')
      if (manual) addLog('INFO', `事件列表已刷新，共加载 ${items.length} 个事件。`)
    } catch (error) { addLog('ERROR', `读取 config.json 失败：${error.message}`) }
  }

  const syncAudioState = files => {
    setAudio(files)
    setAudioEnabled(current => Object.fromEntries(files.map(item => [item.fileName, current[item.fileName] !== false])))
  }
  const loadAudio = async () => {
    try { syncAudioState(await window.triggerPad?.listAudio() || []) }
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
    window.triggerPad?.isAlwaysOnTop?.().then(value => { if (mounted) setIsAlwaysOnTop(Boolean(value)) })
    const removeMaxListener = window.triggerPad?.onWindowMaximized?.(setIsMaximized)
    const removeTopListener = window.triggerPad?.onWindowAlwaysOnTop?.(setIsAlwaysOnTop)
    return () => { mounted = false; removeMaxListener?.(); removeTopListener?.() }
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
  const availableAudio = useMemo(() => audio.filter(item => audioEnabled[item.fileName] !== false), [audio, audioEnabled])
  const canSaveBinding = Boolean(selectedEvent && audioSelection && availableAudio.some(item => item.fileName === audioSelection) && audioSelection !== selectedEvent.AudioName)
  const scrollClass = settings.SmoothScroll ? ' smooth-scroll' : ''

  const chooseEvent = callback => {
    const event = events.find(item => item.callback === callback)
    setSelected(callback)
    setAudioSelection(event?.AudioName || '')
  }
  const toggleEventEnabled = async (callback, enabled) => {
    const previous = events.find(item => item.callback === callback)?.Enabled !== false
    setEvents(items => items.map(item => item.callback === callback ? { ...item, Enabled: enabled } : item))
    try {
      await window.triggerPad?.setEventEnabled?.(callback, enabled)
      addLog('INFO', `${callback} 已${enabled ? '启用' : '禁用'}。`)
    } catch (error) {
      setEvents(items => items.map(item => item.callback === callback ? { ...item, Enabled: previous } : item))
      addLog('ERROR', `保存事件状态失败：${error.message}`)
    }
  }
  const bindAudio = async () => {
    if (!selectedEvent || !audioSelection || audioSelection === selectedEvent.AudioName) return
    try {
      await window.triggerPad?.bindAudio(selectedEvent.callback, audioSelection)
      setEvents(items => items.map(item => item.callback === selectedEvent.callback ? { ...item, AudioName: audioSelection } : item))
      addLog('INFO', `${selectedEvent.callback} 已绑定 ${audioSelection}。`)
      showToast('保存绑定成功')
    } catch (error) { addLog('ERROR', `保存音频绑定失败：${error.message}`) }
  }
  const testAudio = async () => {
    if (!audioSelection || testingAudio) return
    setTestingAudio(true)
    try {
      const source = await window.triggerPad?.readAudio(audioSelection)
      if (!source) throw new Error('Electron 未返回音频数据')
      const player = new Audio(source)
      player.volume = Number(volume) / 100
      const playbackFinished = new Promise((resolve, reject) => {
        player.addEventListener('ended', resolve, { once: true })
        player.addEventListener('error', () => reject(new Error('音频播放过程中发生错误')), { once: true })
      })
      await player.play()
      addLog('INFO', `正在以 ${volume}% 音量播放 ${audioSelection}。`)
      await playbackFinished
    } catch (error) {
      addLog('ERROR', `播放音频失败：${error.message}`)
      showToast('音频测试失败')
    } finally { setTestingAudio(false) }
  }
  const playAudioFile = async fileName => {
    try {
      const source = await window.triggerPad?.readAudio(fileName)
      if (!source) throw new Error('Electron 未返回音频数据')
      const player = new Audio(source)
      player.volume = Number(settings.DefaultVolume) / 100
      await player.play()
      addLog('INFO', `正在以 ${settings.DefaultVolume}% 音量播放 ${fileName}。`)
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
  const toggleAlwaysOnTop = async () => {
    const value = await window.triggerPad?.toggleAlwaysOnTop?.()
    if (typeof value === 'boolean') setIsAlwaysOnTop(value)
  }
  const importAudio = async () => {
    try {
      const result = await window.triggerPad?.importAudio()
      if (result?.files) { syncAudioState(result.files); if (!result.canceled) addLog('INFO', '音频文件已导入。') }
    } catch (error) { addLog('ERROR', `导入音频失败：${error.message}`) }
  }
  const removeSound = async fileName => {
    try {
      const files = await window.triggerPad?.removeAudio(fileName) || []
      syncAudioState(files)
      if (audioSelection === fileName) setAudioSelection('')
      if (editingAudio === fileName) { setEditingAudio(''); setRenameValue('') }
    } catch (error) { addLog('ERROR', `移除音频失败：${error.message}`) }
  }
  const clearAudio = async () => {
    try { syncAudioState(await window.triggerPad?.clearAudio() || []); setAudioSelection(''); setEditingAudio(''); setRenameValue('') }
    catch (error) { addLog('ERROR', `清空音频失败：${error.message}`) }
  }
  const beginRenameAudio = fileName => {
    renameCancelled.current = false
    setEditingAudio(fileName)
    setRenameValue(fileName)
  }
  const cancelRenameAudio = () => {
    renameCancelled.current = true
    setEditingAudio('')
    setRenameValue('')
  }
  const submitRenameAudio = event => {
    event.preventDefault()
    event.stopPropagation()
    void saveRenameAudio()
  }
  const saveRenameAudio = async () => {
    if (renamingAudio || renameSubmitting.current || !editingAudio || renameCancelled.current) return
    const oldFileName = editingAudio
    let newFileName = renameValue.trim()
    if (!newFileName) { addLog('ERROR', '音频文件名不能为空。'); return }
    const oldExtension = oldFileName.slice(oldFileName.lastIndexOf('.')).toLowerCase()
    const newExtensionIndex = newFileName.lastIndexOf('.')
    const newExtension = newExtensionIndex > 0 ? newFileName.slice(newExtensionIndex).toLowerCase() : ''
    if (!newExtension) newFileName += oldExtension
    if (newExtension && newExtension !== oldExtension) { addLog('ERROR', '重命名不能修改音频文件后缀。'); return }
    if (/[<>:"/\\|?*\u0000-\u001f]/.test(newFileName) || /[. ]$/.test(newFileName)) { addLog('ERROR', '音频文件名包含 Windows 不允许的字符。'); return }
    if (newFileName === oldFileName) { cancelRenameAudio(); return }
    renameSubmitting.current = true
    setRenamingAudio(true)
    try {
      const result = await window.triggerPad?.renameAudio(oldFileName, newFileName)
      syncAudioState(result?.files || [])
      if (audioSelection === oldFileName) setAudioSelection(newFileName)
      await loadEvents()
      setEditingAudio('')
      setRenameValue('')
      addLog('INFO', `${oldFileName} 已重命名为 ${newFileName}。`)
    } catch (error) { addLog('ERROR', `重命名音频失败：${error.message}`) }
    finally { renameSubmitting.current = false; setRenamingAudio(false); renameCancelled.current = false }
  }
  const updateSettings = async changes => {
    const next = { ...settings, ...changes }
    setSettings(next)
    try { await window.triggerPad?.updateSettings(changes); addLog('INFO', '设置已保存。'); showToast('设置已保存') }
    catch (error) { addLog('ERROR', `保存设置失败：${error.message}`) }
  }

  const activeTheme = settings.Theme === 'system' ? systemTheme : settings.Theme
  const accentStyle = { '--accent-color': accentColor, '--accent-soft': hexToRgba(accentColor, 0.16), '--accent-muted': hexToRgba(accentColor, 0.09), '--accent-border': hexToRgba(accentColor, 0.58) }
  return <div className={`app-shell theme-${activeTheme}`} style={accentStyle}>
    <header className="window-titlebar">
      <div className="titlebar-drag" onDoubleClick={() => window.triggerPad?.toggleMaximizeWindow?.()}><div className="titlebar-mark"><img src="/TriggerPad.ico" alt="" /></div><strong>TriggerPad</strong><span className="titlebar-version">v0.1.0-alpha</span></div>
      <div className="window-controls" onDoubleClick={event => event.stopPropagation()}><button type="button" className={`pin-window ${isAlwaysOnTop ? 'active' : ''}`} title={isAlwaysOnTop ? '取消置顶' : '窗口置顶'} aria-label={isAlwaysOnTop ? '取消置顶' : '窗口置顶'} onClick={toggleAlwaysOnTop} /><button type="button" className="minimize-window" title="最小化" aria-label="最小化" onClick={() => window.triggerPad?.minimizeWindow?.()} /><button type="button" className={isMaximized ? 'restore-window' : 'maximize-window'} title={isMaximized ? '还原' : '最大化'} aria-label={isMaximized ? '还原' : '最大化'} onClick={() => window.triggerPad?.toggleMaximizeWindow?.()} /><button type="button" className="close-window" title="关闭" aria-label="关闭" onClick={() => window.triggerPad?.closeWindow?.()} /></div>
    </header>
    <nav className="tabs" aria-label="主导航">{[['events', '事件'], ['logs', '日志'], ['settings', '设置'], ['help', '帮助']].map(([id, text]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{text}</button>)}</nav>
    <main className="workspace">
      {tab === 'events' && <>
        <div className="event-sidebar"><aside className="event-queue panel"><PanelHead title="可用触发事件" action="刷新" onAction={() => loadEvents(true)} /><div className={`event-list${scrollClass}`}>{events.map(event => <div className={`event-row ${event.callback === selected ? 'selected' : ''} ${event.Enabled === false ? 'disabled' : ''}`} role="button" tabIndex="0" aria-pressed={event.callback === selected} key={event.callback} onClick={() => chooseEvent(event.callback)} onKeyDown={keyEvent => { if (keyEvent.target === keyEvent.currentTarget && (keyEvent.key === 'Enter' || keyEvent.key === ' ')) { keyEvent.preventDefault(); chooseEvent(event.callback) } }}><input className="native-check event-check" type="checkbox" checked={event.Enabled !== false} onChange={changeEvent => toggleEventEnabled(event.callback, changeEvent.target.checked)} onClick={clickEvent => clickEvent.stopPropagation()} aria-label={`${event.Trigger || event.callback} 启用`} /><span className="event-copy"><strong>{event.Trigger || event.callback}</strong><small>{event.callback}</small></span><span className={`event-status ${event.Enabled === false ? 'disabled-status' : (event.AudioName ? 'bound' : 'unbound')}`}>{event.Enabled === false ? '已禁用' : (event.AudioName ? '已绑定' : '未绑定')}</span></div>)}{!events.length && <p className="empty-state">尚未从 config.json 读取到事件</p>}</div><div className="queue-footer"><span>{events.length} 个事件</span><span className="hint">点击事件查看详情</span></div></aside><div className="sidebar-start"><StartControl running={running} onToggle={toggleRunning} /></div></div>
        <section className="event-details panel"><PanelHead title="事件详情" />{selectedEvent ? <div className={`detail-body${scrollClass}`}><div className="detail-summary"><span>事件名称</span><strong>{selectedEvent.Trigger || selectedEvent.callback}</strong><code>{selectedEvent.callback}</code></div><div className="condition-row"><span>触发条件</span><p>{selectedEvent.Condition || '未设置条件说明'}</p></div><div className="form-list compact-form"><Field label="绑定音频"><select value={availableAudio.some(item => item.fileName === audioSelection) ? audioSelection : ''} onChange={event => setAudioSelection(event.target.value)}><option value="">未选择音频</option>{availableAudio.map(item => <option key={item.fileName} value={item.fileName}>{item.fileName}</option>)}</select></Field><Field label={`触发音量 · ${volume}%`}><input type="range" min="0" max="100" value={volume} onChange={event => setVolume(event.target.value)} /></Field><div className="detail-actions"><button className="secondary" disabled={!audioSelection || testingAudio} onClick={testAudio}>测试播放</button><button className="primary bind" disabled={!canSaveBinding} onClick={bindAudio}>保存绑定</button></div></div></div> : <div className="empty-detail"><span>⌁</span><strong>选择左侧事件</strong><p>从事件队列中选择一项以查看详情</p></div>}</section>
        <aside className="audio-pool panel"><PanelHead title="音频池" /><div className="audio-pool-meta"><span>本地音频文件</span><strong>{audio.length}</strong></div><div className={`audio-list${scrollClass}`}>{audio.map(item => <div className={`audio-item ${item.fileName === audioSelection ? 'selected' : ''} ${audioEnabled[item.fileName] === false ? 'disabled' : ''}`} key={item.fileName} onClick={() => { if (audioEnabled[item.fileName] !== false && editingAudio !== item.fileName) setAudioSelection(item.fileName) }}><input className="native-check audio-check" type="checkbox" checked={audioEnabled[item.fileName] !== false} onChange={event => { const enabled = event.target.checked; setAudioEnabled(current => ({ ...current, [item.fileName]: enabled })); if (!enabled && audioSelection === item.fileName) setAudioSelection('') }} onClick={event => event.stopPropagation()} aria-label={`${item.fileName} 可用于绑定`} />{editingAudio === item.fileName ? <form className="audio-rename-form" onSubmit={submitRenameAudio} onClick={event => event.stopPropagation()}><input className="audio-rename-input" value={renameValue} autoFocus disabled={renamingAudio} onChange={event => setRenameValue(event.target.value)} onBlur={() => { if (!renameCancelled.current) saveRenameAudio() }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void saveRenameAudio() } if (event.key === 'Escape') { event.preventDefault(); cancelRenameAudio() } }} onClick={event => event.stopPropagation()} aria-label="重命名音频文件" /></form> : <span title={item.fileName}>{item.fileName}</span>}<div className="audio-item-actions" onClick={event => event.stopPropagation()}><button type="button" className="audio-action audio-play" title="播放音频" aria-label="播放音频" onClick={() => playAudioFile(item.fileName)} /><button type="button" className="audio-action audio-rename" title="重命名音频" aria-label="重命名音频" disabled={renamingAudio} onClick={() => beginRenameAudio(item.fileName)} /><button type="button" className="audio-action audio-delete" title="移除音频" aria-label="移除音频" disabled={renamingAudio} onClick={() => removeSound(item.fileName)} /></div></div>)}{!audio.length && <p className="empty-state">还没有音频文件</p>}</div><div className="audio-actions"><button onClick={importAudio}>导入音频</button><button onClick={clearAudio}>清空</button></div></aside>
      </>}
      {tab === 'logs' && <div className="wide-view"><Logs logs={logs} onClear={() => setLogs([])} scrollClass={scrollClass} /></div>}
      {tab === 'settings' && <div className="wide-view"><Settings settings={settings} onUpdate={updateSettings} /></div>}
      {tab === 'help' && <div className="wide-view"><Help /></div>}
    </main>
    <footer className={`app-footer ${tab === 'events' ? 'events-footer' : ''}`}>{tab === 'logs' && <StartControl running={running} onToggle={toggleRunning} />}<div className="status-strip"><Metric label="连接状态" value={running ? '已连接' : '未连接'} good={running} /><Metric label="事件源" value="CS2 GSI" /></div></footer>
    {toast && <Toast message={toast.message} closing={toast.closing} onClose={dismissToast} />}
  </div>
}

function Metric({ label, value, good }) { return <div className="metric"><span>{label}</span><strong className={good ? 'good' : ''}>{value}</strong></div> }
function StartControl({ running, onToggle }) { return <div className="start-block"><div className="listen-row"><span className="start-label">自动监听事件</span><span className={running ? 'signal live' : 'signal'}>{running ? '运行中' : '待启动'}</span></div><button className={running ? 'primary running' : 'primary'} onClick={onToggle}>{running ? '停止软件' : '启动软件'}</button></div> }
function Logs({ logs, onClear, scrollClass }) {
  const boxRef = useRef(null)
  const followRef = useRef(true)
  useEffect(() => {
    const box = boxRef.current
    if (!logs.length) followRef.current = true
    if (box && followRef.current) box.scrollTop = box.scrollHeight
  }, [logs.length])
  const handleScroll = event => {
    const box = event.currentTarget
    followRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 32
  }
  return <section className="panel log-panel"><PanelHead title="运行日志" action="清空" onAction={onClear} /><div className={"log-box" + scrollClass} ref={boxRef} onScroll={handleScroll} role="log" aria-live="polite">{logs.length ? logs.map(([time, level, text], i) => <div className="console-line" key={i}><time>[{time}]</time> <b className={level.toLowerCase()}>{level}</b> <span>{text}</span></div>) : <div className="console-empty"><div>TriggerPad&gt;</div><div>暂无日志</div></div>}</div></section>
}
function Settings({ settings, onUpdate }) { const [activeSection, setActiveSection] = useState('interface'); const scrollRef = useRef(null); const sectionRefs = useRef({}); const categories = [{ id: 'interface', label: '界面设置' }, { id: 'playback', label: '播放设置' }]; const smooth = settings.SmoothScroll !== false; useEffect(() => { const root = scrollRef.current; if (!root) return undefined; const observer = new IntersectionObserver(entries => { const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]; if (visible?.target?.id) setActiveSection(visible.target.id) }, { root, threshold: [0.2, 0.5, 0.8] }); Object.values(sectionRefs.current).forEach(section => section && observer.observe(section)); return () => observer.disconnect() }, []); const jumpTo = id => { setActiveSection(id); sectionRefs.current[id]?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }) }; return <div className="settings-layout"><aside className="settings-nav panel" aria-label="设置分类"><div className="settings-nav-head">设置分类</div><div className="settings-nav-list">{categories.map(category => <button key={category.id} className={activeSection === category.id ? 'active' : ''} onClick={() => jumpTo(category.id)}>{category.label}</button>)}</div></aside><div className={`settings-scroll${smooth ? ' smooth-scroll' : ''}`} ref={scrollRef}><section id="interface" className="settings-section panel" ref={node => { sectionRefs.current.interface = node }}><PanelHead title="界面设置" /><div className="form-list settings-form-list"><Toggle title="开机自动启动" hint="系统登录后自动启动 TriggerPad" value={settings.LaunchAtStartup} setValue={value => onUpdate({ LaunchAtStartup: value })} /><Field label="界面色调"><select value={settings.Theme} onChange={event => onUpdate({ Theme: event.target.value })}><option value="light">太阳模式（亮色）</option><option value="dark">深色模式</option><option value="system">跟随系统</option></select></Field><Toggle title="平滑滚动" hint="启用列表和设置区域的平滑滚动" value={settings.SmoothScroll !== false} setValue={value => onUpdate({ SmoothScroll: value })} /></div></section><section id="playback" className="settings-section panel" ref={node => { sectionRefs.current.playback = node }}><PanelHead title="播放设置" /><div className="form-list settings-form-list"><Field label={`默认触发音量 · ${settings.DefaultVolume}%`}><input type="range" min="0" max="100" value={settings.DefaultVolume} onChange={event => onUpdate({ DefaultVolume: Number(event.target.value) })} /></Field><Field label="音频输出设备"><select value={settings.OutputDevice} onChange={event => onUpdate({ OutputDevice: event.target.value })}><option value="default">默认输出设备</option><option value="headphones">耳机</option><option value="virtual">虚拟声卡</option></select></Field></div></section></div></div> }
function Help() { return <section className="panel help-panel"><PanelHead title="帮助" /><div className="help-body"><div className="help-hero"><span className="help-icon">?</span><div><h1>让游戏事件发出声音</h1><p>TriggerPad 通过 CS2 Game State Integration 监听游戏事件，并播放你绑定的本地音频。</p></div></div><div className="help-steps"><div><b>01</b><strong>导入音频</strong><span>在事件页右侧音频池导入 wav、mp3 等文件。</span></div><div><b>02</b><strong>绑定事件</strong><span>选择左侧事件，挑选音频后保存绑定。</span></div><div><b>03</b><strong>启动监听</strong><span>在事件页或日志页启动软件，开始接收 CS2 GSI 事件。</span></div></div></div></section> }
function PanelHead({ title, action, onAction }) { return <div className="panel-head"><strong>{title}</strong>{action && <button onClick={onAction}>{action}</button>}</div> }
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label> }
function Toggle({ title, hint, value, setValue }) { return <label className="toggle-row"><div><strong>{title}</strong><small>{hint}</small></div><input className="native-check switch" type="checkbox" checked={value} onChange={event => setValue(event.target.checked)} /></label> }
function Toast({ message, closing, onClose }) { return <div className={`save-toast${closing ? ' leaving' : ''}`} role="status"><span>{message}</span><button className="toast-close" type="button" aria-label="关闭提示" title="关闭" onClick={onClose}>×</button></div> }
