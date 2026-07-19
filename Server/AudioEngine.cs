using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

internal sealed record AudioOutputDevice(string Id, string Name, bool IsDefault);
internal sealed record AudioPlayResult(string DeviceId, string DeviceName, bool UsedFallback);
internal sealed record AudioPlaybackState(string Channel, string FileName, string State, string? Message = null);

internal sealed class AudioEngine : IDisposable
{
    private sealed class PlaybackSession : IDisposable
    {
        private int _disposed;

        public required string Channel { get; init; }
        public required string FileName { get; init; }
        public required IWavePlayer Output { get; init; }
        public required WaveStream Reader { get; init; }
        public required MMDevice Device { get; init; }
        public bool ManualStop { get; set; }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
            Output.Dispose();
            Reader.Dispose();
            Device.Dispose();
        }
    }

    private readonly object _sync = new();
    private readonly Dictionary<string, PlaybackSession> _sessions = new(StringComparer.Ordinal);

    public event Action<AudioPlaybackState>? StateChanged;

    public IReadOnlyList<AudioOutputDevice> ListOutputDevices()
    {
        using var enumerator = new MMDeviceEnumerator();
        string? defaultId = null;
        try
        {
            using var defaultDevice = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
            defaultId = defaultDevice.ID;
        }
        catch { /* Windows may temporarily have no default render endpoint. */ }

        var devices = new List<AudioOutputDevice>();
        foreach (var device in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
        {
            devices.Add(new AudioOutputDevice(device.ID, device.FriendlyName, device.ID == defaultId));
            device.Dispose();
        }
        return devices
            .OrderByDescending(device => device.IsDefault)
            .ThenBy(device => device.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToArray();
    }

    public AudioPlayResult Play(string channel, string filePath, int volume, string? outputDeviceId)
    {
        if (string.IsNullOrWhiteSpace(channel)) throw new ArgumentException("Playback channel is required.", nameof(channel));
        if (!File.Exists(filePath)) throw new FileNotFoundException("Audio file does not exist.", filePath);

        Stop(channel, notify: false);

        var reader = CreateReader(filePath);
        MMDevice? device = null;
        WasapiOut? output = null;
        PlaybackSession? session = null;
        try
        {
            using var enumerator = new MMDeviceEnumerator();
            var usedFallback = false;
            if (!string.IsNullOrWhiteSpace(outputDeviceId) && outputDeviceId != "default")
            {
                try
                {
                    device = enumerator.GetDevice(outputDeviceId);
                    if (device.State != DeviceState.Active) throw new InvalidOperationException("Selected audio device is not active.");
                }
                catch
                {
                    device?.Dispose();
                    device = null;
                    usedFallback = true;
                }
            }

            device ??= enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
            var deviceId = device.ID;
            var deviceName = device.FriendlyName;
            var sampleProvider = new VolumeSampleProvider(reader.ToSampleProvider()) {
                Volume = Math.Clamp(volume, 0, 100) / 100f,
            };

            output = new WasapiOut(device, AudioClientShareMode.Shared, true, 100);
            output.Init(new SampleToWaveProvider(sampleProvider));
            session = new PlaybackSession {
                Channel = channel,
                FileName = Path.GetFileName(filePath),
                Output = output,
                Reader = reader,
                Device = device,
            };
            var playbackSession = session;
            output.PlaybackStopped += (_, eventArgs) => CompleteSession(playbackSession, eventArgs.Exception);
            lock (_sync) _sessions[channel] = session;
            output.Play();
            StateChanged?.Invoke(new AudioPlaybackState(channel, session.FileName, "started"));
            return new AudioPlayResult(deviceId, deviceName, usedFallback);
        }
        catch
        {
            lock (_sync)
            {
                if (_sessions.TryGetValue(channel, out var current) && ReferenceEquals(current, session)) _sessions.Remove(channel);
            }
            if (session is not null) session.Dispose();
            else
            {
                output?.Dispose();
                reader.Dispose();
                device?.Dispose();
            }
            throw;
        }
    }

    public bool Stop(string channel, bool notify = true)
    {
        PlaybackSession? session;
        lock (_sync)
        {
            if (!_sessions.Remove(channel, out session)) return false;
            session.ManualStop = true;
        }

        try { session.Output.Stop(); }
        finally { session.Dispose(); }
        if (notify) StateChanged?.Invoke(new AudioPlaybackState(channel, session.FileName, "stopped"));
        return true;
    }

    private void CompleteSession(PlaybackSession session, Exception? error)
    {
        var ownsSession = false;
        lock (_sync)
        {
            if (_sessions.TryGetValue(session.Channel, out var current) && ReferenceEquals(current, session))
            {
                _sessions.Remove(session.Channel);
                ownsSession = true;
            }
        }
        if (!ownsSession) return;

        session.Dispose();
        if (session.ManualStop) return;
        StateChanged?.Invoke(error is null
            ? new AudioPlaybackState(session.Channel, session.FileName, "ended")
            : new AudioPlaybackState(session.Channel, session.FileName, "error", error.Message));
    }

    private static WaveStream CreateReader(string filePath)
    {
        var extension = Path.GetExtension(filePath).ToLowerInvariant();
        return extension switch
        {
            ".wav" => new WaveFileReader(filePath),
            ".aif" or ".aiff" => new AiffFileReader(filePath),
            _ => new MediaFoundationReader(filePath),
        };
    }

    public void Dispose()
    {
        string[] channels;
        lock (_sync) channels = _sessions.Keys.ToArray();
        foreach (var channel in channels) Stop(channel, notify: false);
    }
}
