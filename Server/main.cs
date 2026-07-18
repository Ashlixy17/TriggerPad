
using CounterStrike2GSI;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Text;
using NAudio.Wave;
using System.Runtime.CompilerServices;
using System.Net.Http.Headers;

const int port = 10086;

Console.OutputEncoding = Encoding.UTF8;
Console.InputEncoding = Encoding.UTF8;

string? mySteamID = null;
string? myName = null;

using var listener = new GameStateListener(port);
string curPlayerTeam = "T";

// 加载json
var configPath = Environment.GetEnvironmentVariable("TRIGGERPAD_CONFIG_PATH")
    ?? Path.GetFullPath("../config.json", Directory.GetCurrentDirectory());
var audioDirectory = Environment.GetEnvironmentVariable("TRIGGERPAD_AUDIO_PATH")
    ?? Path.Combine(Path.GetDirectoryName(configPath)!, "audio");


// 音频播放函数
var output = new WaveOutEvent();
void PlayAudio(string eventName)
{
    JObject config = JObject.Parse(File.ReadAllText(configPath));
    if (config[eventName]?["isActive"]?.Value<bool>() ?? true)
    {
        var audioName = config[eventName]?["AudioName"]?.Value<string>()??null;
        if(audioName == null || audioName =="")
        {
            Console.WriteLine($"事件 {eventName} 未绑定任何音频");
            return;
        }
        var audio = new AudioFileReader("../audio/"+audioName);
        audio.Volume = (config["Settings"]?["DefaultVolume"]?.Value<float>()??100)/100.0f;
        output.Init(audio);
        output.Play();
        Console.WriteLine($"音频{audioName}已经播放");
        output.PlaybackStopped += (_, _) =>
        {
            output.Dispose();
            audio.Dispose();
        };
    }
    else
    {
        Console.WriteLine($"事件{eventName}已禁用");
    }

}


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
    PlayAudio("PlayerDied");
    Console.WriteLine($"{gameEvent.Player.Name}已死亡");
    
};
listener.PlayerFlashAmountChanged += gameEvent =>
{
    if(gameEvent.New == 1) 
    { 
        PlayAudio("PlayerFlashAmountChanged"); 
    }
};
listener.PlayerSmokedAmountChanged += gameEvent =>
{
    if(gameEvent.New > 90)
    {
        PlayAudio("PlayerSmokedAmountChanged");
    }  
};
listener.PlayerBurningAmountChanged += gameEvent =>
{
    if(gameEvent.New > 100)
    {
        PlayAudio("PlayBurningAmountChanged");
    }
};
listener.PlayerActiveWeaponChanged += gameEvent =>
{
    PlayAudio("PlayerActiveWeaponChanged");  
    Console.WriteLine($"更换主武器为{gameEvent.New.Name}");
};
listener.PlayerWeaponsPickedUp += gameEvent =>
{
    PlayAudio("PlayerWeaponsPickedUp");
    Console.WriteLine($"捡起武器");
};
listener.PlayerWeaponsDropped += gameEvent =>
{
    PlayAudio("PlayerWeaponsDropped");
    Console.WriteLine($"丢出武器");  
};
listener.PlayerGotKill += gameEvent =>
{
    PlayAudio("PlayerGotKill");  
};
listener.RoundConcluded += gameEvent =>
{
    PlayAudio("RoundConcluded");
};
listener.BombExploded += gameEvent =>
{
    PlayAudio("BombExploded");  
};
listener.BombPlanted += gameEvent =>
{
    PlayAudio("BombPlanted");
    Console.WriteLine("C4已安放");
};
listener.BombDefused += gameEvent =>
{
    PlayAudio("BombDefused");
    Console.WriteLine("C4已拆除");  
};
listener.PlayerTeamChanged += gameEvent =>
{
    curPlayerTeam = gameEvent.New.ToString();
    Console.WriteLine($"当前回合改变，玩家阵营为{gameEvent.New}"); 
};
listener.TeamRoundLoss += gameEvent =>
{
    if(curPlayerTeam == gameEvent.Team.ToString())
    {
        PlayAudio("TeamRoundLoss");
        Console.WriteLine("回合失败");
    }
};
listener.TeamRoundVictory += gameEvent =>
{
    if(curPlayerTeam == gameEvent.Team.ToString())
    {
        PlayAudio("TeamRoundVictory");
        Console.WriteLine("回合胜利");
    }
};
listener.Gameover += gameEvent =>
{
    PlayAudio("GameOver");  
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
