using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

internal static class AudioHost
{
    private static readonly object OutputSync = new();

    public static void Run(string audioDirectory)
    {
        using var engine = new AudioEngine();
        engine.StateChanged += state => Write(new {
            type = "state",
            channel = state.Channel,
            fileName = state.FileName,
            state = state.State,
            message = state.Message,
        });

        string? line;
        while ((line = Console.ReadLine()) is not null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            string? id = null;
            try
            {
                var command = JObject.Parse(line);
                id = command["id"]?.Value<string>();
                var name = command["command"]?.Value<string>() ?? throw new InvalidOperationException("Audio host command is missing.");
                switch (name)
                {
                    case "list-devices":
                        WriteResponse(id, engine.ListOutputDevices());
                        break;
                    case "play":
                    {
                        var channel = command["channel"]?.Value<string>() ?? throw new InvalidOperationException("Playback channel is missing.");
                        var fileName = command["fileName"]?.Value<string>() ?? throw new InvalidOperationException("Audio file name is missing.");
                        if (Path.GetFileName(fileName) != fileName) throw new InvalidOperationException("Invalid audio file name.");
                        var filePath = Path.Combine(audioDirectory, fileName);
                        var result = engine.Play(
                            channel,
                            filePath,
                            command["volume"]?.Value<int>() ?? 100,
                            command["outputDevice"]?.Value<string>());
                        WriteResponse(id, result);
                        break;
                    }
                    case "stop":
                        WriteResponse(id, new { stopped = engine.Stop(command["channel"]?.Value<string>() ?? string.Empty) });
                        break;
                    case "shutdown":
                        WriteResponse(id, new { stopped = true });
                        return;
                    default:
                        throw new InvalidOperationException($"Unknown audio host command: {name}");
                }
            }
            catch (Exception error)
            {
                Write(new { type = "response", id, ok = false, error = error.Message });
            }
        }
    }

    private static void WriteResponse(string? id, object result) => Write(new { type = "response", id, ok = true, result });

    private static void Write(object value)
    {
        lock (OutputSync)
        {
            Console.WriteLine(JsonConvert.SerializeObject(value, Formatting.None));
            Console.Out.Flush();
        }
    }
}
