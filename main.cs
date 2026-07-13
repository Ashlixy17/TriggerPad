using CounterStrike2GSI;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Data;
using System.Media;


const int port = 10086;

var logPath = @"G:\GitHubDeskTop\TriggerPad\log.json";
var fileLock = new Object();
string? mySteamID = null;
string? myName = null;

using var listener = new GameStateListener(port);
var records = new JArray();

var DeathSound = new SoundPlayer(Path.Combine(Directory.GetCurrentDirectory(), "audio", "选中干员2.wav"));
var KillSound = new SoundPlayer(Path.Combine(Directory.GetCurrentDirectory(), "audio", "选中干员1.wav"));


if (listener.GenerateGSIConfigFile("trigger"))
{
    Console.WriteLine($"GSI 配置文件已生成");
}


listener.NewGameState += gameState =>
{
    mySteamID ??= gameState.Provider.SteamID;
    myName ??= gameState.Provider.Name;
};

listener.PlayerGotKill += gameEvent =>
{
    if(gameEvent.Player.SteamID == mySteamID)
    {
        
        Console.WriteLine($"玩家{gameEvent.Player.Name}击杀"); 
        KillSound.Play();
    }
};
listener.PlayerDied += gameEvent =>
{
    if(gameEvent.Player.SteamID == mySteamID)
    {
        Console.WriteLine($"玩家死亡：{gameEvent.Player.Name} 被杀死。");
        DeathSound.Play();
    }
};



if (listener.Start())
{
    Console.WriteLine("GSI 监听已启动。");
    Console.WriteLine($"当前账号id{mySteamID} 名称{myName}");
}

Console.WriteLine($"监听已启动：{listener.URI}");
Console.WriteLine("启动 CS2 并进入对局；收到状态后会输出。按 Enter 停止。");

Console.ReadLine();
listener.Stop();