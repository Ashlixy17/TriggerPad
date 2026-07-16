using CounterStrike2GSI;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Media;

const int port = 10086;

string? mySteamID = null;
string? myName = null;

using var listener = new GameStateListener(port);

// 音频通过json加载
JObject config = JObject.Parse(File.ReadAllText("../config.json"));
string DiedSoundName = config["PlayerDied"]?["AudioName"]?.Value<string>()?? "Null";
var DiedSound = new SoundPlayer("../audio/" + DiedSoundName);

// steamID加载
void GetSteamID(GameState gameState)
{
    var steamID = gameState.Player.SteamID;
    if(steamID == null)
    {
        return;
    }
    mySteamID = steamID;
    Console.WriteLine($"获取到steamID:{mySteamID}");
    listener.NewGameState -= GetSteamID;
}
listener.NewGameState += GetSteamID;

// 回调使用
listener.PlayerDied += gameEvent =>
{
    if(DiedSoundName != "")
    {
        DiedSound.Play();
        Console.WriteLine($"{DiedSoundName}已成功播放");
    }
};
listener.PlayerFlashAmountChanged += gameEvent =>
{
    
};

// 创建cs配置文件
if (listener.GenerateGSIConfigFile("trigger"))
{
    Console.WriteLine($"GSI 配置文件已生成");
}
// 启动监听
if (listener.Start())
{
    Console.WriteLine("GSI 监听已启动。");
    Console.WriteLine($"当前账号id{mySteamID} 名称{myName}");
}

Console.WriteLine($"监听已启动：{listener.URI}");
Console.WriteLine("启动 CS2 并进入对局；收到状态后会输出。按 Enter 停止。");

Console.ReadLine();
listener.Stop();

Console.WriteLine("程序已退出");

// """
//     "PlayerDied":{
//         "name" : "xxx"
//     },
//     "PickedWeapon":{
//         "name" : "xxx"
//     }
// """