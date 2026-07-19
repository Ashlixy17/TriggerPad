using CounterStrike2GSI;
using Newtonsoft.Json.Linq;
using System.Text;

const int port = 10086;

Console.OutputEncoding = Encoding.UTF8;
Console.InputEncoding = Encoding.UTF8;

var configPath = Environment.GetEnvironmentVariable("TRIGGERPAD_CONFIG_PATH")
    ?? Path.GetFullPath("../config.json", Directory.GetCurrentDirectory());
var audioDirectory = Environment.GetEnvironmentVariable("TRIGGERPAD_AUDIO_PATH")
    ?? Path.Combine(Path.GetDirectoryName(configPath)!, "audio");

if (args.Length > 0 && args[0] == "--audio-host")
{
    AudioHost.Run(audioDirectory);
    return;
}

string? mySteamID = null;
string? myName = null;
string currentPlayerTeam = "T";
using var listener = new GameStateListener(port);
using var audioEngine = new AudioEngine();

audioEngine.StateChanged += state =>
{
    if (state.Channel.StartsWith("event:", StringComparison.Ordinal) && state.State == "error")
        Console.Error.WriteLine($"播放 {state.FileName} 失败：{state.Message}");
};

void GetSteamID(GameState gameState)
{
    var steamID = gameState.Player.SteamID;
    if (steamID is null) return;
    mySteamID = steamID;
    Console.WriteLine($"获取到 SteamID：{mySteamID}");
    listener.NewGameState -= GetSteamID;
}

void PlayConfiguredEvent(string callback)
{
    try
    {
        var config = JObject.Parse(File.ReadAllText(configPath));
        var eventConfig = config[callback] as JObject;
        if (eventConfig is null || eventConfig["Enabled"]?.Value<bool>() != true) return;

        var audioName = eventConfig["AudioName"]?.Value<string>();
        if (string.IsNullOrWhiteSpace(audioName)) return;

        var settings = config["Settings"] as JObject;
        var defaultVolume = Math.Clamp(settings?["DefaultVolume"]?.Value<int>() ?? 100, 0, 100);
        var useCustomVolume = eventConfig["UseCustomVolume"]?.Value<bool>() == true;
        var volume = useCustomVolume
            ? Math.Clamp(eventConfig["TriggerVolume"]?.Value<int>() ?? defaultVolume, 0, 100)
            : defaultVolume;
        var outputDevice = settings?["OutputDevice"]?.Value<string>() ?? "default";
        var result = audioEngine.Play($"event:{callback}", Path.Combine(audioDirectory, audioName), volume, outputDevice);
        if (result.UsedFallback) Console.WriteLine($"输出设备不可用，已回退到默认设备：{result.DeviceName}");
        Console.WriteLine($"{audioName} 已使用 {volume}% 音量播放");
    }
    catch (Exception error)
    {
        Console.Error.WriteLine($"事件 {callback} 播放失败：{error.Message}");
    }
}

listener.NewGameState += GetSteamID;
listener.PlayerDied += gameEvent =>
{
    PlayConfiguredEvent("PlayerDied");
    Console.WriteLine($"{gameEvent.Player.Name} 已死亡");
};
listener.PlayerFlashAmountChanged += gameEvent =>
{
    if (gameEvent.New == 1) PlayConfiguredEvent("PlayerFlashAmountChanged");
};
listener.PlayerSmokedAmountChanged += gameEvent =>
{
    if (gameEvent.New > 90) PlayConfiguredEvent("PlayerSmokedAmountChanged");
};
listener.PlayerBurningAmountChanged += gameEvent =>
{
    if (gameEvent.New > 100) PlayConfiguredEvent("PlayerBurningAmountChanged");
};
listener.PlayerActiveWeaponChanged += gameEvent =>
{
    PlayConfiguredEvent("PlayerActiveWeaponChanged");
    Console.WriteLine($"当前武器已更换为 {gameEvent.New.Name}");
};
listener.PlayerWeaponsPickedUp += _ =>
{
    PlayConfiguredEvent("PlayerWeaponsPickedUp");
    Console.WriteLine("已拾取武器");
};
listener.PlayerWeaponsDropped += _ =>
{
    PlayConfiguredEvent("PlayerWeaponsDropped");
    Console.WriteLine("已丢弃武器");
};
listener.PlayerGotKill += _ => PlayConfiguredEvent("PlayerGotKill");
listener.RoundConcluded += _ => PlayConfiguredEvent("RoundConcluded");
listener.BombExploded += _ => PlayConfiguredEvent("BombExploded");
listener.BombPlanted += _ =>
{
    PlayConfiguredEvent("BombPlanted");
    Console.WriteLine("C4 已安放");
};
listener.BombDefused += _ =>
{
    PlayConfiguredEvent("BombDefused");
    Console.WriteLine("C4 已拆除");
};
listener.PlayerTeamChanged += gameEvent =>
{
    currentPlayerTeam = gameEvent.New.ToString();
    Console.WriteLine($"玩家阵营已变更为 {currentPlayerTeam}");
};
listener.TeamRoundLoss += gameEvent =>
{
    if (currentPlayerTeam != gameEvent.Team.ToString()) return;
    PlayConfiguredEvent("TeamRoundLoss");
    Console.WriteLine("本方回合失败");
};
listener.TeamRoundVictory += gameEvent =>
{
    if (currentPlayerTeam != gameEvent.Team.ToString()) return;
    PlayConfiguredEvent("TeamRoundVictory");
    Console.WriteLine("本方回合胜利");
};
listener.Gameover += _ => PlayConfiguredEvent("Gameover");

if (listener.GenerateGSIConfigFile("trigger")) Console.WriteLine("GSI 配置文件已生成");
if (listener.Start())
{
    Console.WriteLine("GSI 监听已启动。");
    Console.WriteLine($"当前账号 ID {mySteamID}，名称 {myName}");
}

Console.WriteLine($"监听已启动：{listener.URI}");
Console.WriteLine("启动 CS2 并进入对局；收到状态后会输出。按 Enter 停止。");
Console.ReadLine();
listener.Stop();
Console.WriteLine("程序已退出");
